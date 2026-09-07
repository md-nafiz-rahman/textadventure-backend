require('dotenv').config();
const express = require('express');
const cors = require('cors');

const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = typeof AnthropicModule === 'function' ? AnthropicModule : AnthropicModule.default;

const { mapToolSchema } = require('./mapSchema');
const { validateMap } = require('./validateMap');

const BLOCKED_TERMS = [
  'nsfw',
  'explicit',
  'nude',
  'naked',
  'porn'
];

function containsBlockedContent(text) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => normalized.includes(term));
}

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Keep all content strictly family-friendly. Never generate sexual, explicit, or adult content of any kind. If the user's description implies anything inappropriate, ignore that part entirely and invent a wholesome, unrelated theme instead.

IMPORTANT: Generate the title, startRoomId, and objective fields FIRST, before writing out the detailed rooms array. These identifying fields must never be lost, even in a long, detailed generation.

You are a game designer generating maps for a text adventure game. The engine supports:

- Rooms connected by exits in named directions (e.g. "north", "up", "hidden door" — any descriptive word works)
- Items that can be picked up and carried
- Puzzles: a single riddle per room, with a text answer and progressive hints. Solving one can unlock an exit in that room and/or reveal a hidden item.
- Enemies: a single enemy per room, defeated by having AT LEAST ONE of a list of qualifying items. Defeating one can unlock an exit and/or reveal a hidden item.
- An objective: reach a room, collect items, or defeat enemies.

Rules you must follow:
1. Create between 5 and 8 rooms.
2. Every room must be reachable from the starting room by following exits.
3. Every exit's roomId must reference a room that actually exists.
4. If an exit is locked, either give it a requiredItemId that exists as a real item somewhere, OR ensure the same room has a puzzle or enemy whose unlocksExitDirection matches that exit's direction.
5. Every enemy's defeatedByAnyOf must list at least one item that genuinely exists and is obtainable before reaching that enemy.
6. Every puzzle must have exactly 2 hints, vague to specific, with a clear, fair, one-or-two-word answer.
7. The objective's target must reference real ids that exist and are achievable given the layout.
8. Keep ids short, unique, lowercase with underscores (e.g. "rusty_sword", "guard_dog").
9. Write vivid but concise descriptions (1-3 sentences) matching the requested theme.

Call the generate_map tool with the complete structure.`;

function buildUserPrompt(description) {
  if (description && description.trim() !== '') {
    return `Generate a text adventure map based on this description: "${description.trim()}"`;
  }
  return 'Generate a random, creative text adventure map. Surprise the player with an interesting theme.';
}

async function generateMapAttempt(description, previousErrors) {
  let userPrompt = buildUserPrompt(description);

  if (previousErrors && previousErrors.length > 0) {
    userPrompt += `\n\nYour previous attempt had these problems, please fix them:\n${previousErrors.map((e) => `- ${e}`).join('\n')}`;
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 20000,
    system: SYSTEM_PROMPT,
    tools: [mapToolSchema],
    tool_choice: { type: 'tool', name: 'generate_map' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUseBlock = message.content.find((block) => block.type === 'tool_use');
  if (!toolUseBlock) {
    throw new Error('Model did not return a structured map.');
  }

  return toolUseBlock.input;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'TextAdventureGame backend is running' });
});

app.post('/generate', async (req, res) => {
  try {
    const { description } = req.body;

    if (containsBlockedContent(description)) {
        return res.status(400).json({ error: 'Please use a family-friendly description and try again.' });    }

    const MAX_ATTEMPTS = 5;
    let lastErrors = [];
    let generatedMap = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const candidate = await generateMapAttempt(description, lastErrors);
      const { valid, errors } = validateMap(candidate);

      if (valid) {
        generatedMap = candidate;
        break;
      }
      console.log(`Attempt ${attempt} failed validation:`, errors);
      console.log(`Attempt ${attempt} raw output:`, JSON.stringify(candidate));
        lastErrors = errors;
    }

    if (!generatedMap) {
      return res.status(500).json({ error: 'Could not generate a valid map after multiple attempts.', details: lastErrors });
    }

    res.json({ map: generatedMap });
  } catch (error) {
    console.error('Error in /generate:', error);
    res.status(500).json({ error: 'Something went wrong generating the map.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

});
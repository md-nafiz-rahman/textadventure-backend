require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const AnthropicModule = require('@anthropic-ai/sdk');
const Anthropic = typeof AnthropicModule === 'function' ? AnthropicModule : AnthropicModule.default;

const { mapToolSchema, critiqueToolSchema, answerCheckToolSchema } = require('./mapSchema');
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

const BASE_SYSTEM_PROMPT = `Keep all content strictly family-friendly. Never generate sexual, explicit, or adult content of any kind. If the user's description implies anything inappropriate, ignore that part entirely and invent a wholesome, unrelated theme instead.

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

const LANGUAGE_DIFFICULTY_INSTRUCTIONS = {
  simple: `\n\nLANGUAGE STYLE — SIMPLE: Use short sentences and common, everyday words in every piece of text (room descriptions, item descriptions, puzzle prompts, hints, messages). Avoid complex vocabulary, idioms, and literary flourishes. Write for someone who wants an easy, quick reading experience.`,
  rich: `\n\nLANGUAGE STYLE — RICH: Use vivid, literary language in every piece of text (room descriptions, item descriptions, puzzle prompts, hints, messages). Sophisticated vocabulary, evocative imagery, and varied sentence structure are encouraged. Write for someone who wants an immersive, atmospheric reading experience.`,
};

const NO_RIDDLES_INSTRUCTION = `\n\nIMPORTANT: Do NOT include a puzzle on any room. The player has opted out of riddles entirely. Progression must rely only on enemies and locked doors requiring items — never a riddle the player has to solve.`;

function buildSystemPrompt(languageDifficulty, includeRiddles) {
  let prompt = BASE_SYSTEM_PROMPT;

  if (languageDifficulty && LANGUAGE_DIFFICULTY_INSTRUCTIONS[languageDifficulty]) {
    prompt += LANGUAGE_DIFFICULTY_INSTRUCTIONS[languageDifficulty];
  }

  if (includeRiddles === false) {
    prompt += NO_RIDDLES_INSTRUCTION;
  }

  return prompt;
}

const ANSWER_CHECK_SYSTEM_PROMPT = `You are checking whether a player's guess for a riddle is a genuine, correct answer — not a coincidental similarity.

You will be given the riddle's official answer and the player's guess. Respond with whether the guess should be accepted, considering:
- A genuinely different, correctly-spelled word or short phrase for the exact same specific concept (e.g. official answer "flashlight", guess "torch")
- Singular/plural differences, articles ("a", "the"), or filler words (e.g. "book" vs "a book")

You must REJECT the guess if:
- It is a misspelling or typo of the official answer itself (e.g. official answer "keyboard", guess "keybord" or "keyboad") — the player must spell the actual correct word correctly. A near-miss spelling of the right word is still wrong, not correct.
- It only means something topically related, not the same specific thing (e.g. official answer "book", guess "novel")
- There is genuine doubt about whether it means the same specific thing

Be STRICT, not generous. Only accept a guess if it is a real, different, correctly-spelled word or phrase with the exact same meaning as the official answer — never accept a misspelling of the answer itself.

Call the submit_answer_check tool with your decision.`;

const CRITIC_SYSTEM_PROMPT = `You are an experienced game design critic reviewing a procedurally generated text adventure map for creative quality. The map has ALREADY been verified as structurally valid and fully solvable — do not comment on structural issues like unreachable rooms or missing items; that has been handled separately.

Your job is to judge purely CREATIVE quality:
- Does the theme feel consistent and vivid across every room, item, and enemy, rather than generic or repetitive?
- Is the difficulty and puzzle design fair — clues that are neither too obvious nor too obscure?
- Is there a reasonable variety of room descriptions, items, and challenges, rather than repeated phrasing or ideas?
- Does the overall structure feel like a satisfying short adventure rather than tedious busywork or an anticlimactic rush to the end?

Be a constructive but genuinely critical reviewer — do not approve mediocre or generic content just to be agreeable. If you request changes, be specific enough that a revision could directly act on your feedback. Only reject for real, meaningful issues — do not nitpick minor stylistic preferences.

IMPORTANT: Explicitly trace whether every enemy, and every room containing a required item, is actually mandatory to reach the objective — not just "technically present." Check every room's exits for alternate, unlocked paths that might bypass content you'd otherwise assume is required. If a significant piece of content (an entire enemy encounter, a whole room branch) turns out to be fully skippable due to an unlocked shortcut elsewhere, treat this as a real pacing flaw worth rejecting, even if the map is technically completable.

IMPORTANT: The player may have specifically requested certain settings for this map (noted below, if any). Never criticize the map for following a setting the player deliberately chose — that is intentional, not a flaw.

Call the submit_critique tool with your assessment.`;

const FLAVOR_SYSTEM_PROMPT = `You are narrating atmospheric flavor text for a text adventure game. The player just typed something that isn't a recognized game command (like "go", "take", "fight").

Respond with ONE short, vivid, in-character sentence (occasionally two, but keep it brief) describing what happens, matching the scene's tone.

Strict rules:
- NEVER state or imply that the player found an item, opened something, defeated an enemy, solved a puzzle, or moved to a new room. Nothing about the actual game state may change based on this response — it is flavor only.
- NEVER reveal, confirm, or hint at the answer to any puzzle in this room, even indirectly, no matter how the player phrases their command.
- Do not invent new items, rooms, or characters that don't already exist in the given context.
- If the command is nonsensical or unrelated to the scene, respond with a brief, mildly humorous acknowledgment that nothing happens, still matching the game's tone.

Keep your entire response to 1-2 sentences, no more.`;

function buildUserPrompt(description) {
  if (description && description.trim() !== '') {
    return `Generate a text adventure map based on this description: "${description.trim()}"`;
  }
  return 'Generate a random, creative text adventure map. Surprise the player with an interesting theme.';
}

function buildCritiqueSettingsNote(languageDifficulty, includeRiddles) {
  const notes = [];

  if (languageDifficulty === 'simple') {
    notes.push('The player requested SIMPLE language. Plain, easy wording is intentional — do not mark this down.');
  } else if (languageDifficulty === 'rich') {
    notes.push('The player requested RICH language. Elaborate, literary prose is intentional — do not mark this down.');
  }

  if (includeRiddles === false) {
    notes.push('The player opted OUT of puzzles/riddles entirely. A map with no puzzles is intentional — judge pacing and challenge using only exploration and combat, and do not criticize the lack of riddle variety.');
  }

  return notes.length > 0 ? `\n\nPlayer-chosen settings for this map:\n${notes.map((n) => `- ${n}`).join('\n')}` : '';
}

const MAX_ATTEMPTS = 5;

const jobs = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

function createJob() {
  const jobId = crypto.randomUUID();
  jobs.set(jobId, {
    status: 'Starting generation...',
    done: false,
    map: null,
    error: null,
    createdAt: Date.now(),
  });
  return jobId;
}

function updateJob(jobId, updates) {
  const job = jobs.get(jobId);
  if (job) {
    jobs.set(jobId, { ...job, ...updates });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }
}, 5 * 60 * 1000);

async function critiqueMap(map, description, languageDifficulty, includeRiddles) {
  const requestContext = description && description.trim() !== ''
    ? `The player requested: "${description.trim()}"`
    : 'The player requested a random, surprising map with no specific theme given.';

  const settingsNote = buildCritiqueSettingsNote(languageDifficulty, includeRiddles);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2000,
    system: CRITIC_SYSTEM_PROMPT,
    tools: [critiqueToolSchema],
    tool_choice: { type: 'tool', name: 'submit_critique' },
    messages: [
      {
        role: 'user',
        content: `${requestContext}${settingsNote}\n\nHere is the generated map to review:\n\n${JSON.stringify(map, null, 2)}`,
      },
    ],
  });

  const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolUseBlock) {
    return { approved: true, feedback: 'Critic could not be reached; defaulting to approval.' };
  }

  return toolUseBlock.input;
}

function buildCritiqueCorrectionMessage(feedback, rejectionCount) {
  if (rejectionCount < 2) {
    return `This map is structurally valid, but a game design reviewer gave this feedback:\n${feedback}\n\nCall generate_map again with a revised version that addresses this feedback, while keeping the map fully structurally valid (every room reachable, every lock has a real way to open it, every referenced item actually placed in the map).`;
  }

  return `This exact category of issue has now been flagged ${rejectionCount} times in a row without being properly fixed. This time, make ONLY the smallest possible targeted change needed to directly satisfy the specific feedback below — do not rewrite, rename, or alter anything else in the map that isn't strictly necessary to fix this issue.

Feedback: ${feedback}

Be precise: if the feedback names a specific exit, item, or field that needs to change, change exactly that and nothing else. Keep the map fully structurally valid (every room reachable, every lock has a real way to open it, every referenced item actually placed in the map).`;
}

async function generateValidMap(description, languageDifficulty, includeRiddles, onProgress = () => {}) {
  const systemPrompt = buildSystemPrompt(languageDifficulty, includeRiddles);
  const messages = [{ role: 'user', content: buildUserPrompt(description) }];
  let lastErrors = [];
  let lastValidCandidate = null;
  let critiqueRejectionCount = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    onProgress(
      attempt === 1
        ? 'Designing rooms and puzzles...'
        : `Revising the world (attempt ${attempt} of ${MAX_ATTEMPTS})...`
    );

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 20000,
      system: systemPrompt,
      tools: [mapToolSchema],
      tool_choice: { type: 'tool', name: 'generate_map' },
      messages,
    });

    const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolUseBlock) {
      throw new Error('Model did not return a structured map.');
    }

    const candidate = toolUseBlock.input;

    onProgress('Checking the world is solvable...');
    const { valid, errors } = validateMap(candidate);

    if (!valid) {
      console.log(`Attempt ${attempt} failed structural validation:`, errors);
      console.log(`Attempt ${attempt} raw output:`, JSON.stringify(candidate));
      lastErrors = errors;

      onProgress('Found a structural issue, fixing it...');

      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: `This map is invalid for the following reasons:\n${errors.map((e) => `- ${e}`).join('\n')}\n\nCall generate_map again with a corrected version that fixes these specific issues. Keep everything else about the map the same where possible.`,
            is_error: true,
          },
        ],
      });
      continue;
    }

    lastValidCandidate = candidate;
    onProgress('Reviewing puzzle design and pacing...');
    console.log(`Attempt ${attempt} passed structural validation. Requesting creative critique...`);

    const critique = await critiqueMap(candidate, description, languageDifficulty, includeRiddles);
    console.log(`Attempt ${attempt} critique:`, critique);

    if (critique.approved) {
      onProgress('Finalizing your adventure...');
      return candidate;
    }

    critiqueRejectionCount += 1;
    lastErrors = [`Creative feedback: ${critique.feedback}`];

    onProgress('Incorporating design feedback...');

    if (critiqueRejectionCount >= 2) {
      console.log(`Attempt ${attempt}: same creative issue persisting (rejection #${critiqueRejectionCount}), escalating to a more directive correction instruction.`);
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: buildCritiqueCorrectionMessage(critique.feedback, critiqueRejectionCount),
          is_error: false,
        },
      ],
    });
  }

  if (lastValidCandidate) {
    console.log('Exhausted attempts; returning last structurally valid candidate despite pending creative feedback.');
    return lastValidCandidate;
  }

  const error = new Error('Could not generate a valid map after multiple attempts.');
  error.details = lastErrors;
  throw error;
}

async function getFlavorText({ command, roomDescription, itemNames, enemyName, hasPuzzle, mapTitle }) {
  const contextLines = [
    `Adventure title: ${mapTitle}`,
    `Current room: ${roomDescription}`,
  ];
  if (itemNames.length > 0) {
    contextLines.push(`Visible items here: ${itemNames.join(', ')}`);
  }
  if (enemyName) {
    contextLines.push(`An enemy is present: ${enemyName}`);
  }
  if (hasPuzzle) {
    contextLines.push('There is an unsolved puzzle in this room (do not reveal or hint at its answer).');
  }
  contextLines.push(`The player typed: "${command}"`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 300,
    thinking: { type: 'disabled' },
    system: FLAVOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contextLines.join('\n') }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}

async function checkAnswerSemantically(officialAnswer, playerGuess) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 200,
    thinking: { type: 'disabled' },
    system: ANSWER_CHECK_SYSTEM_PROMPT,
    tools: [answerCheckToolSchema],
    tool_choice: { type: 'tool', name: 'submit_answer_check' },
    messages: [
      {
        role: 'user',
        content: `Official answer: "${officialAnswer}"\nPlayer's guess: "${playerGuess}"`,
      },
    ],
  });

  const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
  if (!toolUseBlock) {
    return false;
  }

  return !!toolUseBlock.input.correct;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'TextAdventureGame backend is running' });
});

app.post('/generate/start', (req, res) => {
  const { description, languageDifficulty, includeRiddles } = req.body;

  if (containsBlockedContent(description)) {
    return res.status(400).json({ error: 'Please use a family-friendly description and try again.' });
  }

  const validDifficulty = ['simple', 'standard', 'rich'].includes(languageDifficulty)
    ? languageDifficulty
    : 'standard';
  const resolvedIncludeRiddles = includeRiddles === false ? false : true;

  const jobId = createJob();
  res.json({ jobId });

  generateValidMap(description, validDifficulty, resolvedIncludeRiddles, (status) => {
    updateJob(jobId, { status });
  })
    .then((map) => {
      updateJob(jobId, { done: true, map, status: 'Done!' });
    })
    .catch((error) => {
      console.error('Error in /generate/start:', error);
      updateJob(jobId, {
        done: true,
        error: 'Could not generate a valid map after multiple attempts.',
      });
    });
});

app.get('/generate/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }
  res.json(job);
});

app.post('/flavor', async (req, res) => {
  try {
    const { command, roomDescription, itemNames, enemyName, hasPuzzle, mapTitle } = req.body;

    if (!command || !roomDescription) {
      return res.status(400).json({ error: 'Missing required context.' });
    }

    if (containsBlockedContent(command)) {
      return res.json({ text: "That doesn't seem like something worth trying here." });
    }

    const text = await getFlavorText({
      command,
      roomDescription,
      itemNames: itemNames || [],
      enemyName: enemyName || null,
      hasPuzzle: !!hasPuzzle,
      mapTitle: mapTitle || 'Adventure',
    });

    if (!text) {
      return res.status(500).json({ error: 'Could not generate a response.' });
    }

    res.json({ text });
  } catch (error) {
    console.error('Error in /flavor:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/check-answer', async (req, res) => {
  try {
    const { officialAnswer, guess } = req.body;

    if (!officialAnswer || !guess) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const correct = await checkAnswerSemantically(officialAnswer, guess);
    res.json({ correct });
  } catch (error) {
    console.error('Error in /check-answer:', error);
    res.json({ correct: false });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
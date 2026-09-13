const mapToolSchema = {
  name: 'generate_map',
  description: 'Generates a complete text adventure game map matching the required schema.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short, evocative title for this adventure.' },
      startRoomId: { type: 'string', description: 'The id of the room the player starts in.' },
      objective: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['reachRoom', 'collectItems', 'defeatEnemies'] },
          target: {
            type: 'array',
            items: { type: 'string' },
            description: 'The ids of the room(s), item(s), or enemy(ies) that satisfy the objective.',
          },
        },
        required: ['type', 'target'],
      },
      rooms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            exits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  direction: { type: 'string' },
                  roomId: { type: 'string' },
                  locked: { type: 'boolean' },
                  requiredItemId: { type: 'string' },
                },
                required: ['direction', 'roomId'],
              },
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  canTake: { type: 'boolean' },
                  hidden: { type: 'boolean' },
                },
                required: ['id', 'name', 'description', 'canTake'],
              },
            },
            puzzle: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string' },
                answer: { type: 'string' },
                hints: { type: 'array', items: { type: 'string' } },
                onSolve: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    unlocksExitDirection: { type: 'string' },
                    revealsItemId: { type: 'string' },
                  },
                  required: ['message'],
                },
              },
              required: ['id', 'prompt', 'answer', 'hints', 'onSolve'],
            },
            enemy: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                introMessage: { type: 'string' },
                defeatedByAnyOf: { type: 'array', items: { type: 'string' } },
                damage: { type: 'number' },
                successMessage: { type: 'string' },
                failMessage: { type: 'string' },
                onDefeat: {
                  type: 'object',
                  properties: {
                    revealsItemId: { type: 'string' },
                    unlocksExitDirection: { type: 'string' },
                  },
                },
              },
              required: ['id', 'name', 'introMessage', 'defeatedByAnyOf', 'damage', 'successMessage', 'failMessage', 'onDefeat'],
            },
          },
          required: ['id', 'description', 'exits', 'items'],
        },
      },
    },
    required: ['title', 'startRoomId', 'objective', 'rooms'],
  },
};

const critiqueToolSchema = {
  name: 'submit_critique',
  description: 'Submit a creative quality assessment of a text adventure map.',
  input_schema: {
    type: 'object',
    properties: {
      approved: {
        type: 'boolean',
        description: 'True if the map is creatively solid and ready to ship as-is. False if it needs revision.',
      },
      feedback: {
        type: 'string',
        description: 'If approved, a brief note on what works well. If not approved, specific and actionable feedback on what to improve.',
      },
    },
    required: ['approved', 'feedback'],
  },
};

const answerCheckToolSchema = {
  name: 'submit_answer_check',
  description: 'Submit a judgment on whether a player\'s guess matches the correct riddle answer.',
  input_schema: {
    type: 'object',
    properties: {
      correct: {
        type: 'boolean',
        description: 'True only if the guess genuinely means the same specific thing as the official answer.',
      },
    },
    required: ['correct'],
  },
};

const intentDetectionToolSchema = {
  name: 'submit_intent_detection',
  description: 'Submit a judgment on whether the player\'s freeform text was a rephrased attempt at a known game command.',
  input_schema: {
    type: 'object',
    properties: {
      isGameAction: {
        type: 'boolean',
        description: 'True only if you are confident the player was clearly attempting one of the known game commands, using a target explicitly listed as available in the context given to you.',
      },
      verb: {
        type: 'string',
        enum: ['look', 'go', 'take', 'inventory', 'examine', 'solve', 'hint', 'fight', 'save', 'help'],
        description: 'The real game command the player was attempting. Only meaningful if isGameAction is true.',
      },
      argument: {
        type: 'string',
        description: 'The specific target for the command — a direction, an item name, an enemy name, or the player\'s puzzle answer content. Use an empty string for commands that need no argument (look, inventory, hint, save, help).',
      },
    },
    required: ['isGameAction', 'verb', 'argument'],
  },
};

module.exports = { mapToolSchema, critiqueToolSchema, answerCheckToolSchema, intentDetectionToolSchema };
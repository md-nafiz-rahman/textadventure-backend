# AI Text Adventure Backend

Backend server for the AI Text Adventure Game. Generates complete, playable game worlds from a player's description using Claude Sonnet 5.

Frontend repo: [ai-text-adventure-game](https://github.com/md-nafiz-rahman/ai-text-adventure-game)

## How it works

1. **Generator agent** - Claude builds a game world (rooms, items, puzzles, enemies) using structured tool-calling.
2. **Validator** - plain JavaScript, not AI. Simulates a full playthrough to confirm the world is actually solvable (every lock has a key, every enemy is beatable, the objective is reachable).
3. **Critic agent** - a second, separate Claude call reviews the world purely for creative quality (pacing, fairness, theme).
4. If anything fails, the specific reason is sent back to the generator to fix, up to 5 attempts. If it never fully succeeds, the last valid version is returned instead of an error.

## API

- `POST /generate/start` - start generating a map, returns a job ID
- `GET /generate/status/:jobId` - poll for progress and the final result
- `POST /flavor` - AI response for commands the game doesn't recognise
- `POST /check-answer` - checks if a puzzle guess is a valid synonym of the real answer
- `GET /health` - uptime check

## Tech stack

Node.js, Express, Anthropic Claude Sonnet 5. Deployed on Render.

## Running locally

```
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=your_key_here
```

Start it:

```
node server.js
```

Runs on `http://localhost:3001`.

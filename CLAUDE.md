# CLAUDE.md

## Project Overview

`ax-gskill` automatically learns repository-specific skills (SKILL.md files) for coding agents via evolutionary search. Pure TypeScript on Bun, using `@ax-llm/ax` for all LLM operations. Zero Python dependencies.

## Commands

```bash
bun install              # Install dependencies
bun run start            # Run CLI (ax-gskill)
bun test                 # Run tests (Bun test runner)
bun run lint             # Lint (Biome)
bun run format           # Format (Biome)
bun run check            # Lint + format auto-fix
bun run typecheck        # TypeScript type checking
bun run build            # Compile standalone binary to dist/ax-gskill
```

## CLI

`src/index.ts` is the entry point (Commander.js). Two commands:

- `ax-gskill run <repo-url>` — full optimization pipeline
  - `-o, --output-dir` (default: `.claude/skills`)
  - `-n, --max-evals` (default: 150)
  - `--no-initial-skill` — skip LLM seed, start from empty
  - `-m, --agent-model` — e.g. `anthropic/claude-sonnet-4-6`
  - `-s, --skill-model` — e.g. `anthropic/claude-opus-4-6`
  - `-u, --base-url` — OpenAI-compatible base URL
- `ax-gskill tasks <owner/repo>` — list SWE-smith tasks
  - `-l, --limit` (default: 10)
  - `--list`

## Project Structure

```
src/
├── index.ts       # CLI (Commander.js)
├── pipeline.ts    # Orchestration: load tasks -> seed -> optimize -> save
├── skill.ts       # Initial skill generation (ax-llm + GitHub API)
├── tasks.ts       # SWE-smith loading (HuggingFace API + ~/.cache/ax-gskill/)
├── evaluator.ts   # GEPA-compatible evaluator wrapper
├── agent.ts       # Lightweight SWE agent (ax-llm chat + Docker bash tool)
├── docker.ts      # Docker container lifecycle + test runner
├── optimize.ts    # GEPA evolutionary loop (reflection + mutation via ax-llm)
├── types.ts       # All TypeScript interfaces
└── config.ts      # Config resolution: CLI flag -> env var -> default
test/
├── config.test.ts
├── tasks.test.ts
├── skill.test.ts
└── docker.test.ts
```

## Dependencies

- **@ax-llm/ax** — unified LLM interface (skill gen, agent chat, GEPA reflection)
- **commander** — CLI framework
- **@biomejs/biome** — linter + formatter (dev)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | required | Anthropic API key |
| `OPENAI_API_KEY` | -- | OpenAI API key (if using OpenAI models) |
| `GSKILL_AGENT_MODEL` | `anthropic/claude-sonnet-4-6` | SWE agent model |
| `GSKILL_SKILL_MODEL` | `anthropic/claude-opus-4-6` | Skill gen + reflection model |
| `OPENAI_BASE_URL` | -- | Custom base URL |

## Module Responsibilities

- **pipeline.ts** — parse repo URL, load tasks, generate seed, run optimize, save best skill
- **skill.ts** — GitHub API (README + config files), ax-llm LLM call, `saveSkill()` writes to disk
- **tasks.ts** — HuggingFace Dataset Viewer API, filters by repo slug, caches locally, 67/17/16% split
- **evaluator.ts** — adapter: `(skill, task) -> [score, info]` combining agent + Docker tests
- **agent.ts** — tool-calling loop: ax-llm `chat()` with bash tool + Docker exec, max 30 turns
- **docker.ts** — `startContainer`, `dockerExec`, `stopContainer`, `runTests` via `Bun.spawn`
- **optimize.ts** — GEPA evolutionary loop: pool, minibatch eval, ax-llm reflection/mutation
- **config.ts** — `parseModelString("provider/model")`, `parseRepoUrl()`, `resolveConfig()`
- **types.ts** — SWESmithTask, PipelineConfig, EvalInfo, Evaluator, Candidate, OptimizeResult

## External Requirements

- Docker must be running (SWE-bench containers for agent execution + test verification)

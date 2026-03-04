# ax-gskill

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=fff)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)](https://typescriptlang.org)

Automatically learns repository-specific skills for coding agents using evolutionary search.

Given a GitHub repository, ax-gskill produces a `.claude/skills/{repo}/SKILL.md` file containing optimized instructions that dramatically improve an agent's resolve rate on that repo's issues. It uses [GEPA](https://gepa-ai.github.io/gepa/blog/2026/02/18/automatically-learning-skills-for-coding-agents/) evolutionary prompt optimization, which demonstrated improvements from 24% to 93% resolve rate on some repositories.

## How it works

1. Loads verifiable software engineering tasks from [SWE-smith](https://huggingface.co/datasets/SWE-bench/SWE-smith) for the target repository
2. Generates an initial skill via static analysis of the repo (README, config files) + LLM
3. Iteratively refines the skill through evolutionary search (GEPA loop)
4. Each candidate skill is evaluated by running a lightweight SWE agent on training tasks inside Docker and checking whether the FAIL_TO_PASS tests pass
5. Writes the best-scoring skill to disk

Built with [Bun](https://bun.sh) and [@ax-llm/ax](https://github.com/ax-llm/ax). Zero Python dependencies.

## Requirements

- [Bun](https://bun.sh) v1.0+
- Docker (for running SWE-smith task environments)
- `ANTHROPIC_API_KEY` (default provider) or `OPENAI_API_KEY`

## Installation

```bash
git clone https://github.com/itsmostafa/ax-gskill
cd ax-gskill
bun install
```

## Usage

### Run the full pipeline

```bash
bun run start run https://github.com/pallets/jinja
```

This will:
- Load SWE-smith tasks for `pallets/jinja`
- Generate an initial skill
- Run up to 150 evaluations to optimize the skill
- Write the result to `.claude/skills/jinja/SKILL.md`

### Common options

```bash
# Custom evaluation budget (more evals = better skill, slower run)
bun run start run https://github.com/pallets/jinja --max-evals 300

# Custom output directory
bun run start run https://github.com/pallets/jinja --output-dir ~/skills

# Skip initial skill generation, start from empty
bun run start run https://github.com/pallets/jinja --no-initial-skill

# Use a different model for the coding agent
bun run start run https://github.com/pallets/jinja --agent-model openai/gpt-4o

# Use a different model for skill generation
bun run start run https://github.com/pallets/jinja --skill-model openai/gpt-4o
```

Models are specified as `provider/model` (e.g. `anthropic/claude-sonnet-4-20250514`, `openai/gpt-4o`). You can also set defaults via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | -- | API key for Anthropic models |
| `OPENAI_API_KEY` | -- | API key for OpenAI models |
| `GSKILL_AGENT_MODEL` | `anthropic/claude-sonnet-4-20250514` | Model for the SWE agent |
| `GSKILL_SKILL_MODEL` | `anthropic/claude-opus-4-6` | Model for skill generation + GEPA reflection |
| `OPENAI_BASE_URL` | -- | Custom base URL for compatible APIs |

### Preview available tasks

```bash
# Show the first 10 SWE-smith tasks for a repo
bun run start tasks pallets/jinja

# Show more
bun run start tasks pallets/jinja --limit 25
```

### Build standalone binary

```bash
bun run build
./dist/ax-gskill --help
```

## Scripts

```bash
bun install        # Install dependencies
bun run start      # Run CLI
bun test           # Run tests
bun run lint       # Lint (Biome)
bun run format     # Format (Biome)
bun run check      # Lint + format auto-fix
bun run typecheck  # TypeScript type checking
bun run build      # Compile standalone binary
```

## Project structure

```
ax-gskill/
├── src/
│   ├── index.ts       # CLI (Commander.js)
│   ├── pipeline.ts    # Orchestration: load tasks -> seed -> optimize -> save
│   ├── skill.ts       # Initial skill generation (ax-llm + GitHub API)
│   ├── tasks.ts       # SWE-smith loading (HuggingFace API + cache)
│   ├── evaluator.ts   # GEPA-compatible evaluator wrapper
│   ├── agent.ts       # Lightweight SWE agent (ax-llm + Docker bash)
│   ├── docker.ts      # Docker container lifecycle + test runner
│   ├── optimize.ts    # GEPA evolutionary loop (reflection + mutation)
│   ├── types.ts       # TypeScript interfaces
│   └── config.ts      # Config resolution (CLI -> env -> defaults)
├── test/
│   ├── config.test.ts
│   ├── tasks.test.ts
│   ├── skill.test.ts
│   └── docker.test.ts
├── package.json
├── tsconfig.json
└── biome.json
```

## License

[MIT](LICENSE)

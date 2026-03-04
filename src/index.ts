#!/usr/bin/env bun
/** CLI entry point for ax-gskill. */

import { Command } from 'commander';
import { loadTasks } from './tasks.js';

const program = new Command();

program
	.name('ax-gskill')
	.description('Automatically learn repository-specific skills for coding agents.')
	.version('0.1.0');

program
	.command('run')
	.description('Run the gskill pipeline: optimize a SKILL.md for the given repository.')
	.argument('<repo-url>', 'GitHub repository URL, e.g. https://github.com/pallets/jinja')
	.option('-o, --output-dir <dir>', 'Directory to write the optimized SKILL.md', '.claude/skills')
	.option('-n, --max-evals <n>', 'GEPA evaluation budget (number of mini runs)', '150')
	.option('--no-initial-skill', 'Skip static analysis; start GEPA from an empty seed')
	.option(
		'-m, --agent-model <model>',
		'Model for SWE agent (e.g. anthropic/claude-sonnet-4-20250514). Env: GSKILL_AGENT_MODEL',
	)
	.option(
		'-s, --skill-model <model>',
		'Model for skill generation (e.g. anthropic/claude-opus-4-6). Env: GSKILL_SKILL_MODEL',
	)
	.option(
		'-u, --base-url <url>',
		'OpenAI-compatible base URL for local models. Env: OPENAI_BASE_URL',
	)
	.option(
		'-b, --backend <type>',
		'Execution backend: "local" (default, no Docker) or "docker" (SWE-smith images). Env: GSKILL_BACKEND',
	)
	.action(async (repoUrl: string, opts: Record<string, string | boolean>) => {
		const { run } = await import('./pipeline.js');
		await run({
			repoUrl,
			outputDir: opts.outputDir as string | undefined,
			maxEvals: opts.maxEvals ? Number(opts.maxEvals) : undefined,
			noInitialSkill: opts.initialSkill === false, // commander stores --no-initial-skill as initialSkill: false
			agentModel: (opts.agentModel as string) || undefined,
			skillModel: (opts.skillModel as string) || undefined,
			baseUrl: (opts.baseUrl as string) || undefined,
			backend: (opts.backend as string) || undefined,
		});
	});

program
	.command('tasks')
	.description('List available SWE-smith tasks for a repository and write them to a JSON file.')
	.argument('<repo>', "Repository name in 'owner/repo' format, e.g. pallets/jinja")
	.option('-l, --limit <n>', 'Number of tasks to show', '10')
	.option('--list', 'List all available tasks (up to --limit)')
	.action(async (repo: string, opts: { limit?: string; list?: boolean }) => {
		const limit = Number(opts.limit ?? 10);

		try {
			const allTasks = await loadTasks(repo, 300);
			const shown = allTasks.slice(0, limit);

			const [owner, repoName] = repo.split('/', 2);
			const timestamp = new Date()
				.toISOString()
				.replace(/[-:]/g, '')
				.replace('T', 'T')
				.split('.')[0];
			const filename = `${repoName}-${owner}--tasks-${timestamp}.json`;

			await Bun.write(filename, JSON.stringify(shown, null, 2));

			console.log(
				`Found ${allTasks.length} tasks for '${repo}' (${shown.length} written to ${filename})`,
			);
		} catch (err) {
			console.error(`Error: ${err instanceof Error ? err.message : err}`);
			process.exit(1);
		}
	});

program.parse();

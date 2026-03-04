/** Top-level pipeline orchestration: load tasks -> seed -> optimize -> save. */

import { parseRepoUrl, resolveConfig } from './config.js';
import { makeEvaluator } from './evaluator.js';
import { optimize } from './optimize.js';
import { generateInitialSkill, saveSkill } from './skill.js';
import { loadTasks, splitTasks } from './tasks.js';
import type { OptimizeResult, PipelineConfig } from './types.js';

/**
 * Run the full gskill pipeline for a repository.
 */
export async function run(opts: {
	repoUrl: string;
	outputDir?: string;
	maxEvals?: number;
	noInitialSkill?: boolean;
	agentModel?: string;
	skillModel?: string;
	baseUrl?: string;
}): Promise<OptimizeResult> {
	const config = resolveConfig(opts);
	const repoId = parseRepoUrl(config.repoUrl);

	console.log(`[gskill] Repo: ${repoId.slug}`);

	// 1. Load tasks
	console.log('[gskill] Loading tasks from SWE-smith...');
	const tasks = await loadTasks(repoId.slug);
	const { train, val, test } = splitTasks(tasks);
	console.log(`[gskill] Tasks: ${train.length} train / ${val.length} val / ${test.length} test`);

	// 2. Optionally generate initial skill
	let seedSkill = '';
	if (config.useInitialSkill) {
		console.log('[gskill] Generating initial skill...');
		try {
			seedSkill = await generateInitialSkill(config.repoUrl, config);
			const outPath = await saveSkill(seedSkill, repoId.slug, config.outputDir);
			console.log(`[gskill] Initial skill (${seedSkill.length} chars) saved to: ${outPath}`);
		} catch (err) {
			console.warn(`[gskill] Warning: initial skill generation failed — ${err}`);
			console.log('[gskill] Continuing without seed skill (GEPA will start from scratch).');
		}
	} else {
		console.log('[gskill] Skipping initial skill generation (--no-initial-skill).');
	}

	// 3. Run GEPA optimization
	const evaluator = makeEvaluator(config);
	const objective =
		`Maximize the resolve rate on software engineering tasks ` +
		`for the ${repoId.slug} repository. ` +
		`The skill should help the coding agent understand the repo's test commands, ` +
		`code structure, and common patterns.`;

	console.log(`[gskill] Starting GEPA optimization (max_evals=${config.maxEvals})...`);
	const result = await optimize(seedSkill, evaluator, train, val, config.maxEvals, objective);

	// 4. Save best skill
	const outPath = await saveSkill(result.bestSkill, repoId.slug, config.outputDir);
	console.log(`[gskill] Best resolve rate: ${(result.bestScore * 100).toFixed(1)}%`);
	console.log(`[gskill] Skill saved to: ${outPath}`);

	return result;
}

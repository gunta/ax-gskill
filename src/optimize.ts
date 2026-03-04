/** GEPA evolutionary optimization loop with ax-llm for reflection/mutation. */

import { ai } from '@ax-llm/ax';
import type { Candidate, Evaluator, OptimizeResult, SWESmithTask } from './types.js';

const REFLECTION_PROMPT = `You are an expert prompt engineer optimizing a SKILL.md file.
This skill is injected into a coding agent's system prompt to help it solve GitHub issues.

# Objective
Maximize the resolve rate on software engineering tasks for the target repository.
The skill should help the coding agent understand the repo's test commands,
code structure, and common patterns.

# Current Skill
{SKILL}

# Evaluation Results
The skill was tested on {N_TASKS} tasks with the following results:
- Average score: {AVG_SCORE}
- Tasks passed: {N_PASSED}/{N_TASKS}

Failed task details:
{FAILURE_DETAILS}

# Instructions
Analyze why the current skill is failing and produce an IMPROVED version.
Focus on:
1. Are test commands correct and specific enough?
2. Does it cover the right code structure and patterns?
3. Are there missing conventions or pitfalls?
4. Is the workflow advice actionable?

Output ONLY the improved SKILL.md content (including YAML frontmatter).
Do not include any other text, explanation, or markdown fencing.`;

/**
 * Run the GEPA evolutionary optimization loop.
 *
 * @param seed - Initial candidate skill (or empty string)
 * @param evaluator - Function that scores a skill on a task
 * @param trainTasks - Training tasks for evaluation
 * @param valTasks - Validation tasks for final scoring
 * @param maxEvals - Maximum number of evaluations
 * @param objective - Human-readable objective description
 */
export async function optimize(
	seed: string,
	evaluator: Evaluator,
	trainTasks: SWESmithTask[],
	valTasks: SWESmithTask[],
	maxEvals: number,
	objective: string,
): Promise<OptimizeResult> {
	// Initialize pool
	const pool: Candidate[] = [{ skill: seed, score: 0, evalCount: 0 }];
	let totalEvals = 0;
	let bestCandidate: Candidate = pool[0]!;

	// Create LLM for reflection/mutation
	const reflectionLlm = ai({
		name: 'anthropic',
		config: { model: 'claude-opus-4-6' },
	});

	console.log(`[gepa] Starting optimization (budget=${maxEvals}, pool=1, train=${trainTasks.length})`);

	// Evaluate seed candidate
	if (seed) {
		const seedResult = await evaluateOnMinibatch(evaluator, seed, trainTasks, 3);
		pool[0]!.score = seedResult.avgScore;
		pool[0]!.evalCount = seedResult.evalCount;
		totalEvals += seedResult.evalCount;
		bestCandidate = pool[0]!;
		console.log(`[gepa] Seed score: ${seedResult.avgScore.toFixed(2)} (${seedResult.evalCount} evals)`);
	}

	// Main optimization loop
	let generation = 0;
	while (totalEvals < maxEvals) {
		generation++;

		// Select parent (best candidate or random from pool)
		const parent = selectParent(pool);

		// Sample a minibatch of tasks
		const minibatchSize = Math.min(3, trainTasks.length);
		const minibatch = sampleMinibatch(trainTasks, minibatchSize);

		// Evaluate parent on this minibatch
		const parentResult = await evaluateOnMinibatch(evaluator, parent.skill, minibatch, minibatchSize);
		totalEvals += parentResult.evalCount;

		if (totalEvals >= maxEvals) break;

		// Reflect and mutate
		const mutant = await reflect(
			reflectionLlm,
			parent.skill,
			parentResult,
			objective,
		);

		if (!mutant || mutant === parent.skill) {
			console.log(`[gepa] Gen ${generation}: reflection produced no change, skipping`);
			continue;
		}

		// Evaluate mutant on same minibatch
		const mutantResult = await evaluateOnMinibatch(evaluator, mutant, minibatch, minibatchSize);
		totalEvals += mutantResult.evalCount;

		console.log(
			`[gepa] Gen ${generation}: parent=${parentResult.avgScore.toFixed(2)} ` +
				`mutant=${mutantResult.avgScore.toFixed(2)} total_evals=${totalEvals}`,
		);

		// Keep if improved
		if (mutantResult.avgScore >= parentResult.avgScore) {
			const newCandidate: Candidate = {
				skill: mutant,
				score: mutantResult.avgScore,
				evalCount: mutantResult.evalCount,
			};
			pool.push(newCandidate);

			if (mutantResult.avgScore > bestCandidate.score) {
				bestCandidate = newCandidate;
				console.log(`[gepa] New best! score=${mutantResult.avgScore.toFixed(2)}`);
			}
		}

		// Prune pool to top 5
		pool.sort((a, b) => b.score - a.score);
		while (pool.length > 5) pool.pop();
	}

	// Validate best candidates on validation set
	if (valTasks.length > 0 && bestCandidate.skill) {
		console.log(`[gepa] Validating best candidate on ${valTasks.length} val tasks...`);
		const valResult = await evaluateOnMinibatch(
			evaluator,
			bestCandidate.skill,
			valTasks,
			valTasks.length,
		);
		console.log(`[gepa] Validation score: ${valResult.avgScore.toFixed(2)}`);
		bestCandidate.score = valResult.avgScore;
	}

	return {
		bestSkill: bestCandidate.skill,
		bestScore: bestCandidate.score,
		totalEvals,
	};
}

/** Evaluate a skill on a minibatch of tasks, returning average score. */
async function evaluateOnMinibatch(
	evaluator: Evaluator,
	skill: string,
	tasks: SWESmithTask[],
	n: number,
): Promise<{
	avgScore: number;
	evalCount: number;
	details: Array<{ instanceId: string; score: number; reason: string }>;
}> {
	const batch = tasks.slice(0, n);
	const details: Array<{ instanceId: string; score: number; reason: string }> = [];
	let totalScore = 0;

	for (const task of batch) {
		try {
			const [score, info] = await evaluator(skill, task);
			totalScore += score;
			details.push({
				instanceId: info.instance_id,
				score,
				reason: info.test_failure_reason,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			details.push({
				instanceId: task.instance_id,
				score: 0,
				reason: `eval_error: ${msg}`,
			});
		}
	}

	return {
		avgScore: batch.length > 0 ? totalScore / batch.length : 0,
		evalCount: batch.length,
		details,
	};
}

/** Select the best candidate from the pool. */
function selectParent(pool: Candidate[]): Candidate {
	if (pool.length === 1) return pool[0]!;

	// 70% chance of picking the best, 30% random from top 3
	if (Math.random() < 0.7) {
		return pool.reduce((a, b) => (a.score >= b.score ? a : b));
	}

	const topK = pool
		.slice()
		.sort((a, b) => b.score - a.score)
		.slice(0, 3);
	return topK[Math.floor(Math.random() * topK.length)]!;
}

/** Sample a random minibatch of tasks. */
function sampleMinibatch(tasks: SWESmithTask[], size: number): SWESmithTask[] {
	const shuffled = tasks.slice().sort(() => Math.random() - 0.5);
	return shuffled.slice(0, size);
}

/** Use ax-llm to reflect on failures and produce an improved skill. */
async function reflect(
	llm: ReturnType<typeof ai>,
	currentSkill: string,
	evalResult: {
		avgScore: number;
		evalCount: number;
		details: Array<{ instanceId: string; score: number; reason: string }>;
	},
	objective: string,
): Promise<string> {
	const nPassed = evalResult.details.filter((d) => d.score > 0).length;
	const failureDetails = evalResult.details
		.filter((d) => d.score === 0)
		.map((d) => `- ${d.instanceId}: ${d.reason}`)
		.join('\n');

	const prompt = REFLECTION_PROMPT.replace('{SKILL}', currentSkill || '(empty - no skill yet)')
		.replace('{N_TASKS}', String(evalResult.evalCount))
		.replace('{AVG_SCORE}', evalResult.avgScore.toFixed(2))
		.replace('{N_PASSED}', String(nPassed))
		.replace('{FAILURE_DETAILS}', failureDetails || '(no detailed failure info available)')
		+ `\n\nObjective: ${objective}`;

	try {
		const response = await llm.chat({
			chatPrompt: [{ role: 'user' as const, content: prompt }],
			maxTokens: 3000,
		});

		const results = (response as { results?: Array<{ content?: string }> }).results;
		const content = results?.[0]?.content;

		if (!content) return currentSkill;

		// Strip any markdown fencing if present
		let cleaned = content.trim();
		if (cleaned.startsWith('```')) {
			cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
		}

		return cleaned;
	} catch (err) {
		console.warn(`[gepa] Reflection failed: ${err}`);
		return currentSkill;
	}
}

/** GEPA-compatible evaluator: combines agent + execution backend test verification. */

import { runAgent } from './agent.js';
import type { ExecutionBackend } from './backend.js';
import type { EvalInfo, Evaluator, PipelineConfig, SWESmithTask } from './types.js';

/**
 * Create a GEPA-compatible evaluator that runs the SWE agent on a task
 * and verifies the patch by running FAIL_TO_PASS tests.
 */
export function makeEvaluator(config: PipelineConfig, backend: ExecutionBackend): Evaluator {
	return async (skill: string, task: SWESmithTask): Promise<[number, EvalInfo]> => {
		const instanceId = task.instance_id ?? 'unknown';

		// Run the agent
		const { patch, error } = await runAgent(task, skill, config, backend);

		// If no patch was produced, score is 0
		if (!patch.trim()) {
			console.log(
				`[eval] instance=${instanceId} no patch submitted score=0.0${error ? `; agent error: ${error}` : ''}`,
			);
			return [
				0,
				{
					instance_id: instanceId,
					patch_chars: 0,
					score: 0,
					error,
					test_failure_reason: 'no_patch_submitted',
				},
			];
		}

		// Verify patch by running tests
		const result = await backend.runTests(task, patch);
		const score = result.passed ? 1 : 0;

		console.log(
			`[eval] instance=${instanceId} patch=${patch.length}chars ` +
				`tests=${result.passed ? 'passed' : 'failed'} reason=${result.reason} score=${score}`,
		);

		return [
			score,
			{
				instance_id: instanceId,
				patch_chars: patch.length,
				score,
				error,
				test_failure_reason: result.reason,
			},
		];
	};
}

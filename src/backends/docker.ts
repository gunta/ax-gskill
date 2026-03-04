/** Docker execution backend: runs commands inside SWE-smith Docker containers. */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecResult, ExecutionBackend } from '../backend.js';
import type { SWESmithTask, TestResult } from '../types.js';

/**
 * Get the Docker image name for a SWE-smith task.
 * Checks image_name first, then constructs from instance_id.
 */
export function getImageName(task: SWESmithTask): string {
	if (task.image_name) return task.image_name;

	// Fallback: construct from instance_id
	// SWE-smith format: swesmith/owner__repo.commithash
	const instanceId = task.instance_id;
	if (instanceId.includes('/')) {
		const [namespace, taggedRepo] = instanceId.split('/', 2);
		const repoTag = taggedRepo?.split('.')[0];
		if (namespace && repoTag) {
			return `${namespace}/${repoTag}`;
		}
	}

	return task.repo || instanceId;
}

export class DockerBackend implements ExecutionBackend {
	async start(task: SWESmithTask): Promise<string> {
		const imageName = getImageName(task);
		const proc = Bun.spawn(['docker', 'run', '-d', '--rm', imageName, 'sleep', '3600'], {
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			throw new Error(`Failed to start Docker container (image=${imageName}): ${stderr.trim()}`);
		}

		return stdout.trim().slice(0, 12);
	}

	async exec(sessionId: string, cmd: string, timeoutMs = 120_000): Promise<ExecResult> {
		const proc = Bun.spawn(['docker', 'exec', sessionId, 'bash', '-c', cmd], {
			stdout: 'pipe',
			stderr: 'pipe',
		});

		const result = await Promise.race([
			(async () => {
				const stdout = await new Response(proc.stdout).text();
				const stderr = await new Response(proc.stderr).text();
				const exitCode = await proc.exited;
				return { stdout, stderr, exitCode };
			})(),
			new Promise<never>((_, reject) =>
				setTimeout(() => {
					proc.kill();
					reject(new Error(`Docker exec timed out after ${timeoutMs}ms`));
				}, timeoutMs),
			),
		]);

		return result;
	}

	async stop(sessionId: string): Promise<void> {
		try {
			const proc = Bun.spawn(['docker', 'kill', sessionId], {
				stdout: 'pipe',
				stderr: 'pipe',
			});
			await proc.exited;
		} catch {
			// Container may already be stopped
		}
	}

	async runTests(task: SWESmithTask, patch: string): Promise<TestResult> {
		const failToPass = task.FAIL_TO_PASS ?? [];
		if (failToPass.length === 0) {
			return { passed: false, reason: 'no_fail_to_pass_tests' };
		}

		const imageName = getImageName(task);

		// Write patch to temp file
		const patchFile = join(tmpdir(), `gskill-patch-${Date.now()}.patch`);
		await Bun.write(patchFile, patch);

		// Limit to 10 tests to keep evaluation fast
		const testIds = failToPass.slice(0, 10);
		const testArgs = testIds.map((t) => `"${t}"`).join(' ');

		const testCmd = [
			'cd /testbed',
			'git apply /tmp/solution.patch 2>/dev/null || patch -p1 < /tmp/solution.patch 2>/dev/null',
			`python -m pytest ${testArgs} -x --tb=no -q 2>&1`,
		].join(' && ');

		try {
			const proc = Bun.spawn(
				[
					'docker',
					'run',
					'--rm',
					'-v',
					`${patchFile}:/tmp/solution.patch:ro`,
					imageName,
					'bash',
					'-c',
					testCmd,
				],
				{
					stdout: 'pipe',
					stderr: 'pipe',
				},
			);

			const result = await Promise.race([
				(async () => {
					const stdout = await new Response(proc.stdout).text();
					const stderr = await new Response(proc.stderr).text();
					const exitCode = await proc.exited;
					return { stdout, stderr, exitCode };
				})(),
				new Promise<never>((_, reject) =>
					setTimeout(() => {
						proc.kill();
						reject(new Error('test_timeout'));
					}, 180_000),
				),
			]);

			const passed = result.exitCode === 0;
			return {
				passed,
				reason: passed ? 'tests_passed' : 'tests_failed',
				stdout: result.stdout.slice(-500),
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === 'test_timeout') {
				return { passed: false, reason: 'test_timeout' };
			}
			return { passed: false, reason: `docker_error: ${msg}` };
		} finally {
			try {
				const { unlinkSync } = await import('node:fs');
				unlinkSync(patchFile);
			} catch {
				// ignore
			}
		}
	}
}

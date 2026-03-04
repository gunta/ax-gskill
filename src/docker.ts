/** Docker container lifecycle: spawn, exec, test. */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SWESmithTask, TestResult } from './types.js';

/**
 * Start a Docker container from the given image, returning its container ID.
 */
export async function startContainer(imageName: string): Promise<string> {
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

/**
 * Execute a bash command inside a running container.
 */
export async function dockerExec(
	containerId: string,
	cmd: string,
	timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(['docker', 'exec', containerId, 'bash', '-c', cmd], {
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

/**
 * Stop and remove a running container.
 */
export async function stopContainer(containerId: string): Promise<void> {
	try {
		const proc = Bun.spawn(['docker', 'kill', containerId], {
			stdout: 'pipe',
			stderr: 'pipe',
		});
		await proc.exited;
	} catch {
		// Container may already be stopped
	}
}

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
		return instanceId.split('/')[0] + '/' + instanceId.split('/')[1]?.split('.')[0];
	}

	return task.repo || instanceId;
}

/**
 * Apply a patch and run FAIL_TO_PASS tests in a fresh Docker container.
 */
export async function runTests(task: SWESmithTask, patch: string): Promise<TestResult> {
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
		// Clean up temp patch file
		try {
			const { unlinkSync } = await import('node:fs');
			unlinkSync(patchFile);
		} catch {
			// ignore
		}
	}
}

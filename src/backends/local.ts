/** Local execution backend: clones repos and runs commands directly via shell. */

import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExecResult, ExecutionBackend } from '../backend.js';
import type { SWESmithTask, TestResult } from '../types.js';

const CACHE_DIR = join(homedir(), '.cache', 'ax-gskill');
const REPOS_DIR = join(CACHE_DIR, 'repos');
const SESSIONS_DIR = join(CACHE_DIR, 'sessions');

/** Extract the base commit hash from a SWE-smith instance_id. */
function extractCommitHash(instanceId: string): string | null {
	// Format: swesmith/owner__repo.<hash>
	const dotIndex = instanceId.lastIndexOf('.');
	if (dotIndex === -1) return null;
	const hash = instanceId.slice(dotIndex + 1);
	return hash.length >= 6 ? hash : null;
}

/** Run a shell command and return its result. */
async function spawn(
	args: string[],
	opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ExecResult> {
	const proc = Bun.spawn(args, {
		stdout: 'pipe',
		stderr: 'pipe',
		cwd: opts.cwd,
	});

	const timeoutMs = opts.timeoutMs ?? 120_000;

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
				reject(new Error(`Command timed out after ${timeoutMs}ms`));
			}, timeoutMs),
		),
	]);

	return result;
}

export class LocalBackend implements ExecutionBackend {
	async start(task: SWESmithTask): Promise<string> {
		const repo = task.repo;
		if (!repo) {
			throw new Error('LocalBackend requires task.repo to be set (e.g. "pallets/jinja")');
		}

		// Ensure cache directories exist
		await mkdir(REPOS_DIR, { recursive: true });
		await mkdir(SESSIONS_DIR, { recursive: true });

		const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const sessionDir = join(SESSIONS_DIR, sessionId);
		await mkdir(sessionDir, { recursive: true });

		const repoDir = join(sessionDir, 'repo');

		// Check for cached bare repo
		const bareDir = join(REPOS_DIR, `${repo.replace('/', '__')}.git`);
		const repoUrl = `https://github.com/${repo}.git`;

		if (existsSync(bareDir)) {
			// Clone from local cache (fast)
			await spawn(['git', 'clone', '--shared', bareDir, repoDir]);
			// Fetch latest just in case
			await spawn(['git', 'fetch', 'origin'], { cwd: repoDir });
		} else {
			// First time: clone bare for caching, then clone from it
			await spawn(['git', 'clone', '--bare', repoUrl, bareDir], { timeoutMs: 300_000 });
			await spawn(['git', 'clone', '--shared', bareDir, repoDir]);
		}

		// Checkout the base commit if extractable from instance_id
		const commitHash = extractCommitHash(task.instance_id);
		if (commitHash) {
			const result = await spawn(['git', 'checkout', commitHash], { cwd: repoDir });
			if (result.exitCode !== 0) {
				console.warn(
					`[local] Warning: could not checkout ${commitHash}, staying on default branch`,
				);
			}
		}

		// Best-effort: set up Python venv and install deps
		await this.setupPythonEnv(repoDir);

		return sessionId;
	}

	async exec(sessionId: string, cmd: string, timeoutMs = 120_000): Promise<ExecResult> {
		const repoDir = join(SESSIONS_DIR, sessionId, 'repo');
		const venvActivate = join(SESSIONS_DIR, sessionId, 'venv', 'bin', 'activate');

		// Prepend venv activation if it exists
		const wrappedCmd = existsSync(venvActivate)
			? `source ${venvActivate} && cd ${repoDir} && ${cmd}`
			: `cd ${repoDir} && ${cmd}`;

		return spawn(['bash', '-c', wrappedCmd], { cwd: repoDir, timeoutMs });
	}

	async stop(sessionId: string): Promise<void> {
		const sessionDir = join(SESSIONS_DIR, sessionId);
		try {
			await rm(sessionDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}

	async runTests(task: SWESmithTask, patch: string): Promise<TestResult> {
		const failToPass = task.FAIL_TO_PASS ?? [];
		if (failToPass.length === 0) {
			return { passed: false, reason: 'no_fail_to_pass_tests' };
		}

		// Start a fresh session for test verification
		let sessionId = '';
		try {
			sessionId = await this.start(task);
			const repoDir = join(SESSIONS_DIR, sessionId, 'repo');

			// Write patch to file
			const patchFile = join(SESSIONS_DIR, sessionId, 'solution.patch');
			await writeFile(patchFile, patch);

			// Apply patch
			const applyResult = await this.exec(
				sessionId,
				`git apply ${patchFile} 2>/dev/null || patch -p1 < ${patchFile} 2>/dev/null`,
			);

			// Limit to 10 tests
			const testIds = failToPass.slice(0, 10);
			const testArgs = testIds.map((t) => `"${t}"`).join(' ');

			// Run tests
			const testResult = await this.exec(
				sessionId,
				`python -m pytest ${testArgs} -x --tb=no -q 2>&1`,
				180_000,
			);

			const passed = testResult.exitCode === 0;
			return {
				passed,
				reason: passed ? 'tests_passed' : 'tests_failed',
				stdout: testResult.stdout.slice(-500),
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('timed out')) {
				return { passed: false, reason: 'test_timeout' };
			}
			return { passed: false, reason: `local_error: ${msg}` };
		} finally {
			if (sessionId) {
				await this.stop(sessionId);
			}
		}
	}

	private async setupPythonEnv(repoDir: string): Promise<void> {
		const sessionDir = join(repoDir, '..');
		const venvDir = join(sessionDir, 'venv');

		try {
			// Create venv
			const venvResult = await spawn(['python3', '-m', 'venv', venvDir], {
				cwd: repoDir,
				timeoutMs: 30_000,
			});
			if (venvResult.exitCode !== 0) return;

			const pip = join(venvDir, 'bin', 'pip');

			// Install the project in editable mode with dev/test extras
			await spawn([pip, 'install', '-e', '.[dev,test]'], {
				cwd: repoDir,
				timeoutMs: 300_000,
			});
		} catch {
			// Best-effort — don't fail the session if Python setup fails
		}
	}
}

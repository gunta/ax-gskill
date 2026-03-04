/** Pluggable execution backend interface + factory. */

import type { SWESmithTask, TestResult } from './types.js';

export interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * An execution backend abstracts how commands are run against a repository.
 * Implementations include Docker (SWE-smith images) and Local (git clone + shell).
 */
export interface ExecutionBackend {
	/** Prepare a session for the given task, returning a session ID. */
	start(task: SWESmithTask): Promise<string>;
	/** Execute a bash command inside the session. */
	exec(sessionId: string, cmd: string, timeoutMs?: number): Promise<ExecResult>;
	/** Tear down the session and clean up resources. */
	stop(sessionId: string): Promise<void>;
	/** Apply a patch and run FAIL_TO_PASS tests, returning the result. */
	runTests(task: SWESmithTask, patch: string): Promise<TestResult>;
}

export type BackendType = 'local' | 'docker';

/**
 * Instantiate the requested execution backend.
 */
export async function createBackend(type: BackendType): Promise<ExecutionBackend> {
	switch (type) {
		case 'docker': {
			const { DockerBackend } = await import('./backends/docker.js');
			return new DockerBackend();
		}
		case 'local': {
			const { LocalBackend } = await import('./backends/local.js');
			return new LocalBackend();
		}
		default:
			throw new Error(`Unknown backend type: ${type}`);
	}
}

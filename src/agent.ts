/** Lightweight SWE agent: ax-llm chat loop + pluggable execution backend. */

import type { AxChatRequest } from '@ax-llm/ax';
import type { ExecutionBackend } from './backend.js';
import { createLlm } from './llm.js';
import type { AgentResult, PipelineConfig, SWESmithTask } from './types.js';

const MAX_TURNS = 30;
const MAX_TOOL_STDOUT_CHARS = 8000;
const MAX_TOOL_STDERR_CHARS = 2000;

const SYSTEM_PREFIX =
	'You are a helpful assistant that can interact with a computer shell ' +
	'to solve programming tasks.\n\n' +
	'# Repository-Specific Knowledge\n\n';

const AGENT_INSTRUCTIONS = `

# Instructions

You are working in a repository checkout.
Your goal is to fix the issue described in the problem statement by modifying source files.

You have access to a \`bash\` tool that lets you run shell commands in the repository.
Use it to:
1. Explore the repository structure
2. Understand the codebase and find relevant files
3. Make targeted edits to fix the issue
4. Verify your fix by running relevant tests

When you are done, just stop calling tools. Your changes will be captured via \`git diff\`.

Important guidelines:
- Make minimal, focused changes. Don't rewrite entire files.
- Use \`find\`, \`grep\`, and \`cat\` to understand code before editing.
- Use \`sed\` or \`python -c\` for precise edits.
- Run tests after making changes to verify the fix.
- If tests fail, analyze the output and iterate.
`;

/** Bash tool descriptor exposed to the model. */
const bashTool = {
	name: 'bash',
	description: 'Run a bash command in the repository. Returns stdout, stderr, and exit code.',
	parameters: {
		type: 'object' as const,
		properties: {
			command: {
				type: 'string',
				description: 'The bash command to execute',
			},
		},
		required: ['command'],
	},
};

function parseBashCommand(params: string | object | undefined): string | null {
	let parsed: unknown = params ?? {};

	if (typeof params === 'string') {
		try {
			parsed = JSON.parse(params);
		} catch {
			return null;
		}
	}

	if (!parsed || typeof parsed !== 'object') {
		return null;
	}

	const command = (parsed as Record<string, unknown>).command;
	return typeof command === 'string' && command.trim() ? command : null;
}

function renderToolResult(result: { stdout: string; stderr: string; exitCode: number }): string {
	return (
		`Exit code: ${result.exitCode}\n` +
		`Stdout:\n${result.stdout.slice(0, MAX_TOOL_STDOUT_CHARS)}\n` +
		`Stderr:\n${result.stderr.slice(0, MAX_TOOL_STDERR_CHARS)}`
	);
}

/**
 * Run the lightweight SWE agent on a task with the given skill injected.
 */
export async function runAgent(
	task: SWESmithTask,
	skill: string,
	config: PipelineConfig,
	backend: ExecutionBackend,
): Promise<AgentResult> {
	let sessionId = '';

	try {
		// 1. Start execution session
		sessionId = await backend.start(task);

		// 2. Build system prompt
		const systemPrompt = SYSTEM_PREFIX + skill + AGENT_INSTRUCTIONS;

		// 3. Create LLM instance
		const llm = createLlm({
			provider: config.agentProvider,
			model: config.agentModel,
			baseUrl: config.baseUrl,
		});

		// 4. Message history
		const messages: AxChatRequest['chatPrompt'] = [
			{ role: 'system', content: systemPrompt },
			{
				role: 'user',
				content: `Please fix the following issue:\n\n${task.problem_statement}`,
			},
		];

		// 5. Agent loop
		for (let turn = 0; turn < MAX_TURNS; turn++) {
			const response = await llm.chat({
				chatPrompt: messages,
				functions: [bashTool],
			});

			if (response instanceof ReadableStream) {
				throw new Error('Unexpected streaming response from llm.chat');
			}

			const firstResult = response.results[0];
			const content = firstResult?.content ?? '';
			const functionCalls = firstResult?.functionCalls ?? [];

			if (content || functionCalls.length > 0) {
				messages.push({
					role: 'assistant',
					content: content || undefined,
					functionCalls: functionCalls.length > 0 ? [...functionCalls] : undefined,
				});
			}

			// If no function calls were made, the model is done.
			if (functionCalls.length === 0) {
				break;
			}

			// Execute requested tools and append function results.
			for (const call of functionCalls) {
				if (call.function.name !== 'bash') {
					messages.push({
						role: 'function',
						functionId: call.id,
						isError: true,
						result: `Unknown function: ${call.function.name}`,
					});
					continue;
				}

				const command = parseBashCommand(call.function.params);
				if (!command) {
					messages.push({
						role: 'function',
						functionId: call.id,
						isError: true,
						result:
							'Invalid bash tool arguments. Expected JSON/object with string field "command".',
					});
					continue;
				}

				try {
					const result = await backend.exec(sessionId, command);
					messages.push({
						role: 'function',
						functionId: call.id,
						result: renderToolResult(result),
					});
				} catch (err) {
					const msg =
						err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
					messages.push({
						role: 'function',
						functionId: call.id,
						isError: true,
						result: `bash tool failed: ${msg}`,
					});
				}
			}
		}

		// 6. Extract patch via git diff
		const diffResult = await backend.exec(sessionId, 'git diff');
		return { patch: diffResult.stdout, error: '' };
	} catch (err) {
		const error = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
		return { patch: '', error };
	} finally {
		// 7. Cleanup
		if (sessionId) {
			await backend.stop(sessionId);
		}
	}
}

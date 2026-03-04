/** Lightweight SWE agent: ax-llm chat loop + Docker bash tool. */

import { ai } from '@ax-llm/ax';
import { dockerExec, startContainer, stopContainer } from './docker.js';
import type { AgentResult, PipelineConfig, SWESmithTask } from './types.js';

const MAX_TURNS = 30;

const SYSTEM_PREFIX =
	'You are a helpful assistant that can interact with a computer shell ' +
	'to solve programming tasks.\n\n' +
	'# Repository-Specific Knowledge\n\n';

const AGENT_INSTRUCTIONS = `

# Instructions

You are working in a Docker container at /testbed, which contains a git repository.
Your goal is to fix the issue described in the problem statement by modifying source files.

You have access to a \`bash\` tool that lets you run shell commands in the container.
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

/** The bash tool definition for function calling. */
const bashTool = {
	name: 'bash',
	description:
		'Run a bash command in the Docker container. Returns stdout, stderr, and exit code.',
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

/**
 * Run the lightweight SWE agent on a task with the given skill injected.
 */
export async function runAgent(
	task: SWESmithTask,
	skill: string,
	config: PipelineConfig,
): Promise<AgentResult> {
	const imageName = task.image_name || task.repo || task.instance_id;
	let containerId = '';

	try {
		// 1. Start Docker container
		containerId = await startContainer(imageName);

		// 2. Build system prompt
		const systemPrompt = SYSTEM_PREFIX + skill + AGENT_INSTRUCTIONS;

		// 3. Create LLM instance
		const llmConfig: Record<string, unknown> = {
			model: config.agentModel,
		};
		if (config.baseUrl) {
			llmConfig.baseURL = config.baseUrl;
		}

		const llm = ai({
			name: config.agentProvider as 'openai' | 'anthropic',
			config: llmConfig as { model: string },
		});

		// 4. Message history
		type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'function'; content: string; name?: string };
		const messages: ChatMessage[] = [
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
				functions: [
					{
						...bashTool,
						func: async ({ command }: { command: string }) => {
							const result = await dockerExec(containerId, command);
							return `Exit code: ${result.exitCode}\nStdout:\n${result.stdout.slice(0, 8000)}\nStderr:\n${result.stderr.slice(0, 2000)}`;
						},
					},
				],
			});

			// Extract response content
			const results = (response as { results?: Array<{ content?: string; functionCalls?: unknown[] }> }).results;
			const firstResult = results?.[0];
			const content = firstResult?.content ?? '';

			// Check if the model made function calls — ax-llm handles this internally
			// via the func callbacks we provided. If it returned content without
			// function calls, the agent is done.
			const hasFunctionCalls = firstResult?.functionCalls && (firstResult.functionCalls as unknown[]).length > 0;

			if (content) {
				messages.push({ role: 'assistant', content });
			}

			// If no function calls were made, agent is done
			if (!hasFunctionCalls && content) {
				break;
			}
		}

		// 6. Extract patch via git diff
		const diffResult = await dockerExec(containerId, 'cd /testbed && git diff');
		return { patch: diffResult.stdout, error: '' };
	} catch (err) {
		const error = err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err);
		return { patch: '', error };
	} finally {
		// 7. Cleanup
		if (containerId) {
			await stopContainer(containerId);
		}
	}
}

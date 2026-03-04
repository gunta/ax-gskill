/** Initial skill generation via ax-llm + GitHub API fetching. */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLlm } from './llm.js';
import type { PipelineConfig } from './types.js';

/**
 * Sanitize a repo short name into a valid skill name.
 * Rules: lowercase, only [a-z0-9-], collapse/strip hyphens, max 64 chars.
 */
export function makeSkillName(repo: string): string {
	let name = repo.toLowerCase();
	name = name.replace(/[^a-z0-9]+/g, '-');
	name = name.replace(/^-+|-+$/g, '');
	return name.slice(0, 64);
}

/** Fetch the README from GitHub API. */
async function fetchReadme(owner: string, repo: string, maxChars = 3000): Promise<string> {
	const url = `https://api.github.com/repos/${owner}/${repo}/readme`;
	try {
		const resp = await fetch(url, {
			headers: { 'User-Agent': 'ax-gskill/0.1' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!resp.ok) return '';
		const data = (await resp.json()) as { content: string };
		const content = atob(data.content.replace(/\n/g, ''));
		return content.slice(0, maxChars);
	} catch {
		return '';
	}
}

/** Fetch a specific file from GitHub API. */
async function fetchFile(
	owner: string,
	repo: string,
	path: string,
	maxChars = 2000,
): Promise<string> {
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
	try {
		const resp = await fetch(url, {
			headers: { 'User-Agent': 'ax-gskill/0.1' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!resp.ok) return '';
		const data = (await resp.json()) as { encoding?: string; content?: string };
		if (data.encoding === 'base64' && data.content) {
			const content = atob(data.content.replace(/\n/g, ''));
			return content.slice(0, maxChars);
		}
	} catch {
		// ignore
	}
	return '';
}

/**
 * Generate an initial SKILL.md for a repo via static analysis + LLM.
 */
export async function generateInitialSkill(
	repoUrl: string,
	config: PipelineConfig,
): Promise<string> {
	// Parse owner/repo from URL
	const parts = repoUrl.replace(/\/+$/, '').split('/');
	const owner = parts[parts.length - 2]!;
	const repo = parts[parts.length - 1]!;
	const skillName = makeSkillName(repo);

	const readme = await fetchReadme(owner, repo);

	// Try to grab common config files for test/build info
	let extraContext = '';
	for (const candidate of ['pyproject.toml', 'setup.cfg', 'tox.ini', 'Makefile', 'pytest.ini']) {
		const content = await fetchFile(owner, repo, candidate, 1500);
		if (content) {
			extraContext += `\n\n### ${candidate}\n\`\`\`\n${content}\n\`\`\``;
			break; // one is enough
		}
	}

	const llm = createLlm({
		provider: config.skillProvider,
		model: config.skillModel,
		baseUrl: config.baseUrl,
	});

	const prompt = `You are generating a SKILL.md for the '${repo}' repository.
This skill file will be injected into the system prompt of a coding agent that must
solve GitHub issues by modifying source files in a repository checkout.

Repository URL: ${repoUrl}

README (may be truncated):
${readme}
${extraContext}

Output a complete SKILL.md starting with YAML frontmatter, then the body. Use exactly this structure:

---
name: ${skillName}
description: <one-sentence description, max 1024 characters, no angle-bracket XML tags, stating what the skill covers and when to use it>
---

<body: 400-800 words covering the five sections below>

The body must cover:

1. **Test commands**: The exact command(s) to run the test suite (e.g., \`pytest\`, \`tox\`, \`make test\`).
   If there are relevant flags or test file patterns, include them.
2. **Code structure**: Key directories and files an agent should know about.
3. **Conventions**: Code style, naming patterns, or idioms specific to this project.
4. **Common pitfalls**: Mistakes an agent typically makes on this repo and how to avoid them.
5. **Workflow**: Recommended steps to diagnose and fix an issue (reproduce, patch, verify).

Constraints:
- The \`name\` field must be exactly: ${skillName}
- The \`description\` must be non-empty, at most 1024 characters, and must not contain angle-bracket XML tags.
- Be specific and actionable. Write for an AI agent, not a human developer.
- Do NOT include generic advice that applies to all Python projects.
- Focus on what is distinctive about ${repo}.`;

	const response = await llm.chat({
		chatPrompt: [{ role: 'user' as const, content: prompt }],
		modelConfig: { maxTokens: 2000 },
	});

	if (response instanceof ReadableStream) {
		throw new Error('Skill generation failed — model returned an unexpected stream');
	}

	if (!response || typeof response !== 'object') {
		throw new Error('Skill generation failed — model returned an empty response');
	}

	// Extract text content from response
	const content = response.results[0]?.content;

	if (!content) {
		throw new Error(
			`Skill generation failed — model '${config.skillModel}' returned no text content`,
		);
	}

	return content;
}

/**
 * Write skill to {outputDir}/{shortRepoName}/SKILL.md.
 */
export async function saveSkill(
	skill: string,
	repoName: string,
	outputDir = '.claude/skills',
): Promise<string> {
	const shortName = repoName.split('/').pop()!;
	const dir = join(outputDir, shortName);
	await mkdir(dir, { recursive: true });
	const filePath = join(dir, 'SKILL.md');
	await Bun.write(filePath, skill);
	return filePath;
}

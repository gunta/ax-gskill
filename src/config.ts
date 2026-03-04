/** Configuration resolution: CLI flags → env vars → defaults. */

import type { PipelineConfig, RepoId } from './types.js';

const DEFAULT_AGENT_MODEL = 'anthropic/claude-sonnet-4-20250514';
const DEFAULT_SKILL_MODEL = 'anthropic/claude-opus-4-6';

/**
 * Parse a "provider/model" string into { provider, model }.
 * If no slash, assumes the whole string is the model name and provider is "openai".
 */
export function parseModelString(input: string): { provider: string; model: string } {
	if (input.includes('/')) {
		const [provider, ...rest] = input.split('/');
		return { provider: provider!, model: rest.join('/') };
	}
	return { provider: 'openai', model: input };
}

/**
 * Extract RepoId from a GitHub URL or "owner/repo" string.
 */
export function parseRepoUrl(repoUrl: string): RepoId {
	const cleaned = repoUrl.replace(/\/+$/, '');

	let owner: string;
	let repo: string;

	if (cleaned.includes('github.com')) {
		const parts = cleaned.split('github.com/')[1]!.split('/');
		owner = parts[0]!;
		repo = parts[1]!;
	} else if (cleaned.includes('/')) {
		const parts = cleaned.split('/');
		owner = parts[0]!;
		repo = parts[1]!;
	} else {
		throw new Error(`Cannot parse repo URL: ${repoUrl}. Use "owner/repo" or a full GitHub URL.`);
	}

	return {
		owner,
		repo,
		slug: `${owner}/${repo}`,
		datasetSlug: `${owner}__${repo}`,
	};
}

/**
 * Resolve full pipeline config from CLI options.
 * Fallback chain: CLI flag → env var → default.
 */
export function resolveConfig(opts: {
	repoUrl: string;
	outputDir?: string;
	maxEvals?: number;
	noInitialSkill?: boolean;
	agentModel?: string;
	skillModel?: string;
	baseUrl?: string;
	backend?: string;
}): PipelineConfig {
	const agentModelStr = opts.agentModel || process.env.GSKILL_AGENT_MODEL || DEFAULT_AGENT_MODEL;
	const skillModelStr = opts.skillModel || process.env.GSKILL_SKILL_MODEL || DEFAULT_SKILL_MODEL;
	const baseUrl = opts.baseUrl || process.env.OPENAI_BASE_URL || undefined;
	const backendStr = opts.backend || process.env.GSKILL_BACKEND || 'local';

	if (backendStr !== 'local' && backendStr !== 'docker') {
		throw new Error(`Invalid backend '${backendStr}'. Must be 'local' or 'docker'.`);
	}

	const agent = parseModelString(agentModelStr);
	const skill = parseModelString(skillModelStr);

	return {
		repoUrl: opts.repoUrl,
		outputDir: opts.outputDir ?? '.claude/skills',
		maxEvals: opts.maxEvals ?? 150,
		useInitialSkill: !opts.noInitialSkill,
		agentModel: agent.model,
		agentProvider: agent.provider,
		skillModel: skill.model,
		skillProvider: skill.provider,
		baseUrl,
		backend: backendStr,
	};
}

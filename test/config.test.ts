import { describe, expect, test } from 'bun:test';
import { parseModelString, parseRepoUrl, resolveConfig } from '../src/config.js';

describe('parseModelString', () => {
	test('splits provider/model', () => {
		expect(parseModelString('openai/gpt-4o')).toEqual({
			provider: 'openai',
			model: 'gpt-4o',
		});
	});

	test('splits anthropic/claude-opus-4-6', () => {
		expect(parseModelString('anthropic/claude-opus-4-6')).toEqual({
			provider: 'anthropic',
			model: 'claude-opus-4-6',
		});
	});

	test('defaults to openai provider when no slash', () => {
		expect(parseModelString('gpt-4o')).toEqual({
			provider: 'openai',
			model: 'gpt-4o',
		});
	});

	test('handles nested slashes in model name', () => {
		expect(parseModelString('azure/gpt-4/turbo')).toEqual({
			provider: 'azure',
			model: 'gpt-4/turbo',
		});
	});
});

describe('parseRepoUrl', () => {
	test('parses full GitHub URL', () => {
		const result = parseRepoUrl('https://github.com/pallets/jinja');
		expect(result).toEqual({
			owner: 'pallets',
			repo: 'jinja',
			slug: 'pallets/jinja',
			datasetSlug: 'pallets__jinja',
		});
	});

	test('parses GitHub URL with trailing slash', () => {
		const result = parseRepoUrl('https://github.com/pallets/jinja/');
		expect(result).toEqual({
			owner: 'pallets',
			repo: 'jinja',
			slug: 'pallets/jinja',
			datasetSlug: 'pallets__jinja',
		});
	});

	test('parses owner/repo format', () => {
		const result = parseRepoUrl('pallets/jinja');
		expect(result).toEqual({
			owner: 'pallets',
			repo: 'jinja',
			slug: 'pallets/jinja',
			datasetSlug: 'pallets__jinja',
		});
	});

	test('throws on bare repo name', () => {
		expect(() => parseRepoUrl('jinja')).toThrow('Cannot parse repo URL');
	});
});

describe('resolveConfig', () => {
	test('uses defaults', () => {
		const config = resolveConfig({ repoUrl: 'pallets/jinja' });
		expect(config.outputDir).toBe('.claude/skills');
		expect(config.maxEvals).toBe(150);
		expect(config.useInitialSkill).toBe(true);
	});

	test('respects CLI overrides', () => {
		const config = resolveConfig({
			repoUrl: 'pallets/jinja',
			outputDir: '/tmp/skills',
			maxEvals: 50,
			noInitialSkill: true,
			agentModel: 'openai/gpt-4o',
		});
		expect(config.outputDir).toBe('/tmp/skills');
		expect(config.maxEvals).toBe(50);
		expect(config.useInitialSkill).toBe(false);
		expect(config.agentProvider).toBe('openai');
		expect(config.agentModel).toBe('gpt-4o');
	});
});

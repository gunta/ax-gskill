import { describe, expect, test } from 'bun:test';
import { makeSkillName } from '../src/skill.js';

describe('makeSkillName', () => {
	test('lowercases and hyphenates', () => {
		expect(makeSkillName('MyRepo')).toBe('myrepo');
	});

	test('replaces special chars with hyphens', () => {
		expect(makeSkillName('my_repo.name')).toBe('my-repo-name');
	});

	test('strips leading/trailing hyphens', () => {
		expect(makeSkillName('--hello--')).toBe('hello');
	});

	test('truncates to 64 chars', () => {
		const longName = 'a'.repeat(100);
		expect(makeSkillName(longName).length).toBe(64);
	});

	test('handles jinja', () => {
		expect(makeSkillName('jinja')).toBe('jinja');
	});

	test('collapses multiple special chars', () => {
		expect(makeSkillName('a___b...c')).toBe('a-b-c');
	});
});

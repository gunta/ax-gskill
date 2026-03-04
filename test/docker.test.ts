import { describe, expect, test } from 'bun:test';
import { getImageName } from '../src/docker.js';
import type { SWESmithTask } from '../src/types.js';

function makeTask(overrides: Partial<SWESmithTask> = {}): SWESmithTask {
	return {
		instance_id: 'swesmith/pallets__jinja.abc123',
		repo: 'pallets/jinja',
		patch: '',
		problem_statement: 'Fix something',
		FAIL_TO_PASS: ['test_foo'],
		PASS_TO_PASS: [],
		image_name: '',
		...overrides,
	};
}

describe('getImageName', () => {
	test('prefers image_name when set', () => {
		const task = makeTask({ image_name: 'custom-image:latest' });
		expect(getImageName(task)).toBe('custom-image:latest');
	});

	test('falls back to repo when no image_name', () => {
		const task = makeTask({ image_name: '', instance_id: 'test-instance' });
		expect(getImageName(task)).toBe('pallets/jinja');
	});
});

import { describe, expect, test } from 'bun:test';
import { splitTasks } from '../src/tasks.js';
import type { SWESmithTask } from '../src/types.js';

function makeTask(id: string): SWESmithTask {
	return {
		instance_id: id,
		repo: 'test/repo',
		patch: '',
		problem_statement: 'Fix something',
		FAIL_TO_PASS: ['test_foo'],
		PASS_TO_PASS: [],
		image_name: 'test-image',
	};
}

describe('splitTasks', () => {
	test('splits 100 tasks into 67/17/16', () => {
		const tasks = Array.from({ length: 100 }, (_, i) => makeTask(`task-${i}`));
		const { train, val, test: testSet } = splitTasks(tasks);
		expect(train.length).toBe(67);
		expect(val.length).toBe(17);
		expect(testSet.length).toBe(16);
	});

	test('splits 10 tasks correctly', () => {
		const tasks = Array.from({ length: 10 }, (_, i) => makeTask(`task-${i}`));
		const { train, val, test: testSet } = splitTasks(tasks);
		expect(train.length).toBe(6); // floor(10 * 0.67)
		expect(val.length).toBe(1); // floor(10 * 0.17)
		expect(testSet.length).toBe(3); // remainder
	});

	test('handles single task', () => {
		const tasks = [makeTask('only-one')];
		const { train, val, test: testSet } = splitTasks(tasks);
		expect(train.length).toBe(0);
		expect(val.length).toBe(0);
		expect(testSet.length).toBe(1);
	});

	test('handles empty list', () => {
		const { train, val, test: testSet } = splitTasks([]);
		expect(train.length).toBe(0);
		expect(val.length).toBe(0);
		expect(testSet.length).toBe(0);
	});

	test('preserves original order', () => {
		const tasks = Array.from({ length: 5 }, (_, i) => makeTask(`task-${i}`));
		const { train, val, test: testSet } = splitTasks(tasks);
		const all = [...train, ...val, ...testSet];
		expect(all.map((t) => t.instance_id)).toEqual(tasks.map((t) => t.instance_id));
	});
});

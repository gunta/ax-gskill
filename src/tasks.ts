/** SWE-smith dataset loading via HuggingFace Dataset Viewer API. */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SWESmithTask, TaskSplit } from './types.js';

const DATASET_ID = 'SWE-bench/SWE-smith';
const HF_API_BASE = 'https://datasets-server.huggingface.co';
const CACHE_DIR = join(homedir(), '.cache', 'ax-gskill');

/**
 * Load SWE-smith tasks filtered by repo slug.
 *
 * Uses HuggingFace Dataset Viewer API with local JSON caching.
 */
export async function loadTasks(repoName: string, n = 300): Promise<SWESmithTask[]> {
	const slug = repoName.replace('/', '__');

	// Try cache first
	const cached = await loadFromCache(slug);
	if (cached && cached.length > 0) {
		console.log(`[gskill] Loaded ${cached.length} cached tasks for '${repoName}'`);
		const filtered = cached.filter((t) => t.repo.includes(slug));
		if (filtered.length > 0) return filtered.slice(0, n);
	}

	console.log(`[gskill] Fetching tasks from HuggingFace for '${repoName}'...`);
	const tasks = await fetchFromHuggingFace(slug, n);

	if (tasks.length === 0) {
		throw new Error(
			`No tasks found for repo '${repoName}' in ${DATASET_ID}. Use the full 'owner/repo' format, e.g., 'pallets/jinja'.`,
		);
	}

	// Cache for future runs
	await saveToCache(slug, tasks);

	return tasks.slice(0, n);
}

/**
 * Fetch tasks from HuggingFace Dataset Viewer API with pagination.
 */
async function fetchFromHuggingFace(slug: string, maxTasks: number): Promise<SWESmithTask[]> {
	const tasks: SWESmithTask[] = [];
	let offset = 0;
	const pageSize = 100;

	// Use the search endpoint to filter by repo
	while (tasks.length < maxTasks) {
		const url = new URL(`${HF_API_BASE}/rows`);
		url.searchParams.set('dataset', DATASET_ID);
		url.searchParams.set('config', 'default');
		url.searchParams.set('split', 'train');
		url.searchParams.set('offset', String(offset));
		url.searchParams.set('length', String(pageSize));

		const resp = await fetch(url.toString(), {
			headers: { 'User-Agent': 'ax-gskill/0.1' },
		});

		if (!resp.ok) {
			// If we hit a rate limit or error, try the filter endpoint
			if (resp.status === 429) {
				console.log('[gskill] Rate limited, waiting 2s...');
				await new Promise((r) => setTimeout(r, 2000));
				continue;
			}
			throw new Error(`HuggingFace API error: ${resp.status} ${resp.statusText}`);
		}

		const data = (await resp.json()) as {
			rows: Array<{ row: Record<string, unknown> }>;
			num_rows_total: number;
		};

		if (!data.rows || data.rows.length === 0) break;

		for (const { row } of data.rows) {
			const repo = String(row.repo ?? '');
			if (repo.includes(slug)) {
				tasks.push(rowToTask(row));
			}
		}

		offset += data.rows.length;

		// Stop if we've scanned all rows
		if (offset >= data.num_rows_total) break;

		// Show progress for large datasets
		if (offset % 500 === 0) {
			console.log(
				`[gskill] Scanned ${offset}/${data.num_rows_total} rows, found ${tasks.length} matching tasks...`,
			);
		}
	}

	return tasks;
}

/** Convert a raw HuggingFace row to our typed task. */
function rowToTask(row: Record<string, unknown>): SWESmithTask {
	return {
		instance_id: String(row.instance_id ?? ''),
		repo: String(row.repo ?? ''),
		patch: String(row.patch ?? ''),
		problem_statement: String(row.problem_statement ?? ''),
		FAIL_TO_PASS: parseStringArray(row.FAIL_TO_PASS),
		PASS_TO_PASS: parseStringArray(row.PASS_TO_PASS),
		image_name: String(row.image_name ?? row.docker_image ?? ''),
	};
}

/** Parse a field that could be a JSON string array or already an array. */
function parseStringArray(val: unknown): string[] {
	if (Array.isArray(val)) return val.map(String);
	if (typeof val === 'string') {
		try {
			const parsed = JSON.parse(val);
			if (Array.isArray(parsed)) return parsed.map(String);
		} catch {
			// not JSON, treat as single item
			return val.trim() ? [val] : [];
		}
	}
	return [];
}

/**
 * Deterministic split into train/val/test sets.
 * Matches Python's 67/17/16% split.
 */
export function splitTasks(tasks: SWESmithTask[], trainFrac = 0.67, valFrac = 0.17): TaskSplit {
	const n = tasks.length;
	const nTrain = Math.floor(n * trainFrac);
	const nVal = Math.floor(n * valFrac);

	return {
		train: tasks.slice(0, nTrain),
		val: tasks.slice(nTrain, nTrain + nVal),
		test: tasks.slice(nTrain + nVal),
	};
}

/** Load cached tasks from disk. */
async function loadFromCache(slug: string): Promise<SWESmithTask[] | null> {
	const path = join(CACHE_DIR, `${slug}.json`);
	if (!existsSync(path)) return null;

	try {
		const file = Bun.file(path);
		const data = await file.json();
		return data as SWESmithTask[];
	} catch {
		return null;
	}
}

/** Save tasks to disk cache. */
async function saveToCache(slug: string, tasks: SWESmithTask[]): Promise<void> {
	try {
		await mkdir(CACHE_DIR, { recursive: true });
		const path = join(CACHE_DIR, `${slug}.json`);
		await Bun.write(path, JSON.stringify(tasks, null, 2));
		console.log(`[gskill] Cached ${tasks.length} tasks to ${path}`);
	} catch (err) {
		console.warn(`[gskill] Warning: failed to cache tasks: ${err}`);
	}
}

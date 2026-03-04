/** Core interfaces for ax-gskill. */

export interface SWESmithTask {
	instance_id: string;
	repo: string;
	patch: string;
	problem_statement: string;
	FAIL_TO_PASS: string[];
	PASS_TO_PASS: string[];
	image_name: string;
	/** Additional fields from the dataset that we pass through. */
	[key: string]: unknown;
}

export interface TaskSplit {
	train: SWESmithTask[];
	val: SWESmithTask[];
	test: SWESmithTask[];
}

export interface RepoId {
	owner: string;
	repo: string;
	/** "owner/repo" */
	slug: string;
	/** "owner__repo" — the format used in SWE-smith dataset */
	datasetSlug: string;
}

export interface EvalInfo {
	instance_id: string;
	patch_chars: number;
	score: number;
	error: string;
	test_failure_reason: string;
}

export interface TestResult {
	passed: boolean;
	reason: string;
	stdout?: string;
}

export interface AgentResult {
	patch: string;
	error: string;
}

export interface PipelineConfig {
	repoUrl: string;
	outputDir: string;
	maxEvals: number;
	useInitialSkill: boolean;
	agentModel: string;
	agentProvider: string;
	skillModel: string;
	skillProvider: string;
	baseUrl?: string;
}

/** A GEPA-compatible evaluator function. */
export type Evaluator = (skill: string, task: SWESmithTask) => Promise<[number, EvalInfo]>;

/** A candidate in the GEPA optimization pool. */
export interface Candidate {
	skill: string;
	score: number;
	evalCount: number;
}

/** Result of the GEPA optimization loop. */
export interface OptimizeResult {
	bestSkill: string;
	bestScore: number;
	totalEvals: number;
}

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Known flaky tests (test-flakes.json at the repo root): a listed test is retried or skipped by
 * flakeTestRunner.ts, so a known flake no longer costs a CI rerun. Process — docs/TODO/TestFlakes.md.
 */
export const TEST_FLAKES_FILE = "test-flakes.json";

/** How many extra attempts a `retry` entry gets. */
export const FLAKE_RETRY = 2;

export type TestFlakeAction = "retry" | "skip";

export interface ITestFlake {
    /** Test file path relative to the repo root, with forward slashes. */
    readonly file: string;
    /** Full test name: parent suites and the test, joined with " > " (vitest `fullTestName`). */
    readonly test: string;
    readonly action: TestFlakeAction;
    /** Symptom and where it was caught; the details live in docs/TODO/TestFlakes.md. */
    readonly note: string;
}

export function parseTestFlakes(text: string): readonly ITestFlake[] {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { flakes?: unknown }).flakes)) {
        throw new Error(`${TEST_FLAKES_FILE}: expected an object with a "flakes" array`);
    }
    const entries = (parsed as { flakes: unknown[] }).flakes;
    return entries.map((entry, index) => validateEntry(entry, index));
}

function validateEntry(entry: unknown, index: number): ITestFlake {
    const where = `${TEST_FLAKES_FILE}: flakes[${String(index)}]`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where}: expected an object`);
    const { file, test, action, note } = entry as Record<string, unknown>;
    if (typeof file !== "string" || file === "") throw new Error(`${where}: "file" must be a non-empty string`);
    if (typeof test !== "string" || test === "") throw new Error(`${where}: "test" must be a non-empty string`);
    if (action !== "retry" && action !== "skip") throw new Error(`${where}: "action" must be "retry" or "skip"`);
    if (typeof note !== "string" || note === "") throw new Error(`${where}: "note" must be a non-empty string`);
    return { file, test, action, note };
}

export function readTestFlakes(root: string): readonly ITestFlake[] {
    return parseTestFlakes(fs.readFileSync(path.join(root, TEST_FLAKES_FILE), "utf8"));
}

/** Lookup by an absolute test file path and the vitest full test name. */
export class TestFlakeIndex {
    private readonly byKey = new Map<string, ITestFlake>();

    public constructor(
        private readonly root: string,
        flakes: readonly ITestFlake[],
    ) {
        for (const flake of flakes) this.byKey.set(key(flake.file, flake.test), flake);
    }

    public find(absoluteFile: string, fullTestName: string): ITestFlake | undefined {
        const relative = path.relative(this.root, absoluteFile).split(path.sep).join("/");
        return this.byKey.get(key(relative, fullTestName));
    }
}

function key(file: string, test: string): string {
    return `${file}\u0000${test}`;
}

/** The part of a vitest test the list changes. */
export interface IFlakeTarget {
    mode: string;
    retry?: number;
}

/** A GitHub Actions workflow command: shown as a warning annotation in CI, readable as is locally. */
export function flakeRetriedLine(file: string, fullTestName: string, retries: number): string {
    return `::warning file=${file},title=Known flake retried::${fullTestName} passed after ${String(retries)} retr${retries === 1 ? "y" : "ies"} (test-flakes.json)`;
}

export function applyTestFlake(target: IFlakeTarget, flake: ITestFlake): void {
    if (flake.action === "skip") {
        target.mode = "skip";
        return;
    }
    target.retry = Math.max(target.retry ?? 0, FLAKE_RETRY);
}

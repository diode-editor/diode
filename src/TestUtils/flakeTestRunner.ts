import { VitestTestRunner } from "vitest/runners";

import { applyTestFlake, flakeRetriedLine, type IFlakeTarget, readTestFlakes, TestFlakeIndex } from "./testFlakes.ts";

type Task = Parameters<VitestTestRunner["onBeforeRunTask"]>[0];

/** What the runner reads off a vitest task; a suite or a file carries no full test name. */
export interface IFlakeTask {
    readonly name: string;
    readonly fullTestName?: string;
    readonly file: { readonly filepath: string; readonly name: string };
    readonly result?: { readonly state?: string; readonly retryCount?: number };
}

/** A test from the list gets its retries or is skipped; anything else runs as it is. */
export function applyTaskFlake(flakes: TestFlakeIndex, task: IFlakeTask & IFlakeTarget): void {
    const flake = task.fullTestName === undefined ? undefined : flakes.find(task.file.filepath, task.fullTestName);
    if (flake !== undefined) applyTestFlake(task, flake);
}

/**
 * A retried pass is the only trace that the flake is still alive; on GitHub it becomes an annotation. Any other
 * outcome — a first-try pass, a failure, a task that did not run — prints nothing.
 */
export function reportRetriedPass(task: IFlakeTask, sink: { write(line: string): unknown }): void {
    const retries = task.result?.retryCount ?? 0;
    if (retries === 0 || task.result?.state !== "pass") return;
    sink.write(`${flakeRetriedLine(task.file.name, task.fullTestName ?? task.name, retries)}\n`);
}

/**
 * The vitest runner (`test.runner` in vitest.config.ts and vitest.e2e.config.ts): a test from
 * test-flakes.json gets retries or is skipped. Stryker reuses vitest.config.ts, so its dry run sees the
 * same list. Screenshot scenarios are looked up by e2e/scenarios/suite.ts; their retried pass is printed here too.
 */
export default class FlakeTestRunner extends VitestTestRunner {
    private readonly flakes = new TestFlakeIndex(this.config.root, readTestFlakes(this.config.root), process.platform);

    public override async onBeforeRunTask(test: Task): Promise<void> {
        applyTaskFlake(this.flakes, test);
        await super.onBeforeRunTask(test);
    }

    public override onAfterRunTask(test: Task): void {
        super.onAfterRunTask(test);
        reportRetriedPass(test, process.stderr);
    }
}

import { VitestTestRunner } from "vitest/runners";

import { applyTestFlake, flakeRetriedLine, readTestFlakes, TestFlakeIndex } from "./testFlakes.ts";

type Task = Parameters<VitestTestRunner["onBeforeRunTask"]>[0];

/**
 * The vitest runner (`test.runner` in vitest.config.ts): a test from test-flakes.json gets retries
 * or is skipped. Stryker reuses vitest.config.ts, so its dry run sees the same list.
 */
export default class FlakeTestRunner extends VitestTestRunner {
    private readonly flakes = new TestFlakeIndex(this.config.root, readTestFlakes(this.config.root));

    public override async onBeforeRunTask(test: Task): Promise<void> {
        const flake =
            test.fullTestName === undefined ? undefined : this.flakes.find(test.file.filepath, test.fullTestName);
        if (flake !== undefined) applyTestFlake(test, flake);
        await super.onBeforeRunTask(test);
    }

    public override onAfterRunTask(test: Task): void {
        super.onAfterRunTask(test);
        const retries = test.result?.retryCount ?? 0;
        if (retries > 0 && test.result?.state === "pass") {
            // A retried pass is the only trace that the flake is still alive; on GitHub it becomes an annotation.
            process.stderr.write(`${flakeRetriedLine(test.file.name, test.fullTestName ?? test.name, retries)}\n`);
        }
    }
}

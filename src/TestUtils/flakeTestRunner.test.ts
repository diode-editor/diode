import { describe, expect, it } from "vitest";

import { applyTaskFlake, type IFlakeTask, reportRetriedPass } from "./flakeTestRunner.ts";
import { FLAKE_RETRY, type IFlakeTarget, parseTestFlakes, TestFlakeIndex } from "./testFlakes.ts";

const FILE = { filepath: "/repo/src/a.test.ts", name: "src/a.test.ts" };

function task(overrides: Partial<IFlakeTask & IFlakeTarget> = {}): IFlakeTask & IFlakeTarget {
    return { name: "case", fullTestName: "suite > case", file: FILE, mode: "run", ...overrides };
}

describe("applyTaskFlake", () => {
    const flakes = new TestFlakeIndex(
        "/repo",
        parseTestFlakes(
            JSON.stringify({
                flakes: [
                    { file: "src/a.test.ts", test: "suite > case", action: "retry", note: "why" },
                    { file: "src/a.test.ts", test: "suite > gone", action: "skip", note: "why" },
                ],
            }),
        ),
        process.platform,
    );

    it("a listed test is retried or skipped", () => {
        const retried = task();
        applyTaskFlake(flakes, retried);
        expect(retried).toMatchObject({ mode: "run", retry: FLAKE_RETRY });

        const skipped = task({ name: "gone", fullTestName: "suite > gone" });
        applyTaskFlake(flakes, skipped);
        expect(skipped.mode).toBe("skip");
    });

    it("an unlisted test and a suite (no full test name) run as they are", () => {
        const other = task({ fullTestName: "suite > other" });
        applyTaskFlake(flakes, other);
        expect(other).toEqual(task({ fullTestName: "suite > other" }));

        const suite = task({ name: "suite", fullTestName: undefined });
        applyTaskFlake(flakes, suite);
        expect(suite).toEqual(task({ name: "suite", fullTestName: undefined }));
    });
});

describe("reportRetriedPass", () => {
    function report(overrides: Partial<IFlakeTask>): string[] {
        const lines: string[] = [];
        reportRetriedPass(task(overrides), { write: (line) => lines.push(line) });
        return lines;
    }

    it("a pass after retries is printed as the GitHub warning line", () => {
        expect(report({ result: { state: "pass", retryCount: 2 } })).toEqual([
            "::warning file=src/a.test.ts,title=Known flake retried::suite > case passed after 2 retries (test-flakes.json)\n",
        ]);
    });

    it("a task without a full test name is named by its own name", () => {
        expect(report({ fullTestName: undefined, result: { state: "pass", retryCount: 1 } })).toEqual([
            "::warning file=src/a.test.ts,title=Known flake retried::case passed after 1 retry (test-flakes.json)\n",
        ]);
    });

    it("a first-try pass, a failure after retries and a task that did not run print nothing", () => {
        expect(report({ result: { state: "pass", retryCount: 0 } })).toEqual([]);
        expect(report({ result: { state: "pass" } })).toEqual([]);
        expect(report({ result: { state: "fail", retryCount: 2 } })).toEqual([]);
        expect(report({ result: undefined })).toEqual([]);
    });
});

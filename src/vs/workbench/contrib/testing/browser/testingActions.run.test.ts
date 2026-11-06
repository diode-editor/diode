import { describe, expect, it, vi } from "vitest";

import { add, setupExplorer, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import {
    type IWireTestRunProfile,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";

// The run commands' own logic: their arguments, what they pick to run, the hint without tests.

const { NotExpandable, Expanded } = TestItemExpandState;

function profile(controllerId: string, profileId = 1, label = "Run"): IWireTestRunProfile {
    return {
        controllerId,
        profileId,
        label,
        group: TestRunProfileBitset.Run,
        isDefault: true,
        tag: null,
        hasConfigurationHandler: false,
        supportsContinuousRun: false,
    };
}

/** `vitest` → `a`, `b`, `c`; a Run profile. */
function setup() {
    const explorer = setupExplorer();
    explorer.registerController("vitest");
    explorer.profiles.addProfile(profile("vitest"));
    explorer.tests.publishDiff([
        add(wireItem(["vitest"]), Expanded),
        ...["a", "b", "c"].map((name) => add(wireItem(["vitest", name]), NotExpandable)),
    ]);
    return explorer;
}

type Explorer = ReturnType<typeof setup>;

/** A completed run of the core with the given own states. */
async function completedRun(explorer: Explorer, states: Record<string, TestResultState>): Promise<void> {
    const index = explorer.runs.length;
    void explorer.views.commands.execute("testing.runAll");
    await vi.waitFor(() => {
        expect(explorer.runs).toHaveLength(index + 1);
    });
    const result = explorer.results.getResult(explorer.runs[index].requests[0].runId);
    if (result === undefined) throw new Error("no result");
    result.addTask({ id: "t", name: "t", ctrlId: "vitest" });
    for (const [name, state] of Object.entries(states)) {
        result.addTestChainToRun("vitest", [wireItem(["vitest"]), wireItem(["vitest", name])]);
        result.updateState(testId("vitest", name), "t", state);
    }
    explorer.runs[index].finish();
    await vi.waitFor(() => {
        expect(result.completedAt).toBeDefined();
    });
}

describe("testing run commands — Run Test", () => {
    it("a gone test or no test at all runs nothing and does not fail", async () => {
        const explorer = setupExplorer();
        explorer.registerController("vitest");
        explorer.profiles.addProfile(profile("vitest"));
        await expect(
            explorer.views.commands.execute("testing.run", { $testId: "vitest\0gone" }),
        ).resolves.toBeUndefined();
        await expect(explorer.views.commands.execute("testing.run")).resolves.toBeUndefined();
        expect(explorer.results.results).toHaveLength(0);
    });
});

describe("testing run commands", () => {
    it("Cancel Test Run with arguments that are not ids cancels every live run", async () => {
        const explorer = setup();
        void explorer.views.commands.execute("testing.runAll");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        await explorer.views.commands.execute("testing.cancelRun", 5, { taskId: "t" });
        expect(explorer.cancels).toEqual([explorer.runs[0].requests[0].runId]);
    });

    it("Run All Tests leaves out a root that has no tests and cannot get any", async () => {
        const explorer = setup();
        explorer.registerController("empty");
        explorer.tests.publishDiff([add(wireItem(["empty"]), NotExpandable)]);
        void explorer.views.commands.execute("testing.runAll");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        expect(explorer.runs[0].requests.map((request) => request.controllerId)).toEqual(["vitest"]);
    });

    it("without tests the hint is an info notification, not modal, without buttons", async () => {
        const explorer = setupExplorer();
        await explorer.views.commands.execute("testing.runAll");
        expect(explorer.toastOptions).toEqual([
            {
                severity: "info",
                message: "No tests found in this workspace. You may need to install a test provider extension",
                modal: false,
                items: [],
            },
        ]);
    });

    it("Rerun Failed Tests: a test that failed earlier and passed later is not failed any more", async () => {
        const explorer = setup();
        await completedRun(explorer, { a: TestResultState.Failed, b: TestResultState.Failed });
        await completedRun(explorer, { a: TestResultState.Passed });
        void explorer.views.commands.execute("testing.reRunFailTests");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(3);
        });
        expect(explorer.runs[2].requests[0].testIds).toEqual([testId("vitest", "b")]);
    });

    it("the reruns of an unknown run do nothing and do not fail", async () => {
        const explorer = setup();
        await completedRun(explorer, { a: TestResultState.Failed });
        await expect(explorer.views.commands.execute("testing.reRunLastRun", "gone")).resolves.toBeUndefined();
        await expect(explorer.views.commands.execute("testing.reRunFailedFromLastRun", "gone")).resolves.toBeUndefined();
        expect(explorer.runs).toHaveLength(1);
    });

    it("Rerun Last Run keeps the run's exclusions while its profiles exist, with several profiles too", async () => {
        const explorer = setup();
        explorer.profiles.addProfile(profile("vitest", 2, "Second"));
        void explorer.views.commands.execute("testing.runSelected");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(1);
        });
        explorer.runs[0].finish();
        const first = explorer.results.results[0];
        await vi.waitFor(() => {
            expect(first.completedAt).toBeDefined();
        });
        // A run with an exclusion, as from a filter.
        void explorer.tests.runResolvedTests({
            targets: [{ controllerId: "vitest", profileId: 2, testIds: ["vitest"] }],
            group: TestRunProfileBitset.Run,
            exclude: [testId("vitest", "c")],
        });
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(2);
        });
        explorer.runs[1].finish();
        await vi.waitFor(() => {
            expect(explorer.results.results[0].completedAt).toBeDefined();
        });
        void explorer.views.commands.execute("testing.reRunLastRun");
        await vi.waitFor(() => {
            expect(explorer.runs).toHaveLength(3);
        });
        expect(explorer.runs[2].requests).toEqual([
            {
                runId: expect.any(String) as string,
                controllerId: "vitest",
                profileId: 2,
                testIds: ["vitest"],
                excludeExtIds: [testId("vitest", "c")],
            },
        ]);
    });
});

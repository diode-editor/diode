import { describe, expect, it, vi } from "vitest";

import {
    add,
    setupExplorer,
    testProfile,
    UNICODE_ICONS,
    wireItem,
} from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatKeybinding, KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    type IWireTestRunProfile,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
    type TestRunProfileGroup,
} from "../../../api/common/testingWireTypes.ts";

import { TESTING_ACTIONS } from "./testingActions.ts";

// The Debug profile in the Test Explorer (upstream `DebugAction`, `DebugSelectedAction`, `DebugAllAction`,
// `DebugFailedTests`, `DebugLastRun`, `DebugFailedFromLastRun`): where they show and which profile the core asks for.

const { NotExpandable, Expanded } = TestItemExpandState;
const { Passed, Failed } = TestResultState;
const RUN = 1;
const DEBUG = 2;
const DEBUG_GLYPH = UNICODE_ICONS.glyph(codicon("debug-alt-small"));

function profile(group: TestRunProfileGroup, profileId: number, tag: string | null = null): IWireTestRunProfile {
    return testProfile(group, { profileId, label: String(profileId), tag });
}

/** `vitest` → `a`, `b` (`b` tagged `slow`), expanded; a Run profile and, unless told, a Debug one. */
async function setup(debug: IWireTestRunProfile | null = profile(TestRunProfileBitset.Debug, DEBUG)) {
    const explorer = setupExplorer({ height: 12 });
    explorer.registerController("vitest", "Vitest");
    explorer.profiles.addProfile(profile(TestRunProfileBitset.Run, RUN));
    if (debug !== null) explorer.profiles.addProfile(debug);
    explorer.tests.publishDiff([
        add(wireItem(["vitest"], "Vitest"), Expanded),
        add(wireItem(["vitest", "a"]), NotExpandable),
        add(wireItem(["vitest", "b"], "b", { tags: ["vitest\0slow"] }), NotExpandable),
    ]);
    await explorer.waitFrame((text) => text.includes(" a") && text.includes(" b"));
    return explorer;
}

type Explorer = Awaited<ReturnType<typeof setup>>;

/** The profile and the tests of each run the core asked for. */
function asked(explorer: Explorer): [number, string[]][] {
    return explorer.runs.map((run) => [
        run.requests[0].profileId,
        run.requests.flatMap((request) => request.testIds.map((id) => id.split("\0").pop() ?? "")),
    ]);
}

async function execute(explorer: Explorer, count: number, id: string, ...args: unknown[]): Promise<void> {
    void explorer.views.commands.execute(id, ...args);
    await vi.waitFor(() => {
        expect(explorer.runs).toHaveLength(count);
    });
}

/** Finishes the last run with the given states. */
async function finish(explorer: Explorer, states: Record<string, TestResultState>): Promise<void> {
    const run = explorer.runs.at(-1)!;
    const result = explorer.results.getResult(run.requests[0].runId)!;
    result.addTask({ id: "t", name: "t", ctrlId: "vitest" });
    for (const [name, state] of Object.entries(states)) {
        result.addTestChainToRun("vitest", [wireItem(["vitest"]), wireItem(["vitest", name])]);
        result.updateState(testId("vitest", name), "t", state);
    }
    run.finish();
    await vi.waitFor(() => {
        expect(result.completedAt).toBeDefined();
    });
}

/** The row of the test, selected: its inline actions show. */
function rowLine(explorer: Explorer, label: string): { line: string; y: number } {
    const { x, y } = explorer.row(label);
    explorer.click(x, y);
    return { line: explorer.lines()[y], y };
}

describe("Test Explorer — the Debug profile", () => {
    it("the title's Debug Tests sits after Run Tests while nothing runs and runs the visible tests with Debug", async () => {
        const explorer = await setup();
        const title = explorer.lines()[0];
        expect(title).toContain(`▷ │ ${DEBUG_GLYPH}`);
        expect(explorer.views.contextKeys.get("testing.hasDebuggableTests")).toBe(true);
        await execute(explorer, 1, "testing.debugSelected");
        expect(asked(explorer)).toEqual([[DEBUG, ["vitest"]]]);
        await explorer.waitFrame((text) => !text.split("\n")[0].includes(DEBUG_GLYPH));
    });

    it("without a Debug profile there is no Debug Tests, no row's Debug Test; Debug All Tests asks no controller", async () => {
        const explorer = await setup(null);
        expect(explorer.lines()[0]).not.toContain(DEBUG_GLYPH);
        expect(rowLine(explorer, "a").line).not.toContain(DEBUG_GLYPH);
        expect(explorer.views.contextKeys.get("testing.hasDebuggableTests")).toBe(false);
        await explorer.views.commands.execute("testing.debugAll");
        expect(explorer.toasts).toEqual([]);
        expect(explorer.runs).toHaveLength(0);
    });

    it("a row's Debug Test (inline after Run Test, and in its menu) debugs that test", async () => {
        const explorer = await setup();
        const a = rowLine(explorer, "a");
        const x = a.line.lastIndexOf(DEBUG_GLYPH);
        expect(x).toBeGreaterThan(a.line.indexOf(" a"));
        explorer.click(x, a.y);
        await vi.waitFor(() => {
            expect(asked(explorer)).toEqual([[DEBUG, ["a"]]]);
        });
        const { x: labelX, y } = explorer.row("b");
        explorer.click(labelX, y, "right");
        const labels = (explorer.views.shown.at(-1)?.getEntries?.() ?? []).map((entry) =>
            entry.type === "separator" ? "-" : entry.label,
        );
        expect(labels.slice(0, 2)).toEqual(["Run Test", "Debug Test"]);
    });

    it("a Debug profile with a tag: only the tagged test's row offers Debug Test", async () => {
        const explorer = await setup(profile(TestRunProfileBitset.Debug, DEBUG, "vitest\0slow"));
        expect(rowLine(explorer, "a").line).toContain(UNICODE_ICONS.glyph(codicon("run")));
        expect(rowLine(explorer, "a").line).not.toContain(DEBUG_GLYPH);
        expect(rowLine(explorer, "b").line).toContain(DEBUG_GLYPH);
    });

    it("a Debug profile added later puts Debug Test on the rows", async () => {
        const explorer = await setup(null);
        explorer.registerController("other");
        explorer.profiles.addProfile({ ...profile(TestRunProfileBitset.Debug, 9), controllerId: "other" });
        await explorer.waitFrame((text) => text.split("\n")[0].includes(DEBUG_GLYPH));
        expect(rowLine(explorer, "a").line).not.toContain(DEBUG_GLYPH);
        explorer.profiles.addProfile(profile(TestRunProfileBitset.Debug, DEBUG));
        await vi.waitFor(() => {
            expect(rowLine(explorer, "a").line).toContain(DEBUG_GLYPH);
        });
    });

    it("Debug All Tests, Debug Failed Tests and Debug Failed Tests from Last Run ask for the Debug profile", async () => {
        const explorer = await setup();
        await execute(explorer, 1, "testing.runAll");
        await finish(explorer, { a: Failed, b: Passed });
        await execute(explorer, 2, "testing.debugAll");
        await finish(explorer, {});
        await execute(explorer, 3, "testing.debugFailTests");
        await finish(explorer, {});
        await execute(explorer, 4, "testing.debugFailedFromLastRun", explorer.results.results[2].id);
        expect(asked(explorer)).toEqual([
            [RUN, ["vitest"]],
            [DEBUG, ["vitest"]],
            [DEBUG, ["a"]],
            [DEBUG, ["a"]],
        ]);
    });

    it("Debug Last Run repeats a debug run as it was, a run of another group with the Debug defaults; Rerun Last Run the other way", async () => {
        const explorer = await setup();
        await execute(explorer, 1, "testing.run", { $testId: testId("vitest", "a") });
        await finish(explorer, { a: Passed });
        await execute(explorer, 2, "testing.debugLastRun");
        await finish(explorer, { a: Passed });
        await execute(explorer, 3, "testing.debugLastRun");
        await finish(explorer, {});
        await execute(explorer, 4, "testing.reRunLastRun");
        expect(asked(explorer)).toEqual([
            [RUN, ["a"]],
            [DEBUG, ["a"]],
            [DEBUG, ["a"]],
            [RUN, ["a"]],
        ]);
        expect(explorer.results.results.map((result) => result.request.group)).toEqual([
            TestRunProfileBitset.Run,
            TestRunProfileBitset.Debug,
            TestRunProfileBitset.Debug,
            TestRunProfileBitset.Run,
        ]);
    });

    it("the summary's rerun reruns the last run; with Alt it debugs it", async () => {
        const explorer = await setup();
        await execute(explorer, 1, "testing.runAll");
        await finish(explorer, { a: Passed });
        const { x, y } = explorer.locate("↻");
        explorer.click(x, y, "left", true);
        await vi.waitFor(() => {
            expect(asked(explorer).at(-1)?.[0]).toBe(DEBUG);
        });
        await finish(explorer, {});
        explorer.click(x, y);
        await vi.waitFor(() => {
            expect(asked(explorer).map(([id]) => id)).toEqual([RUN, DEBUG, RUN]);
        });
    });

    it("the commands' titles, keys and palette conditions, as upstream", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = { get: () => undefined } as unknown as ServiceAccessor;
        for (const action of TESTING_ACTIONS) registerAction(commands, keybindings, accessor, action);
        const palette = new Map(
            TESTING_ACTIONS.map((action) => [
                action.id,
                action.menus?.find((menu) => menu.menuId === MenuId.CommandPalette)?.when,
            ]),
        );
        const contract = TESTING_ACTIONS.filter((action) => action.id.startsWith("testing.debug")).map((action) => {
            const binding = keybindings.listBindings().find((entry) => entry.commandId === action.id);
            return [
                action.id,
                commands.getTitle(action.id),
                binding === undefined ? undefined : formatKeybinding(binding.chord, "pc"),
                palette.get(action.id),
            ];
        });
        expect(contract).toEqual([
            ["testing.debug", "Test: Debug Test", undefined, undefined],
            ["testing.debugAll", "Test: Debug All Tests", "Ctrl+; Ctrl+A", "testing.hasDebuggableTests"],
            ["testing.debugFailTests", "Test: Debug Failed Tests", "Ctrl+; Ctrl+E", undefined],
            ["testing.debugLastRun", "Test: Debug Last Run", "Ctrl+; Ctrl+L", undefined],
            ["testing.debugSelected", "Test: Debug Tests", undefined, undefined],
            ["testing.debugFailedFromLastRun", "Test: Debug Failed Tests from Last Run", undefined, undefined],
        ]);
    });
});

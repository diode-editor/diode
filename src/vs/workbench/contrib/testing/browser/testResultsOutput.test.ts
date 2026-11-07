import { describe, expect, it, vi } from "vitest";

import { THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import { type ITerminalColors, resolveTerminalColors } from "../../terminal/browser/terminalColorsService.ts";
import { ExtensionPtySession } from "../../terminal/node/extensionPtySession.ts";
import type { LiveTestResult } from "../common/testResult.ts";
import { TestResultService } from "../common/testResultService.ts";

import { CASE_NO_OUTPUT, TestResultsOutput } from "./testResultsOutput.ts";

// The output's one surface: a new subject resets it, the old output is gone from the scrollback too; what a subject
// writes into it; the surface's keyboard, colors and lifetime.

const MINE = testId("c", "mine");
const THEIRS = testId("c", "theirs");

function setup() {
    let session!: ExtensionPtySession;
    const colorChanges = new Emitter<ITerminalColors>();
    const output = new TestResultsOutput(
        (options) => {
            session = new ExtensionPtySession(options);
            return session;
        },
        { colors: resolveTerminalColors(THEME, undefined), onDidChange: colorChanges.event },
    );
    const results = new TestResultService(new ContextKeyService());
    /** A run with the tasks `a` and `b` and the tests `mine` and `theirs`. */
    const run = (): LiveTestResult => {
        const result = results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "a", name: "a", ctrlId: "c" });
        result.addTask({ id: "b", name: "b", ctrlId: "c" });
        for (const name of ["mine", "theirs"]) result.addTestChainToRun("c", [wireItem(["c"]), wireItem(["c", name])]);
        return result;
    };
    const showMine = (result: LiveTestResult): void => {
        output.show({ kind: "test", result, taskIndex: 0, test: result.getStateById(MINE)! });
    };
    const text = async (): Promise<string> => {
        await session.xtermReady;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return surfaceText(session, 10, 80);
    };
    return { output, session: () => session, colorChanges, run, showMine, text };
}

function surfaceText(session: ExtensionPtySession, rows: number, cols: number): string {
    const cell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    const lines: string[] = [];
    for (let y = 0; y < rows; y++) {
        let line = "";
        for (let x = 0; x < cols; x++) line += session.readCell(x, y, cell) ? cell.char || " " : "";
        lines.push(line.trimEnd());
    }
    return lines.join("\n");
}

describe("TestResultsOutput", () => {
    it("a new subject starts from a clean surface: no old line on the screen or in the scrollback", async () => {
        const { output, session, run } = setup();
        const first = run();
        first.appendOutput(Array.from({ length: 30 }, (_, i) => `old ${String(i)}\r\n`).join(""), "a");
        first.markComplete();
        const second = run();
        second.appendOutput("new\r\n", "a");
        second.markComplete();

        output.show({ kind: "task", result: first, taskIndex: 0 });
        await session().xtermReady;
        output.show({ kind: "task", result: second, taskIndex: 0 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        session().scrollLines(-100);
        const text = surfaceText(session(), 10, 80);
        expect(text).toContain("new");
        expect(text).not.toContain("old");
        output.dispose();
    });

    it("a live test's output takes only its own appends; typing into it goes nowhere", async () => {
        const { output, session, run, showMine, text } = setup();
        const live = run();
        showMine(live);
        live.appendOutput("other task\r\n", "b", undefined, MINE);
        live.appendOutput("other test\r\n", "a", undefined, THEIRS);
        live.appendOutput("mine\r\n", "a", undefined, MINE);
        session().write("typed");
        const shown = await text();
        expect(shown).toContain("mine");
        expect(shown).not.toContain("other");
        expect(shown).not.toContain("typed");
        live.markComplete();
        output.dispose();
    });

    it("the subject shown before stops writing: its later output stays out", async () => {
        const { output, run, showMine, text } = setup();
        const before = run();
        showMine(before);
        const now = run();
        now.markComplete();
        output.show({ kind: "task", result: now, taskIndex: 0 });
        before.appendOutput("late\r\n", "a", undefined, MINE);
        expect(await text()).not.toContain("late");
        before.markComplete();
    });

    it("a test's output: its pieces as they were written", async () => {
        const { run, showMine, text } = setup();
        const result = run();
        result.appendOutput("ab", "a", undefined, MINE);
        result.appendOutput("cd\r\n", "a", undefined, MINE);
        result.markComplete();
        showMine(result);
        expect((await text()).split("\n")[0]).toBe("abcd");
    });

    it("the no-output text: not after output, written or live; after a live run that wrote only empty pieces", async () => {
        const written = setup();
        const done = written.run();
        done.appendOutput("done\r\n", "a", undefined, MINE);
        done.markComplete();
        written.showMine(done);
        expect(await written.text()).not.toContain(CASE_NO_OUTPUT.slice(0, 20));

        const live = setup();
        const going = live.run();
        live.showMine(going);
        going.appendOutput("going\r\n", "a", undefined, MINE);
        going.markComplete();
        expect(await live.text()).not.toContain(CASE_NO_OUTPUT.slice(0, 20));

        const empty = setup();
        const silent = empty.run();
        empty.showMine(silent);
        silent.appendOutput("", "a", undefined, MINE);
        silent.markComplete();
        expect(await empty.text()).toContain(CASE_NO_OUTPUT.slice(0, 20));
    });

    it("takes no keyboard; follows the palette; disposing it disposes its surface and its widget", () => {
        const { output, session, colorChanges } = setup();
        expect(output.widget.focusable).toBe(false);
        const recolored = vi.spyOn(session(), "setAnsiColors");
        const light = resolveTerminalColors(WorkbenchTheme.fromThemeFile({ type: "light", colors: {} }), undefined);
        colorChanges.fire(light);
        expect(recolored).toHaveBeenCalledWith(light.ansi);
        const sessionDisposed = vi.spyOn(session(), "dispose");
        const widgetDisposed = vi.spyOn(output.widget, "dispose");
        output.dispose();
        expect(sessionDisposed).toHaveBeenCalled();
        expect(widgetDisposed).toHaveBeenCalled();
    });
});

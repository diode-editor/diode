import { describe, expect, it } from "vitest";

import { THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import { resolveTerminalColors } from "../../terminal/browser/terminalColorsService.ts";
import { ExtensionPtySession } from "../../terminal/node/extensionPtySession.ts";
import { TestResultService } from "../common/testResultService.ts";

import { TestResultsOutput } from "./testResultsOutput.ts";

// The output's one surface: a new subject resets it, the old output is gone from the scrollback too.

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
        let session!: ExtensionPtySession;
        const output = new TestResultsOutput(
            (options) => {
                session = new ExtensionPtySession(options);
                return session;
            },
            { colors: resolveTerminalColors(THEME, undefined), onDidChange: new Emitter<never>().event },
        );
        const results = new TestResultService(new ContextKeyService());
        const first = results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        first.addTask({ id: "t", name: "first", ctrlId: "c" });
        first.appendOutput(Array.from({ length: 30 }, (_, i) => `old ${String(i)}\r\n`).join(""), "t");
        first.markComplete();
        const second = results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        second.addTask({ id: "t", name: "second", ctrlId: "c" });
        second.appendOutput("new\r\n", "t");
        second.markComplete();

        output.show({ kind: "task", result: first, taskIndex: 0 });
        await session.xtermReady;
        output.show({ kind: "task", result: second, taskIndex: 0 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        session.scrollLines(-100);
        const text = surfaceText(session, 10, 80);
        expect(text).toContain("new");
        expect(text).not.toContain("old");
        output.dispose();
    });

    it("a live test's output takes only its own appends; typing into it goes nowhere", async () => {
        let session!: ExtensionPtySession;
        const output = new TestResultsOutput(
            (options) => {
                session = new ExtensionPtySession(options);
                return session;
            },
            { colors: resolveTerminalColors(THEME, undefined), onDidChange: new Emitter<never>().event },
        );
        const results = new TestResultService(new ContextKeyService());
        const live = results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        live.addTask({ id: "a", name: "a", ctrlId: "c" });
        live.addTask({ id: "b", name: "b", ctrlId: "c" });
        for (const name of ["mine", "theirs"]) live.addTestChainToRun("c", [wireItem(["c"]), wireItem(["c", name])]);
        const mine = testId("c", "mine");
        output.show({ kind: "test", result: live, taskIndex: 0, test: live.getStateById(mine)! });
        await session.xtermReady;
        live.appendOutput("other task\r\n", "b", undefined, mine);
        live.appendOutput("other test\r\n", "a", undefined, testId("c", "theirs"));
        live.appendOutput("mine\r\n", "a", undefined, mine);
        session.write("typed");
        await new Promise((resolve) => setTimeout(resolve, 20));
        const text = surfaceText(session, 10, 80);
        expect(text).toContain("mine");
        expect(text).not.toContain("other");
        expect(text).not.toContain("typed");
        live.markComplete();
        output.dispose();
    });
});

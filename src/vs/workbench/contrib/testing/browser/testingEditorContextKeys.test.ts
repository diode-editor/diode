import { describe, expect, it } from "vitest";

import { add, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { TestItemExpandState } from "../../../api/common/testingWireTypes.ts";

import { type ITestingCursorEditor, TestingEditorContextKeys } from "./testingEditorContextKeys.ts";

const URI = "file:///w/math.test.ts";

function setup() {
    const contextKeys = new ContextKeyService();
    const { tests } = makeTestingServices({ contextKeys });
    tests.registerTestController({
        id: "vitest",
        label: "Vitest",
        canRefresh: false,
        expandTest: () => Promise.resolve(),
        refreshTests: () => Promise.resolve(),
        runTests: () => Promise.resolve([]),
        cancelTestRun: () => undefined,
    });
    const activeChanged = new Emitter<void>();
    const selectionChanged = new Emitter<void>();
    let active: ITestingCursorEditor | null = null;
    const keys = new TestingEditorContextKeys(
        {
            getActiveEditor: () => active,
            onActiveEditorChanged: activeChanged.event,
            onDidChangeActiveEditorSelection: selectionChanged.event,
        },
        tests,
        contextKeys,
    );
    const open = (uri: string, line: number, column = 0): void => {
        active = { uri: Uri.parse(uri), primaryCursorLine: line, primaryCursorColumn: column };
        activeChanged.fire();
    };
    const move = (line: number, column = 0): void => {
        active = { ...(active as ITestingCursorEditor), primaryCursorLine: line, primaryCursorColumn: column };
        selectionChanged.fire();
    };
    const state = () => [contextKeys.get("testing.activeEditorHasTests"), contextKeys.get("testing.cursorInsideTestRange")];
    return { tests, keys, open, move, state };
}

describe("TestingEditorContextKeys", () => {
    it("the active editor's file has tests; the cursor is inside one's range", () => {
        const { tests, open, move, state } = setup();
        expect(state()).toEqual([false, false]);
        open(URI, 3);
        expect(state()).toEqual([false, false]);

        tests.publishDiff([
            add(wireItem(["vitest"], "Vitest"), TestItemExpandState.Expanded),
            add(wireItem(["vitest", "file"], "file", { uri: URI }), TestItemExpandState.Expanded),
            add(
                wireItem(["vitest", "file", "adds"], "adds", { uri: URI, range: createRange(2, 4, 4, 6) }),
                TestItemExpandState.NotExpandable,
            ),
        ]);
        expect(state()).toEqual([true, true]);

        move(5, 0);
        expect(state()).toEqual([true, false]);
        move(4, 6);
        expect(state()).toEqual([true, true]);

        open("file:///w/README.md", 2);
        expect(state()).toEqual([false, false]);
    });
});

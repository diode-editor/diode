import { Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { add, setupExplorer, THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import {
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { TestProfileServiceDIToken } from "../common/testProfileService.ts";
import type { ITestNode } from "../common/testService.ts";
import { TestServiceDIToken } from "../common/testService.ts";

import {
    getTestsAtCursor,
    goToNextMessageAction,
    goToPreviousMessageAction,
    openOutputPeekAction,
    runAtCursorAction,
    runCurrentFileAction,
    TESTING_EDITOR_ACTIONS,
    toggleInlineTestOutputAction,
} from "./testingEditorActions.ts";
import {
    type ITestingMessagesEditor,
    TestingMessageDecorations,
    TestingMessageDecorationsDIToken,
} from "./testingMessageDecorations.ts";

const { NotExpandable, Expanded } = TestItemExpandState;
const URI = "file:///w/src/math.test.ts";
const OTHER_URI = "file:///w/src/other.test.ts";
const ROOT = ["vitest"];
const FOLDER = ["vitest", "src"];
const FILE = [...FOLDER, "math.test.ts"];
const SUITE = [...FILE, "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];
const OTHER = [...FOLDER, "other.test.ts"];

const TEXT = [
    'import { it } from "vitest";',
    'describe("math", () => {',
    '    it("adds", () => {',
    "        expect(1 + 1).toBe(3);",
    "    });",
    '    it("fails", () => {',
    "        expect(2 - 1).toBe(2);",
    "    });",
    "});",
].join("\n");

function node(path: readonly string[], range: [number, number, number, number] | null): ITestNode {
    return {
        item: wireItem(path, path[path.length - 1], { uri: URI, range: range === null ? null : createRange(...range) }),
    } as ITestNode;
}

describe("getTestsAtCursor (upstream's)", () => {
    const suite = node(SUITE, [1, 0, 8, 2]);
    const adds = node(ADDS, [2, 4, 4, 6]);
    const fails = node(FAILS, [5, 4, 7, 6]);
    const ids = (tests: readonly ITestNode[]) => tests.map((test) => test.item.label);

    it("the innermost test holding the cursor", () => {
        expect(ids(getTestsAtCursor([suite, adds, fails], createPosition(3, 10)))).toEqual(["adds"]);
        expect(ids(getTestsAtCursor([suite, adds, fails], createPosition(1, 3)))).toEqual(["math"]);
        expect(ids(getTestsAtCursor([node(FILE, null), suite], createPosition(1, 3)))).toEqual(["math"]);
    });

    it("tests sharing the innermost range all run, but not one under another of them", () => {
        const twin = node([...SUITE, "twin"], [2, 4, 4, 6]);
        const child = node([...ADDS, "child"], [2, 4, 4, 6]);
        expect(ids(getTestsAtCursor([suite, adds, twin, child], createPosition(3, 0)))).toEqual(["adds", "twin"]);
    });

    it("outside every test, those of the nearest range starting before the cursor; above them all, none", () => {
        const twin = node([...SUITE, "twin"], [5, 4, 7, 6]);
        const child = node([...FAILS, "child"], [5, 4, 7, 6]);
        const tests = [adds, fails, twin, child];
        expect(ids(getTestsAtCursor(tests, createPosition(4, 8)))).toEqual(["adds"]);
        expect(ids(getTestsAtCursor(tests, createPosition(8, 0)))).toEqual(["fails", "twin"]);
        expect(ids(getTestsAtCursor([fails, adds], createPosition(8, 0)))).toEqual(["fails"]);
        expect(ids(getTestsAtCursor(tests, createPosition(0, 0)))).toEqual([]);
    });
});

/** The run goes on until the controller answers: the command is started, the request is there after a tick. */
async function start(action: CommandAction, accessor: ServiceAccessor): Promise<void> {
    void action.run(accessor);
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup() {
    const explorer = setupExplorer();
    explorer.registerController("vitest", "Vitest");
    explorer.profiles.addProfile({
        controllerId: "vitest",
        profileId: 1,
        label: "Run",
        group: TestRunProfileBitset.Run,
        isDefault: true,
        tag: null,
        hasConfigurationHandler: false,
        supportsContinuousRun: false,
    });
    const item = (path: readonly string[], range?: [number, number, number, number], uri = URI) =>
        wireItem(path, path[path.length - 1], { uri, range: range === undefined ? null : createRange(...range) });
    explorer.tests.publishDiff([
        add(wireItem(ROOT, "Vitest"), Expanded),
        add(item(FOLDER, undefined, "file:///w/src"), Expanded),
        add(item(FILE), Expanded),
        add(item(SUITE, [1, 0, 8, 2]), Expanded),
        add(item(ADDS, [2, 4, 4, 6]), NotExpandable),
        add(item(FAILS, [5, 4, 7, 6]), NotExpandable),
        add(item(OTHER, undefined, OTHER_URI), NotExpandable),
    ]);

    const element = new EditorElement(new EditorViewState(new TextDocument(TEXT)));
    element.occurrenceHighlightEnabled = false;
    element.setStyleVars(THEME.colors as Record<string, number>);
    TestApp.createWithContent(element, new Size(80, 10));
    let uri = URI;
    const editor = {
        get uri() {
            return Uri.parse(uri);
        },
        isTooLargeForTokenization: false,
        onDidChangeTooLargeForTokenization: new Emitter<void>().event,
        setLineMessageDecorations: (messages) => {
            element.setLineMessageDecorations(messages);
        },
        getLineMessageDecorations: () => element.getLineMessageDecorations(),
        onDidClickLineMessage: (listener) => element.onDidClickLineMessage(listener),
        get primaryCursorLine() {
            return element.viewState.selections[0].active.line;
        },
        get primaryCursorColumn() {
            return element.viewState.selections[0].active.character;
        },
        goToPosition: (line: number, column = 0) => {
            element.viewState.goToPosition(line, column);
        },
    } satisfies ITestingMessagesEditor & Record<string, unknown>;
    let active: typeof editor | null = editor;
    const editorsChanged = new Emitter<void>();
    const decorations = new TestingMessageDecorations(
        { getEditors: () => [editor], onDidChangeEditors: editorsChanged.event },
        explorer.results,
        explorer.configuration,
        new StaticProductIconService(false),
        explorer.panel.component,
        explorer.views.commands,
    );
    const toasts: string[] = [];
    const services = new Map<unknown, unknown>([
        [EditorServiceDIToken, { getActiveEditor: () => active }],
        [TestServiceDIToken, explorer.tests],
        [TestProfileServiceDIToken, explorer.profiles],
        [NotificationServiceDIToken, { show: (toast: { message: string }) => toasts.push(toast.message) }],
        [TestingMessageDecorationsDIToken, decorations],
    ]);
    const accessor = { get: (token: unknown) => services.get(token) } as unknown as ServiceAccessor;
    const ran = (): string[][] =>
        explorer.runs.map((run) => run.requests.flatMap((request) => request.testIds.map((id) => id.split("\0").pop() ?? "")));
    const cursor = (line: number, character = 0) => {
        element.viewState.goToPosition(line, character);
    };
    return {
        explorer,
        element,
        editor,
        decorations,
        accessor,
        toasts,
        ran,
        cursor,
        setActive: (value: typeof editor | null) => {
            active = value;
        },
        setUri: (value: string) => {
            uri = value;
        },
    };
}

describe("Run Test at Cursor", () => {
    it("runs the test under the cursor; between tests, the one above", async () => {
        const { accessor, ran, cursor } = setup();
        cursor(3, 10);
        await start(runAtCursorAction, accessor);
        cursor(6, 0);
        await start(runAtCursorAction, accessor);
        cursor(1, 2);
        await start(runAtCursorAction, accessor);
        expect(ran()).toEqual([["adds"], ["fails"], ["math"]]);
    });

    it("above every test: No tests found here, nothing runs; no editor — nothing", async () => {
        const { accessor, ran, toasts, cursor, setActive } = setup();
        cursor(0, 0);
        await runAtCursorAction.run(accessor);
        expect(toasts).toEqual(["No tests found here"]);
        setActive(null);
        await runAtCursorAction.run(accessor);
        expect(ran()).toEqual([]);
        expect(toasts).toHaveLength(1);
    });

    it("a test no profile can run is passed over", async () => {
        const { accessor, explorer, ran, toasts, cursor } = setup();
        explorer.profiles.removeProfile("vitest", 1);
        cursor(3, 10);
        await runAtCursorAction.run(accessor);
        expect(ran()).toEqual([]);
        expect(toasts).toEqual(["No tests found here"]);
    });
});

describe("Run Tests in Current File", () => {
    it("runs the file's test with all under it", async () => {
        const { accessor, ran, cursor } = setup();
        cursor(0, 0);
        await start(runCurrentFileAction, accessor);
        expect(ran()).toEqual([["math.test.ts"]]);
    });

    it("a file without tests: No tests found in this file; no editor — nothing", async () => {
        const { accessor, ran, toasts, setUri, setActive } = setup();
        setUri("file:///w/README.md");
        await runCurrentFileAction.run(accessor);
        expect(toasts).toEqual(["No tests found in this file"]);
        setActive(null);
        await runCurrentFileAction.run(accessor);
        expect(ran()).toEqual([]);
        expect(toasts).toHaveLength(1);
    });
});

describe("Go to Next/Previous Test Failure", () => {
    /** Failures at lines 3 (adds) and 6 (fails), as the run reported them. */
    const failures = async (fixture: ReturnType<typeof setup>) => {
        const result = fixture.explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
        for (const path of [ADDS, FAILS]) {
            result.addTestChainToRun(
                "vitest",
                path.map((_, i) => wireItem(path.slice(0, i + 1))),
            );
            result.updateState(testId(...path), "t", TestResultState.Failed);
        }
        result.appendMessage(testId(...ADDS), "t", {
            message: "a",
            location: { uri: URI, range: createRange(3, 8, 3, 30) },
        });
        result.appendMessage(testId(...FAILS), "t", {
            message: "b",
            location: { uri: OTHER_URI, range: createRange(0, 0, 0, 1) },
            stackTrace: [{ label: "it", uri: URI, position: { line: 6, character: 8 } }],
        });
        result.markComplete();
        await Promise.resolve();
    };
    const at = (fixture: ReturnType<typeof setup>) => fixture.element.viewState.selections[0].active;

    it("the cursor goes to the next failure's location, round the file", async () => {
        const fixture = setup();
        await failures(fixture);
        fixture.cursor(0, 0);
        goToNextMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 3, character: 8 });
        goToNextMessageAction.run(fixture.accessor);
        // Its location is in another file: the line's start.
        expect(at(fixture)).toEqual({ line: 6, character: 0 });
        goToNextMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 3, character: 8 });
    });

    it("the previous one, round the file", async () => {
        const fixture = setup();
        await failures(fixture);
        fixture.cursor(4, 0);
        goToPreviousMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 3, character: 8 });
        goToPreviousMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 6, character: 0 });
        goToPreviousMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 3, character: 8 });
    });

    it("chooses the failure in a shown TEST RESULTS", async () => {
        const fixture = setup();
        await failures(fixture);
        const [first] = fixture.decorations.failuresIn(fixture.editor);
        fixture.decorations.show(first.subject, true);
        fixture.cursor(4, 0);
        goToNextMessageAction.run(fixture.accessor);
        const subject = fixture.explorer.panel.component.currentSubject;
        expect(subject?.test?.item.label).toBe("fails");
        expect(subject?.kind).toBe("message");
    });

    it("no failures or no editor: the cursor stays", async () => {
        const fixture = setup();
        fixture.cursor(4, 2);
        goToNextMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 4, character: 2 });
        await failures(fixture);
        fixture.setActive(null);
        goToPreviousMessageAction.run(fixture.accessor);
        expect(at(fixture)).toEqual({ line: 4, character: 2 });
    });
});

describe("Peek Output and Toggle Inline Test Output", () => {
    it("Peek Output shows the failure nearest to the cursor; without an editor, any", async () => {
        const fixture = setup();
        const result = fixture.explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
        result.addTestChainToRun(
            "vitest",
            FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1))),
        );
        result.updateState(testId(...FAILS), "t", TestResultState.Failed);
        for (const line of [3, 6]) {
            result.appendMessage(testId(...FAILS), "t", {
                message: String(line),
                location: { uri: URI, range: createRange(line, 0, line, 1) },
            });
        }
        result.markComplete();
        await Promise.resolve();
        const shown = () => {
            const subject = fixture.explorer.panel.component.currentSubject;
            return subject?.kind === "message" ? subject.messageIndex : undefined;
        };

        fixture.cursor(5, 0);
        openOutputPeekAction.run(fixture.accessor);
        expect(shown()).toBe(1);
        fixture.setActive(null);
        fixture.explorer.results.clear();
        openOutputPeekAction.run(fixture.accessor);
        expect(shown()).toBeUndefined();
    });

    it("Toggle Inline Test Output switches the logged output", () => {
        const { accessor, decorations } = setup();
        toggleInlineTestOutputAction.run(accessor);
        expect(decorations.showInlineOutput).toBe(true);
        toggleInlineTestOutputAction.run(accessor);
        expect(decorations.showInlineOutput).toBe(false);
    });
});

describe("the editor commands' contract", () => {
    it("the keys, the editor's context menu and its condition, as upstream", () => {
        const keys = Object.fromEntries(
            TESTING_EDITOR_ACTIONS.map((action) => [
                action.id,
                action.keybinding !== undefined && "keys" in action.keybinding ? action.keybinding.when : undefined,
            ]),
        );
        expect(keys).toEqual({
            "testing.goToNextMessage": "editorTextFocus",
            "testing.goToPreviousMessage": "editorTextFocus",
            "testing.openOutputPeek": undefined,
            "testing.runAtCursor": "editorTextFocus",
            "testing.runCurrentFile": "editorTextFocus",
            "testing.toggleInlineTestOutput": undefined,
        });
        const editorContext = TESTING_EDITOR_ACTIONS.flatMap((action) =>
            (action.menus ?? [])
                .filter((menu) => menu.menuId === MenuId.EditorContext)
                .map((menu) => [action.shortTitle, menu.group, menu.order, menu.when]),
        );
        expect(editorContext).toEqual([
            ["Run Test at Cursor", "testing", 0, "testing.activeEditorHasTests && testing.hasRunnableTests"],
            ["Run Tests in Current File", "testing", 2, "testing.activeEditorHasTests && testing.hasRunnableTests"],
        ]);
    });
});

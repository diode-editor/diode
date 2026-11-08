import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { setupExplorer, SwitchableIcons, THEME, wireItem } from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { type IWireTestMessage, TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import type { LiveTestResult } from "../common/testResult.ts";

import { PEEK_TEST_ERROR_COMMAND } from "./testingDecorations.ts";
import {
    errorText,
    type ITestingMessagesEditor,
    MAX_INLINE_MESSAGE_LENGTH,
    outputText,
    TestingMessageDecorations,
} from "./testingMessageDecorations.ts";
import { TEST_RESULTS_VIEW_ID } from "./testResultsView.ts";

const URI = "file:///w/src/math.test.ts";
const OTHER_URI = "file:///w/src/other.ts";
const SUITE = ["vitest", "math.test.ts", "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];

const TEXT = [
    'describe("math", () => {',
    '    it("adds", () => {',
    "        expect(1 + 1).toBe(3);",
    "    });",
    '    it("fails", () => {',
    "        expect(2 - 1).toBe(2);",
    "    });",
    "});",
].join("\n");

const NERD = new StaticProductIconService(true);
const ERROR = CODICON_GLYPHS.error;

function at(line: number, uri = URI) {
    return { uri, range: createRange(line, 8, line, 30) };
}

function setup(options: { settings?: Record<string, unknown>; icons?: StaticProductIconService } = {}) {
    const explorer = setupExplorer({ settings: options.settings, panelWidth: 80, panelHeight: 12 });
    const editorsChanged = new Emitter<void>();
    const open: ITestingMessagesEditor[] = [];
    const decorations = new TestingMessageDecorations(
        { getEditors: () => open, onDidChangeEditors: editorsChanged.event },
        explorer.results,
        explorer.configuration,
        options.icons ?? NERD,
        explorer.panel.component,
        explorer.views.commands,
    );

    const openEditor = (uri = URI, text = TEXT, width = 80) => {
        const element = new EditorElement(new EditorViewState(new TextDocument(text)));
        element.occurrenceHighlightEnabled = false;
        element.setStyleVars(THEME.colors as Record<string, number>);
        const app = TestApp.createWithContent(element, new Size(width, 10));
        const largeFileLeft = new Emitter<void>();
        let sets = 0;
        const editor = {
            uri: Uri.parse(uri),
            isTooLargeForTokenization: false as boolean,
            onDidChangeTooLargeForTokenization: largeFileLeft.event,
            setLineMessageDecorations: (messages) => {
                sets++;
                element.setLineMessageDecorations(messages);
            },
            getLineMessageDecorations: () => element.getLineMessageDecorations(),
            onDidClickLineMessage: (listener) => element.onDidClickLineMessage(listener),
        } satisfies ITestingMessagesEditor & { isTooLargeForTokenization: boolean };
        open.push(editor);
        editorsChanged.fire();
        const row = (line: number): string => {
            app.render();
            return app.backend.getTextAt(new Point(element.gutterWidth, line), width - element.gutterWidth).trimEnd();
        };
        return {
            editor,
            element,
            app,
            largeFileLeft,
            sets: () => sets,
            row,
            /** The text after the line's own, from the message's first cell. */
            message: (line: number): string => {
                const own = element.viewState.document.getLineContent(line);
                return row(line).slice(own.length + 2);
            },
            close: () => {
                open.splice(open.indexOf(editor), 1);
                editorsChanged.fire();
            },
        };
    };

    /** A completed run of the core where `fails` failed (and `adds` passed) with the given messages. */
    const run = (
        messages: { path?: readonly string[]; message: IWireTestMessage }[],
        output: { path: readonly string[]; text: string; line: number; uri?: string }[] = [],
    ): LiveTestResult => {
        const result = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
        for (const path of [ADDS, FAILS]) {
            result.addTestChainToRun(
                "vitest",
                path.map((_, i) => wireItem(path.slice(0, i + 1))),
            );
        }
        result.updateState(testId(...ADDS), "t", TestResultState.Passed);
        result.updateState(testId(...FAILS), "t", TestResultState.Failed);
        for (const { path = FAILS, message } of messages) result.appendMessage(testId(...path), "t", message);
        for (const { path, text, line, uri } of output) result.appendOutput(text, "t", at(line, uri), testId(...path));
        result.markComplete();
        return result;
    };

    /** The run's batch comes to the editors in a microtask. */
    const flush = () => Promise.resolve();
    return { explorer, decorations, openEditor, run, flush, editorsChanged };
}

describe("TestingMessageDecorations — the failures after the lines", () => {
    it("an error at a location in the file is a badge after its line: the failed icon and the message", async () => {
        const { openEditor, run, flush } = setup();
        const view = openEditor();
        run([{ message: { message: "expected 2 to be 3", location: at(2) } }]);
        await flush();

        expect(view.row(2)).toBe(`        expect(1 + 1).toBe(3);   ${ERROR} expected 2 to be 3`);
        expect(view.row(1)).toBe('    it("adds", () => {');
        const x = view.element.gutterWidth + "        expect(1 + 1).toBe(3);".length + 2;
        view.app.render();
        expect(view.app.backend.getBgAt(new Point(x, 2))).toBe(THEME.getColor("testing.message.error.badgeBackground"));
        expect(view.app.backend.getFgAt(new Point(x + 1, 2))).toBe(
            THEME.getColor("testing.message.error.badgeForeground"),
        );
    });

    it("an error elsewhere is placed by its first stack frame in the file; neither — not shown", async () => {
        const { openEditor, run, flush } = setup();
        const view = openEditor();
        run([
            {
                message: {
                    message: "from a helper",
                    location: at(1, OTHER_URI),
                    stackTrace: [
                        { label: "helper", uri: OTHER_URI, position: { line: 1, character: 0 } },
                        { label: "no position", uri: URI },
                        { label: "the test", uri: URI, position: { line: 5, character: 8 } },
                        { label: "later", uri: URI, position: { line: 6, character: 0 } },
                    ],
                },
            },
            { message: { message: "nowhere here", location: at(3, OTHER_URI) } },
            { message: { message: "no location" } },
        ]);
        await flush();

        expect(view.message(5)).toBe(` ${ERROR} from a helper`);
        expect([...view.element.getLineMessageDecorations().keys()]).toEqual([5]);
    });

    it("one message per line: the first error of the line in the run's order wins", async () => {
        const { openEditor, run, flush } = setup();
        const view = openEditor();
        run([
            { message: { message: "first", location: at(2) } },
            { message: { message: "second", location: at(2) } },
            { path: ADDS, message: { message: "of adds", location: at(2) } },
        ]);
        await flush();
        // `adds` came to the run first.
        expect(view.message(2)).toBe(` ${ERROR} of adds`);
        expect(view.element.getLineMessageDecorations().size).toBe(1);
    });

    it("a new run replaces the messages; Clear All Results takes them away", async () => {
        const { explorer, openEditor, run, flush } = setup();
        const view = openEditor();
        run([{ message: { message: "old", location: at(2) } }]);
        await flush();
        run([{ message: { message: "new", location: at(5) } }]);
        await flush();
        expect(view.message(5)).toBe(` ${ERROR} new`);
        expect(view.row(2)).toBe("        expect(1 + 1).toBe(3);");

        explorer.results.clear();
        await flush();
        expect(view.row(5)).toBe("        expect(2 - 1).toBe(2);");
        expect(view.element.getLineMessageDecorations().size).toBe(0);
    });

    it("with testing.showAllMessages, the older runs' messages too, the latest first on a shared line", async () => {
        const { explorer, openEditor, run, flush } = setup();
        const view = openEditor();
        run([{ message: { message: "old 2", location: at(2) } }, { message: { message: "old 5", location: at(5) } }]);
        run([{ message: { message: "new 2", location: at(2) } }]);
        await flush();
        expect([...view.element.getLineMessageDecorations().keys()]).toEqual([2]);

        explorer.setSetting("testing.showAllMessages", true);
        expect(view.message(2)).toBe(` ${ERROR} new 2`);
        expect(view.message(5)).toBe(` ${ERROR} old 5`);

        const sets = view.sets();
        explorer.setSetting("testing.gutterEnabled", false);
        expect(view.sets()).toBe(sets);
    });

    it("a live run shows its messages as they come, once per batch", async () => {
        const { explorer, openEditor, flush } = setup();
        const view = openEditor();
        const result = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
        result.addTestChainToRun(
            "vitest",
            FAILS.map((_, i) => wireItem(FAILS.slice(0, i + 1))),
        );
        await flush();
        const sets = view.sets();
        result.updateState(testId(...FAILS), "t", TestResultState.Failed);
        result.appendMessage(testId(...FAILS), "t", { message: "boom", location: at(5) });
        await flush();
        expect(view.sets()).toBe(sets + 1);
        expect(view.message(5)).toBe(` ${ERROR} boom`);
    });

    it("the large-file mode shows none; leaving it shows them", async () => {
        const { openEditor, run, flush } = setup();
        const view = openEditor();
        view.editor.isTooLargeForTokenization = true;
        run([{ message: { message: "boom", location: at(2) } }]);
        await flush();
        expect(view.element.getLineMessageDecorations().size).toBe(0);

        view.editor.isTooLargeForTokenization = false;
        view.largeFileLeft.fire();
        expect(view.message(2)).toBe(` ${ERROR} boom`);
    });

    it("an editor opened after the run shows its file's messages; a closed one is left alone", async () => {
        const { openEditor, run, flush, explorer } = setup();
        run([
            { message: { message: "here", location: at(2) } },
            { message: { message: "there", location: at(0, OTHER_URI) } },
        ]);
        const other = openEditor(OTHER_URI, "const x = 1;\n");
        expect(other.message(0)).toBe(` ${ERROR} there`);
        const view = openEditor();
        expect(view.message(2)).toBe(` ${ERROR} here`);

        view.close();
        const sets = view.sets();
        explorer.results.clear();
        await flush();
        expect(view.sets()).toBe(sets);
        expect(other.element.getLineMessageDecorations().size).toBe(0);
    });

    it("the icon follows the icon set", async () => {
        const icons = new SwitchableIcons();
        const { openEditor, run, flush } = setup({ icons });
        const view = openEditor();
        run([{ message: { message: "boom", location: at(2) } }]);
        await flush();
        expect(view.message(2)).not.toContain(ERROR);
        icons.useNerdFont();
        expect(view.message(2)).toBe(` ${ERROR} boom`);
    });

    it("an edit moves the message with its line; deleting the line takes it away until the next run", async () => {
        const { decorations, openEditor, run, flush } = setup();
        const view = openEditor();
        run([{ message: { message: "a", location: at(2) } }, { message: { message: "b", location: at(5) } }]);
        await flush();
        view.element.viewState.document.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "// top\n")]);
        expect(view.message(3)).toBe(` ${ERROR} a`);
        view.element.viewState.document.applyEdits([createTextEdit(createRange(3, 0, 4, 0), "")]);
        expect(decorations.failuresIn(view.editor).map((failure) => failure.line)).toEqual([5]);
    });
});

describe("TestingMessageDecorations — Toggle Inline Test Output", () => {
    it("the logged output with a location in the file shows only when on, in the info color, errors keep their lines", async () => {
        const { decorations, openEditor, run, flush } = setup();
        const view = openEditor();
        run(
            [{ message: { message: "boom", location: at(5) } }],
            [
                { path: ADDS, text: "\x1b[32mlog\x1b[0m one\n  two", line: 2 },
                { path: FAILS, text: "hidden by the error", line: 5 },
                { path: FAILS, text: "elsewhere", line: 1, uri: OTHER_URI },
            ],
        );
        await flush();
        expect([...view.element.getLineMessageDecorations().keys()]).toEqual([5]);

        decorations.toggleInlineOutput();
        expect(decorations.showInlineOutput).toBe(true);
        expect(view.message(2)).toBe("log one two");
        expect(view.message(5)).toBe(` ${ERROR} boom`);
        const x = view.element.gutterWidth + "        expect(1 + 1).toBe(3);".length + 2;
        view.app.render();
        expect(view.app.backend.getBgAt(new Point(x, 2))).toBe(view.app.backend.getBgAt(new Point(x - 1, 2)));
        expect(view.app.backend.getFgAt(new Point(x, 2))).not.toBe(view.app.backend.getFgAt(new Point(0, 2)));
        // Errors are the only targets of Go to Next Test Failure.
        expect(decorations.failuresIn(view.editor).map((failure) => failure.line)).toEqual([5]);

        decorations.toggleInlineOutput();
        expect([...view.element.getLineMessageDecorations().keys()]).toEqual([5]);
    });

    it("the latest output of a line wins", async () => {
        const { decorations, openEditor, run, flush } = setup();
        const view = openEditor();
        decorations.toggleInlineOutput();
        run(
            [],
            [
                { path: ADDS, text: "first", line: 2 },
                { path: ADDS, text: "last", line: 2 },
            ],
        );
        await flush();
        expect(view.message(2)).toBe("last");
    });
});

describe("TestingMessageDecorations — TEST RESULTS", () => {
    it("a click on a message shows it in TEST RESULTS, the keyboard stays in the editor", async () => {
        const { explorer, openEditor, run, flush } = setup();
        const view = openEditor();
        const result = run([{ message: { message: "expected 2 to be 3\n+ 3\n- 2", location: at(2) } }]);
        await flush();
        const openView = vi.spyOn(explorer.views.service, "openView");
        view.app.render();
        const x = view.element.gutterWidth + "        expect(1 + 1).toBe(3);".length + 4;
        view.app.backend.simulateMouse({
            kind: "mouse",
            button: "left",
            action: "press",
            x: x + 1,
            y: 3,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });

        expect(openView).toHaveBeenCalledWith(TEST_RESULTS_VIEW_ID, false);
        const subject = explorer.panel.component.currentSubject;
        expect(subject?.kind).toBe("message");
        expect(subject?.result).toBe(result);
        expect(subject?.test?.item.label).toBe("fails");
        // The message's text on the left, its row chosen in the tree.
        const frame = await explorer.panel.waitFrame((text) => text.includes("+ 2 more lin"));
        expect(frame.split("\n")[0]).toMatch(/^expected 2 to be 3 /);
    });

    it("a click on a message someone else set opens nothing", async () => {
        const { explorer, openEditor, run, flush } = setup();
        const view = openEditor();
        run([{ message: { message: "expected 2 to be 3", location: at(2) } }]);
        await flush();
        view.element.setLineMessageDecorations([
            { key: "foreign", line: 2, text: "foreign", colorToken: "foreground" },
        ]);
        const clicks: string[] = [];
        view.element.onDidClickLineMessage((key) => clicks.push(key));
        const openView = vi.spyOn(explorer.views.service, "openView");
        view.app.render();
        view.app.backend.simulateMouse({
            kind: "mouse",
            button: "left",
            action: "press",
            x: view.element.gutterWidth + "        expect(1 + 1).toBe(3);".length + 3,
            y: 3,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
        expect(clicks).toEqual(["foreign"]);
        expect(openView).not.toHaveBeenCalled();
    });

    it("Peek Error of a test shows its first error with a location; none — nothing opens", async () => {
        const { explorer, run, flush } = setup();
        run([{ message: { message: "no location" } }, { message: { message: "located", location: at(5) } }]);
        await flush();
        expect(explorer.views.commands.has(PEEK_TEST_ERROR_COMMAND)).toBe(true);

        await explorer.views.commands.execute(PEEK_TEST_ERROR_COMMAND, testId(...ADDS));
        await explorer.views.commands.execute(PEEK_TEST_ERROR_COMMAND, testId("vitest", "unknown"));
        await explorer.views.commands.execute(PEEK_TEST_ERROR_COMMAND, 42);
        // The run's first task, as the run showed it.
        expect(explorer.panel.component.currentSubject?.kind).toBe("task");

        const openView = vi.spyOn(explorer.views.service, "openView");
        await explorer.views.commands.execute(PEEK_TEST_ERROR_COMMAND, testId(...FAILS));
        expect(openView).toHaveBeenCalledWith(TEST_RESULTS_VIEW_ID, true);
        const subject = explorer.panel.component.currentSubject;
        expect(subject?.kind === "message" ? subject.messageIndex : undefined).toBe(1);
    });

    it("Peek Output: the editor's failure nearest to the line, else the one shown last, else any failure", async () => {
        const { decorations, explorer, openEditor, run, flush } = setup();
        decorations.showNearest(undefined, 0);
        expect(explorer.panel.component.currentSubject).toBeNull();
        const other = openEditor(OTHER_URI, "x\n");
        run([
            { message: { message: "two", location: at(2) } },
            { message: { message: "five", location: at(5) } },
            { path: ADDS, message: { message: "of adds", location: at(7) } },
        ]);
        await flush();
        const view = openEditor();
        const shownText = (): string | undefined => {
            const subject = explorer.panel.component.currentSubject;
            return subject?.kind === "message"
                ? subject.test.tasks[subject.taskIndex].messages[subject.messageIndex].message
                : undefined;
        };

        decorations.showNearest(view.editor, 4);
        expect(shownText()).toBe("five");
        decorations.showNearest(view.editor, 3);
        expect(shownText()).toBe("two");
        decorations.showNearest(view.editor, 7);
        expect(shownText()).toBe("of adds");

        // No failure in the other file: the one shown last.
        decorations.showNearest(other.editor, 0);
        expect(shownText()).toBe("of adds");

        // The last one's run is gone: the first failure of a failed test among the latest results.
        explorer.results.clear();
        run([
            { path: ADDS, message: { message: "of a passed test", location: at(1) } },
            { message: { message: "without a location" } },
            { message: { message: "with a location", location: at(5, OTHER_URI) } },
        ]);
        await flush();
        decorations.showNearest(undefined, 0);
        expect(shownText()).toBe("with a location");

        // The latest run's failed test has no located error: the older run's.
        explorer.results.clear();
        run([{ message: { message: "an older one", location: at(5) } }]);
        run([{ message: { message: "without a location" } }]);
        await flush();
        decorations.showNearest(undefined, 0);
        expect(shownText()).toBe("an older one");
    });

    it("select chooses the message in a shown TEST RESULTS and opens nothing otherwise", async () => {
        const { decorations, explorer, openEditor, run, flush } = setup();
        const view = openEditor();
        run([{ message: { message: "two", location: at(2) } }, { message: { message: "five", location: at(5) } }]);
        await flush();
        const [two, five] = decorations.failuresIn(view.editor);
        decorations.select(two.subject);
        expect(explorer.views.service.isViewShown(TEST_RESULTS_VIEW_ID)).toBe(false);
        expect(explorer.panel.component.currentSubject?.kind).toBe("task");

        decorations.show(two.subject, true);
        decorations.select(five.subject);
        expect(explorer.panel.component.currentSubject).toBe(five.subject);

        view.close();
        expect(decorations.failuresIn(view.editor)).toEqual([]);
    });
});

describe("the messages' texts", () => {
    it("an error: `actual != expected` when both are known, each on one line and cut in the middle at 30", () => {
        expect(errorText({ type: "error", message: "m", expected: "3", actual: "2" })).toBe("2 != 3");
        expect(errorText({ type: "error", message: "m", expected: `{\n  a: 1\n}`, actual: "x".repeat(40) })).toBe(
            `${"x".repeat(14)}…${"x".repeat(15)} != { a: 1 }`,
        );
    });

    it("an error otherwise: its first line, without the escapes and control characters; empty — Test Failed", () => {
        expect(errorText({ type: "error", message: "\x1b[31mAssertionError\x1b[39m: no\tway\nstack" })).toBe(
            "AssertionError: no way",
        );
        expect(errorText({ type: "error", message: "only one" })).toBe("only one");
        expect(errorText({ type: "error", message: "" })).toBe("Test Failed");
        expect(errorText({ type: "error", message: "∑ ünïcödé 😀" })).toBe("∑ ünïcödé 😀");
    });

    it("an output: the line breaks with their indent become spaces, cut with the ellipsis at the limit", () => {
        expect(outputText("a\r\n   b\nc")).toBe("a b c");
        expect(outputText("x".repeat(MAX_INLINE_MESSAGE_LENGTH))).toBe("x".repeat(MAX_INLINE_MESSAGE_LENGTH));
        expect(outputText("x".repeat(MAX_INLINE_MESSAGE_LENGTH + 1))).toBe(
            `${"x".repeat(MAX_INLINE_MESSAGE_LENGTH - 1)}…`,
        );
    });
});

describe("TestingMessageDecorations — TEST RESULTS on an older run's message", () => {
    /** How many rows of TEST RESULTS' tree (the right half, past the message's text) name the message. */
    const treeRowsWith = (frame: string, text: string): number =>
        frame.split("\n").filter((row) => row.slice(40).includes(text)).length;

    it("a click on an older run's message (testing.showAllMessages) reveals its row in the tree", async () => {
        const { explorer, openEditor, run, flush } = setup({ settings: { "testing.showAllMessages": true } });
        const view = openEditor();
        run([{ message: { message: "old five", location: at(5) } }]);
        run([{ message: { message: "new two", location: at(2) } }]);
        await flush();
        expect(view.message(5)).toBe(` ${ERROR} old five`);
        view.app.render();
        const x = view.element.gutterWidth + "        expect(2 - 1).toBe(2);".length + 4;
        view.app.backend.simulateMouse({
            kind: "mouse",
            button: "left",
            action: "press",
            x: x + 1,
            y: 6,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
        expect(explorer.panel.component.currentSubject?.kind).toBe("message");

        // As upstream's reveal (testResultsTree.ts: every parent expanded, the older results' group too): the row is
        // in the tree, not hidden under the collapsed "1 older result".
        await explorer.panel.waitFrame((text) => treeRowsWith(text, "old five") === 1);
    });

    it("Peek Error of a test failed in an older run reveals the message's row in the tree", async () => {
        const { explorer, run, flush } = setup();
        run([{ message: { message: "old five", location: at(5) } }]);
        // A later run of `adds` alone: `fails`' failure is only in the older run.
        const later = explorer.results.createLiveResult({ targets: [], group: TestRunProfileBitset.Run });
        later.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
        later.addTestChainToRun(
            "vitest",
            ADDS.map((_, i) => wireItem(ADDS.slice(0, i + 1))),
        );
        later.updateState(testId(...ADDS), "t", TestResultState.Failed);
        later.appendMessage(testId(...ADDS), "t", { message: "new one", location: at(2) });
        later.markComplete();
        await flush();

        await explorer.views.commands.execute(PEEK_TEST_ERROR_COMMAND, testId(...FAILS));
        expect(explorer.panel.component.currentSubject?.kind).toBe("message");

        await explorer.panel.waitFrame((text) => treeRowsWith(text, "old five") === 1);
    });
});

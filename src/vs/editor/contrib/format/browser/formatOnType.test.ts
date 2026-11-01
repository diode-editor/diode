import { describe, expect, it, vi } from "vitest";

import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { createRange } from "../../../common/core/iRange.ts";
import { createCursorSelection, createSelection } from "../../../common/core/iSelection.ts";
import { createTextEdit, type ITextEdit } from "../../../common/core/iTextEdit.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    IOnTypeFormattingRequest,
    OnTypeFormattingEditProvider,
} from "../../../common/languages/iFormattingSource.ts";

import { FormatOnTypeController } from "./formatOnType.ts";

/** `int x=1;` as a formatter sees it: the `=` gets its spaces. */
const SPACED_EQUALS = [createTextEdit(createRange(0, 5, 0, 6), " = ")];

function setup(initial = "int x=1", triggerCharacters: readonly string[] = [";", "\n"]) {
    const registry = new LanguageFeatureRegistry<OnTypeFormattingEditProvider>();
    const pane = createEditorPane();
    pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: initial }]);
    const lines = initial.split("\n");
    pane.viewState.selections = [createCursorSelection(lines.length - 1, lines[lines.length - 1].length)];

    let answer: () => Promise<readonly ITextEdit[]> = () => Promise.resolve(SPACED_EQUALS);
    const provide = vi.fn((_request: IOnTypeFormattingRequest) => answer());
    registry.register("*", { triggerCharacters, provideOnTypeFormattingEdits: provide });

    const state = { enabled: true };
    const controller = new FormatOnTypeController(pane, {
        providers: registry,
        isSettingEnabled: () => state.enabled,
    });
    return {
        pane,
        registry,
        provide,
        state,
        controller,
        answerWith(next: () => Promise<readonly ITextEdit[]>) {
            answer = next;
        },
        text: () => pane.viewState.document.getText(),
        caret: () => pane.viewState.selections[0].active,
    };
}

/** The promise chain of the controller, without timers. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
}

function deferred(): { promise: Promise<readonly ITextEdit[]>; resolve(edits: readonly ITextEdit[]): void } {
    let resolve: (edits: readonly ITextEdit[]) => void = () => undefined;
    const promise = new Promise<readonly ITextEdit[]>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("FormatOnTypeController", () => {
    it("a trigger character formats the line", async () => {
        const { pane, text, provide } = setup();
        pane.typeText(";");
        await settle();
        expect(text()).toBe("int x = 1;");
        expect(provide.mock.calls[0][0]).toEqual({
            uri: pane.uri.toString(),
            languageId: pane.languageId,
            versionId: pane.viewState.document.versionId - 1,
            position: { line: 0, character: 8 },
            ch: ";",
            tabSize: pane.viewState.tabSize,
            insertSpaces: pane.viewState.insertSpaces,
        });
    });

    it("the caret shifts with the edits, so the next character lands after the trigger", async () => {
        const { pane, text, caret } = setup();
        pane.typeText(";");
        await settle();
        expect(caret()).toEqual({ line: 0, character: 10 });

        pane.typeText("x");
        await settle();
        expect(text()).toBe("int x = 1;x");
    });

    it("an insertion before the caret moves it too: the f of a Python f-string", async () => {
        const { pane, text, caret, answerWith } = setup('print("', ["{"]);
        answerWith(() => Promise.resolve([createTextEdit(createRange(0, 6, 0, 6), "f")]));
        pane.typeText("{");
        await settle();
        expect(text()).toBe('print(f"{');
        expect(caret()).toEqual({ line: 0, character: 9 });
    });

    it("a character that is not a trigger asks nothing", async () => {
        const { pane, provide } = setup();
        pane.typeText("a");
        await settle();
        expect(provide).not.toHaveBeenCalled();
    });

    it("the setting off asks nothing; it is read per character", async () => {
        const { pane, provide, state, text } = setup();
        state.enabled = false;
        pane.typeText(";");
        await settle();
        expect(provide).not.toHaveBeenCalled();
        expect(text()).toBe("int x=1;");

        state.enabled = true;
        pane.typeText(";");
        await settle();
        expect(provide).toHaveBeenCalledOnce();
    });

    it("no provider asks nothing and does not throw", async () => {
        const pane = createEditorPane();
        const controller = new FormatOnTypeController(pane, {
            providers: new LanguageFeatureRegistry<OnTypeFormattingEditProvider>(),
            isSettingEnabled: () => true,
        });
        expect(() => {
            pane.typeText(";");
        }).not.toThrow();
        controller.dispose();
    });

    it("Enter is a trigger, with the caret on the new line", async () => {
        const { pane, provide, text } = setup("a");
        pane.typeText("\n");
        await settle();
        expect(provide.mock.calls[0][0]).toMatchObject({ ch: "\n", position: { line: 1, character: 0 } });
        expect(text()).toContain("\n");
    });

    it("Enter without the trigger asks nothing", async () => {
        const { pane, provide } = setup("a", [";"]);
        pane.typeText("\n");
        await settle();
        expect(provide).not.toHaveBeenCalled();
    });

    it("only the first provider counts: the triggers of the other one do nothing", async () => {
        const { pane, registry, provide } = setup("a", [";"]);
        const first = vi.fn(() => Promise.resolve<readonly ITextEdit[]>([]));
        // The newer registration goes first in the order.
        registry.register("*", { triggerCharacters: ["}"], provideOnTypeFormattingEdits: first });
        pane.typeText(";");
        await settle();
        expect(first).not.toHaveBeenCalled();
        expect(provide).not.toHaveBeenCalled();

        pane.typeText("}");
        await settle();
        expect(first).toHaveBeenCalledOnce();
        expect(provide).not.toHaveBeenCalled();
    });

    it("several cursors skip", async () => {
        const { pane, provide } = setup("ab\ncd");
        pane.viewState.selections = [createCursorSelection(0, 2), createCursorSelection(1, 2)];
        pane.typeText(";");
        await settle();
        expect(provide).not.toHaveBeenCalled();
    });

    it("a selection left after typing skips: auto-surround keeps it", async () => {
        const { pane, registry, provide } = setup("ab", ["("]);
        const typed = new Emitter<string>();
        const controller = new FormatOnTypeController(
            {
                uri: pane.uri,
                languageId: pane.languageId,
                viewState: pane.viewState,
                onDidType: typed.event,
                onDidTypeNewLine: () => ({ dispose: () => undefined }),
                applyExternalEdits: () => undefined,
            },
            { providers: registry, isSettingEnabled: () => true },
        );
        pane.viewState.selections = [createSelection(0, 0, 0, 1)];
        typed.fire("(");
        await settle();
        expect(provide).not.toHaveBeenCalled();

        pane.viewState.selections = [createCursorSelection(0, 1)];
        typed.fire("(");
        await settle();
        expect(provide).toHaveBeenCalledOnce();
        controller.dispose();
    });

    it("an edit on the caret's line while waiting drops the answer", async () => {
        const { pane, text, answerWith } = setup();
        const answer = deferred();
        answerWith(() => answer.promise);
        pane.typeText(";");
        pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "//" }]);
        answer.resolve(SPACED_EQUALS);
        await settle();
        expect(text()).toBe("//int x=1;");
    });

    it("an edit above the caret's line while waiting drops the answer", async () => {
        const { pane, text, answerWith } = setup("top\nint x=1");
        const answer = deferred();
        answerWith(() => answer.promise);
        pane.typeText(";");
        pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "#" }]);
        answer.resolve([createTextEdit(createRange(1, 5, 1, 6), " = ")]);
        await settle();
        expect(text()).toBe("#top\nint x=1;");
    });

    it("an edit below the caret's line while waiting does not", async () => {
        const { pane, text, answerWith, caret } = setup("int x=1\nbelow");
        pane.viewState.selections = [createCursorSelection(0, 7)];
        const answer = deferred();
        answerWith(() => answer.promise);
        pane.typeText(";");
        pane.viewState.document.applyEdits([{ range: createRange(1, 0, 1, 0), text: "#" }]);
        answer.resolve(SPACED_EQUALS);
        await settle();
        expect(text()).toBe("int x = 1;\n#below");
        expect(caret()).toEqual({ line: 0, character: 10 });
    });

    it("the token of a dropped request is cancelled, and only by what drops it", () => {
        const registry = new LanguageFeatureRegistry<OnTypeFormattingEditProvider>();
        const tokens: ICancellationToken[] = [];
        registry.register("*", {
            triggerCharacters: [";"],
            provideOnTypeFormattingEdits: (_request, token) => {
                tokens.push(token);
                return new Promise(() => undefined);
            },
        });
        const pane = createEditorPane();
        pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "a\nb" }]);
        const controller = new FormatOnTypeController(pane, { providers: registry, isSettingEnabled: () => true });
        pane.typeText(";");
        pane.viewState.document.applyEdits([{ range: createRange(1, 0, 1, 0), text: "#" }]);
        expect(tokens[0].isCancellationRequested).toBe(false);

        pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "#" }]);
        expect(tokens[0].isCancellationRequested).toBe(true);
        controller.dispose();
    });

    it("a reload of the document drops the answer", async () => {
        const { pane, text, answerWith } = setup();
        const answer = deferred();
        answerWith(() => answer.promise);
        pane.typeText(";");
        pane.viewState.document.setText("reloaded");
        answer.resolve(SPACED_EQUALS);
        await settle();
        expect(text()).toBe("reloaded");
    });

    it("disposing the controller drops the answer", async () => {
        const { pane, text, answerWith, controller } = setup();
        const answer = deferred();
        answerWith(() => answer.promise);
        pane.typeText(";");
        controller.dispose();
        answer.resolve(SPACED_EQUALS);
        await settle();
        expect(text()).toBe("int x=1;");
    });

    it("a failed provider changes nothing", async () => {
        const { pane, text, answerWith } = setup();
        answerWith(() => Promise.reject(new Error("boom")));
        pane.typeText(";");
        await settle();
        expect(text()).toBe("int x=1;");
    });

    it("the format is its own undo step", async () => {
        const { pane, text } = setup();
        pane.typeText(";");
        await settle();
        expect(text()).toBe("int x = 1;");

        pane.undo();
        expect(text()).toBe("int x=1;");
        pane.undo();
        expect(text()).toBe("int x=1");
        pane.redo();
        pane.redo();
        expect(text()).toBe("int x = 1;");
    });

    it("typing after the format starts a step of its own", async () => {
        const { pane, text } = setup();
        pane.typeText(";");
        await settle();
        pane.typeText("y");
        pane.undo();
        expect(text()).toBe("int x = 1;");
    });
});

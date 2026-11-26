import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../../TestUtils/testActiveEditorService.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection, createSelection } from "../../../../editor/common/core/iSelection.ts";
import { textWordHighlightSet } from "../../../../editor/common/languages/iDocumentHighlightSource.ts";
import { computeWordOccurrences } from "../../../../editor/contrib/find/computeWordOccurrences.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { WORD_HIGHLIGHTER_ACTIONS } from "./wordHighlighterActions.ts";

let ws: ITempWorkspace;

function setup(service: ReturnType<typeof createTestActiveEditorService>) {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    contextKeys.set("hasWordHighlights", true);
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => service);
    accessor.bind(ContextKeyServiceDIToken, () => contextKeys);
    for (const action of WORD_HIGHLIGHTER_ACTIONS) registerAction(commands, keybindings, accessor, action);
    return { commands, keybindings, contextKeys };
}

/** The set on the frame, as the query would have computed it for the caret at the start of the document. */
function openEditor(content: string) {
    const editor = createEditorPane();
    editor.openFile(Uri.file(ws.writeFile("doc.txt", content)));
    editor.viewState.wordHighlights = textWordHighlightSet(
        computeWordOccurrences(editor.viewState.document, { line: 0, character: 0 }),
    );
    return { editor, ...setup(createTestActiveEditorService(editor)) };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-word-highlighter-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("WORD_HIGHLIGHTER_ACTIONS", () => {
    it("wordHighlight.next moves the cursor to the next occurrence", () => {
        const { editor, commands } = openEditor("foo\nbar foo");
        commands.execute("editor.action.wordHighlight.next");
        expect(editor.viewState.selections).toEqual([createCursorSelection(1, 4)]);
    });

    it("wordHighlight.prev moves to the previous one, cyclically", () => {
        const { editor, commands } = openEditor("foo\nbar foo\nfoo");
        commands.execute("editor.action.wordHighlight.prev");
        expect(editor.viewState.selections).toEqual([createCursorSelection(2, 0)]);
    });

    it("without an active editor: a silent no-op", () => {
        const { commands } = setup(createTestActiveEditorService(null));
        for (const action of WORD_HIGHLIGHTER_ACTIONS) {
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });

    it("F7 / Shift+F7 work with focus in the editor text", () => {
        const { keybindings } = openEditor("foo");
        const contextKeys = new ContextKeyService();
        contextKeys.set("editorTextFocus", true);
        contextKeys.set("hasWordHighlights", true);
        expect(keybindings.resolveKey(parseKeybinding("f7"), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "editor.action.wordHighlight.next",
        });
        expect(keybindings.resolveKey(parseKeybinding("shift+f7"), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "editor.action.wordHighlight.prev",
        });
    });

    it("without highlights F7 falls through and the commands do nothing (precondition)", () => {
        const { editor, keybindings, commands, contextKeys } = openEditor("foo foo");
        contextKeys.set("editorTextFocus", true);
        contextKeys.set("hasWordHighlights", false);
        expect(keybindings.resolveKey(parseKeybinding("f7"), contextKeys)).toEqual({ kind: "none" });
        expect(keybindings.resolveKey(parseKeybinding("shift+f7"), contextKeys)).toEqual({ kind: "none" });

        commands.execute("editor.action.wordHighlight.next");
        commands.execute("editor.action.wordHighlight.prev");
        expect(editor.viewState.selections).toEqual([createCursorSelection(0, 0)]);
    });

    it("wordHighlight.trigger highlights at once, also with a selection wider than a word", () => {
        const { editor, commands } = openEditor("foo bar foo");
        editor.viewState.selections = [createSelection(0, 0, 0, 7)];
        expect(editor.viewState.wordHighlights.ranges).toEqual([]);

        commands.execute("editor.action.wordHighlight.trigger");

        expect(editor.viewState.wordHighlights.ranges).toHaveLength(1);
    });

    it("wordHighlight.trigger has no keybinding and no precondition", () => {
        const action = WORD_HIGHLIGHTER_ACTIONS.find(({ id }) => id === "editor.action.wordHighlight.trigger");
        expect(action?.title).toBe("Trigger Symbol Highlight");
        expect(action?.keybinding).toBeUndefined();
        expect(action?.enablement).toBeUndefined();
    });

    it("outside the editor text F7 is free", () => {
        const { keybindings } = openEditor("foo");
        const contextKeys = new ContextKeyService();
        contextKeys.set("editorTextFocus", false);
        contextKeys.set("hasWordHighlights", true);
        expect(keybindings.resolveKey(parseKeybinding("f7"), contextKeys)).toEqual({ kind: "none" });
    });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestActiveEditorService } from "../../../../../TestUtils/testActiveEditorService.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { WORD_HIGHLIGHTER_ACTIONS } from "./wordHighlighterActions.ts";

let ws: ITempWorkspace;

function setup(service: ReturnType<typeof createTestActiveEditorService>) {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => service);
    for (const action of WORD_HIGHLIGHTER_ACTIONS) registerAction(commands, keybindings, accessor, action);
    return { commands, keybindings };
}

function openEditor(content: string) {
    const editor = createEditorPane();
    editor.openFile(Uri.file(ws.writeFile("doc.txt", content)));
    return { editor, ...setup(createTestActiveEditorService(editor)) };
}

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-word-highlighter-actions-" });
});
afterEach(() => {
    ws.dispose();
});

describe("WORD_HIGHLIGHTER_ACTIONS", () => {
    it("wordHighlight.next ведёт каретку на следующее вхождение", () => {
        const { editor, commands } = openEditor("foo\nbar foo");
        commands.execute("editor.action.wordHighlight.next");
        expect(editor.viewState.selections).toEqual([createCursorSelection(1, 4)]);
    });

    it("wordHighlight.prev — на предыдущее, циклически", () => {
        const { editor, commands } = openEditor("foo\nbar foo\nfoo");
        commands.execute("editor.action.wordHighlight.prev");
        expect(editor.viewState.selections).toEqual([createCursorSelection(2, 0)]);
    });

    it("без активного редактора — тихий no-op", () => {
        const { commands } = setup(createTestActiveEditorService(null));
        for (const action of WORD_HIGHLIGHTER_ACTIONS) {
            expect(() => commands.execute(action.id)).not.toThrow();
        }
    });

    it("F7 / Shift+F7 — при фокусе в тексте редактора", () => {
        const { keybindings } = openEditor("foo");
        const contextKeys = new ContextKeyService();
        contextKeys.set("editorTextFocus", true);
        expect(keybindings.resolveKey(parseKeybinding("f7"), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "editor.action.wordHighlight.next",
        });
        expect(keybindings.resolveKey(parseKeybinding("shift+f7"), contextKeys)).toMatchObject({
            kind: "command",
            commandId: "editor.action.wordHighlight.prev",
        });
    });

    it("вне текста редактора F7 свободен", () => {
        const { keybindings } = openEditor("foo");
        const contextKeys = new ContextKeyService();
        contextKeys.set("editorTextFocus", false);
        expect(keybindings.resolveKey(parseKeybinding("f7"), contextKeys)).toEqual({ kind: "none" });
    });
});

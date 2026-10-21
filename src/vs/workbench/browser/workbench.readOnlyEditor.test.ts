import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { EndOfLine } from "../../editor/common/core/endOfLine.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../editor/common/core/iTextEdit.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

const TOGGLE_READONLY = "workbench.action.files.toggleActiveEditorReadonlyInSession";

/**
 * Catches what the core unit tests can't see by design: whether
 * `editorReadonly` is set and whether the when clause fires.
 */
describe("Workbench — read-only editor", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-readonly-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("alpha.txt"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function contextKeys() {
        return h.container.get(ContextKeyServiceDIToken);
    }

    it("без открытых редакторов toggle — no-op, а не падение", () => {
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();

        expect(() => h.commands.execute(TOGGLE_READONLY)).not.toThrow();
        expect(contextKeys().get("editorReadonly")).toBe(false);
    });

    describe("контекст-ключ editorReadonly", () => {
        it("по умолчанию false у сфокусированного редактора", () => {
            expect(contextKeys().get("textInputFocus")).toBe(true);
            expect(contextKeys().get("editorReadonly")).toBe(false);
        });

        it("команда toggle поднимает и опускает его", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(contextKeys().get("editorReadonly")).toBe(true);

            h.commands.execute(TOGGLE_READONLY);
            expect(contextKeys().get("editorReadonly")).toBe(false);
        });

        it("сбрасывается, когда фокус ушёл из редактора", () => {
            // Otherwise the key would stick from the previous editor and suppress commands
            // where there is no read-only at all.
            h.commands.execute(TOGGLE_READONLY);
            expect(contextKeys().get("editorReadonly")).toBe(true);

            const tree = h.testApp.querySelector("TreeViewElement");
            expect(tree).not.toBeNull();
            tree!.focus();

            expect(contextKeys().get("editorReadonly")).toBe(false);
        });
    });

    describe("мутирующие команды не доезжают до документа", () => {
        // Through the command registry rather than a direct viewState call: this tests the
        // when clause, which the core unit tests don't touch by design.
        const mutating = [
            "deleteLeft",
            "deleteRight",
            "deleteWordLeft",
            "deleteWordRight",
            "editor.action.indentLines",
            "editor.action.outdentLines",
        ];

        for (const command of mutating) {
            it(`${command} — документ не меняется`, () => {
                h.commands.execute(TOGGLE_READONLY);

                h.commands.execute(command);

                expect(h.activeEditor().getText()).toBe("Alpha");
                expect(h.activeEditor().isModified).toBe(false);
            });
        }

        it("ввод с клавиатуры не меняет документ и не пачкает буфер", () => {
            h.commands.execute(TOGGLE_READONLY);

            h.testApp.sendKey("X");
            h.testApp.sendKey("Enter");
            h.testApp.sendKey("Backspace");

            expect(h.activeEditor().getText()).toBe("Alpha");
            expect(h.activeEditor().isModified).toBe(false);
        });
    });

    describe("чтение остаётся доступным", () => {
        it("навигация и выделение работают", () => {
            h.commands.execute(TOGGLE_READONLY);

            h.commands.execute("cursorRight");
            expect(h.activeEditor().viewState.selections[0].active.character).toBe(1);

            h.commands.execute("editor.action.selectAll");
            expect(h.activeEditor().viewState.getSelectedText()).toBe("Alpha");
        });

        it("копирование разрешено, вырезание — нет", () => {
            h.commands.execute("editor.action.selectAll");
            h.commands.execute(TOGGLE_READONLY);

            h.commands.execute("editor.action.clipboardCutAction");

            expect(h.activeEditor().getText()).toBe("Alpha");
        });
    });

    describe("вкладка помечена замком", () => {
        // Down to the frame, not to TabInfo: without the EditorService → syncTabs subscription the lock
        // appeared only on the next tab switch.
        const LOCK = "\uea75"; // nf-cod-lock, see editorTabItemElement.ts

        function frame(): string {
            h.testApp.render();
            return h.testApp.backend.screenToString();
        }

        it("замка нет, пока редактор writable", () => {
            expect(frame()).not.toContain(LOCK);
        });

        it("toggle показывает и убирает замок", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(frame()).toContain(LOCK);

            h.commands.execute(TOGGLE_READONLY);
            expect(frame()).not.toContain(LOCK);
        });
    });

    describe("гейт when-клауз (слой кейбиндов)", () => {
        // The EditorViewState/TextEditorPane guards hold the line on their own, so the when clause can't be
        // observed via the document — verified: the tests above pass even with `&& !editorReadonly` removed.
        function resolve(key: string, ctrlKey = false) {
            return h.container
                .get(KeybindingRegistryDIToken)
                .resolveKey({ key, ctrlKey, shiftKey: false, altKey: false, metaKey: false }, contextKeys());
        }

        it("Backspace резолвится в deleteLeft, пока редактор writable", () => {
            expect(resolve("Backspace")).toEqual({
                kind: "command",
                commandId: "deleteLeft",
                when: "textInputFocus && !editorReadonly",
            });
        });

        it("в read-only Backspace не резолвится ни в какую команду", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(resolve("Backspace")).toEqual({ kind: "none" });
        });

        it("Ctrl+Z в read-only не резолвится в undo", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(resolve("z", true)).toEqual({ kind: "none" });
        });

        it("немутирующие кейбинды в read-only остаются рабочими", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(resolve("ArrowRight")).toEqual({
                kind: "command",
                commandId: "cursorRight",
                // Wider than textInputFocus: the cursor in a diff moves with the same keybinding.
                when: "textViewFocus",
            });
            expect(resolve("c", true)).toMatchObject({
                kind: "command",
                commandId: "editor.action.clipboardCopyAction",
            });
        });
    });

    describe("пути мимо EditorViewState", () => {
        it("undo/redo не откатывают правки, сделанные до включения флага", () => {
            // The edits went to the undo stack while the editor was writable; in read-only
            // undoing is as much a document mutation as typing.
            h.testApp.sendKey("X");
            expect(h.activeEditor().getText()).toBe("XAlpha");

            h.commands.execute(TOGGLE_READONLY);
            h.commands.execute("undo");

            expect(h.activeEditor().getText()).toBe("XAlpha");
        });

        it("applyExternalEdits не проходит — общий вход suggest, rename/bulkEdit и extension host", () => {
            // Suggest, rename/bulkEdit and the extension host converge on applyExternalEdits →
            // EditorViewState.applyEdits; when clauses don't cover programmatic paths.
            h.commands.execute(TOGGLE_READONLY);

            h.activeEditor().applyExternalEdits([createTextEdit(createRange(0, 0, 0, 5), "Beta")], "external edit");

            expect(h.activeEditor().getText()).toBe("Alpha");
            expect(h.activeEditor().isModified).toBe(false);
        });

        it("TextEditorPane сам отбивает setEol/setEncoding/redo", () => {
            // Programmatic calls bypass both the when clause and the command's early exit.
            const editor = h.activeEditor();
            const eolBefore = editor.eol;
            const encodingBefore = editor.encoding;
            h.testApp.sendKey("X");
            h.commands.execute("undo");
            expect(editor.getText()).toBe("Alpha");

            editor.readOnly = true;
            editor.setEol(eolBefore === EndOfLine.LF ? EndOfLine.CRLF : EndOfLine.LF);
            editor.setEncoding("windows1251");
            editor.redo();

            expect(editor.eol).toBe(eolBefore);
            expect(editor.encoding).toBe(encodingBefore);
            expect(editor.getText()).toBe("Alpha");
        });

        it("повторная установка того же значения не будит подписчиков", () => {
            const editor = h.activeEditor();
            let fired = 0;
            const sub = editor.onDidChangeReadOnly(() => {
                fired++;
            });

            editor.readOnly = true;
            editor.readOnly = true;

            expect(fired).toBe(1);
            sub.dispose();
            editor.readOnly = false;
            expect(fired).toBe(1);
        });

        it("перечитка документа не снимает read-only", async () => {
            // rebuildForReloadedDocument recreates EditorViewState and used to lose the flag: after
            // "Reopen with Encoding" the tab silently became editable.
            const editor = h.activeEditor();
            h.commands.execute(TOGGLE_READONLY);

            await editor.reopenWithEncoding("windows1251");

            expect(editor.readOnly).toBe(true);
            // Focus survives the reload — the key must stay, otherwise mutating commands
            // would be unblocked on a read-only tab.
            expect(contextKeys().get("textInputFocus")).toBe(true);
            expect(contextKeys().get("editorReadonly")).toBe(true);
            expect(editor.viewState.type("X")).toBeUndefined();
        });

        it("смена EOL заблокирована", () => {
            const before = h.activeEditor().eol;
            h.commands.execute(TOGGLE_READONLY);

            h.commands.execute("workbench.action.editor.toggleEOL");

            expect(h.activeEditor().eol).toBe(before);
            expect(h.activeEditor().isModified).toBe(false);
        });
    });
});

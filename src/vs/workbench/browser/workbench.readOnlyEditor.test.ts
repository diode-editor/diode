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

    it("without open editors toggle is a no-op, not a crash", () => {
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();

        expect(() => h.commands.execute(TOGGLE_READONLY)).not.toThrow();
        expect(contextKeys().get("editorReadonly")).toBe(false);
    });

    describe("editorReadonly context key", () => {
        it("false by default for the focused editor", () => {
            expect(contextKeys().get("textInputFocus")).toBe(true);
            expect(contextKeys().get("editorReadonly")).toBe(false);
        });

        it("the toggle command sets and clears it", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(contextKeys().get("editorReadonly")).toBe(true);

            h.commands.execute(TOGGLE_READONLY);
            expect(contextKeys().get("editorReadonly")).toBe(false);
        });

        it("resets when focus leaves the editor", () => {
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

    describe("mutating commands do not reach the document", () => {
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
            it(`${command} leaves the document unchanged`, () => {
                h.commands.execute(TOGGLE_READONLY);

                h.commands.execute(command);

                expect(h.activeEditor().getText()).toBe("Alpha");
                expect(h.activeEditor().isModified).toBe(false);
            });
        }

        it("keyboard input does not change the document or dirty the buffer", () => {
            h.commands.execute(TOGGLE_READONLY);

            h.testApp.sendKey("X");
            h.testApp.sendKey("Enter");
            h.testApp.sendKey("Backspace");

            expect(h.activeEditor().getText()).toBe("Alpha");
            expect(h.activeEditor().isModified).toBe(false);
        });
    });

    describe("reading stays available", () => {
        it("navigation and selection work", () => {
            h.commands.execute(TOGGLE_READONLY);

            h.commands.execute("cursorRight");
            expect(h.activeEditor().viewState.selections[0].active.character).toBe(1);

            h.commands.execute("editor.action.selectAll");
            expect(h.activeEditor().viewState.getSelectedText()).toBe("Alpha");
        });

        it("copy is allowed, cut is not", () => {
            h.commands.execute("editor.action.selectAll");
            h.commands.execute(TOGGLE_READONLY);

            h.commands.execute("editor.action.clipboardCutAction");

            expect(h.activeEditor().getText()).toBe("Alpha");
        });
    });

    describe("the tab is marked with a lock", () => {
        // Down to the frame, not to TabInfo: without the EditorService → syncTabs subscription the lock
        // appeared only on the next tab switch.
        const LOCK = "\uea75"; // nf-cod-lock, see editorTabItemElement.ts

        function frame(): string {
            h.testApp.render();
            return h.testApp.backend.screenToString();
        }

        it("no lock while the editor is writable", () => {
            expect(frame()).not.toContain(LOCK);
        });

        it("toggle shows and removes the lock", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(frame()).toContain(LOCK);

            h.commands.execute(TOGGLE_READONLY);
            expect(frame()).not.toContain(LOCK);
        });
    });

    describe("when-clause gate (keybinding layer)", () => {
        // The EditorViewState/TextEditorPane guards hold the line on their own, so the when clause can't be
        // observed via the document — verified: the tests above pass even with `&& !editorReadonly` removed.
        function resolve(key: string, ctrlKey = false) {
            return h.container
                .get(KeybindingRegistryDIToken)
                .resolveKey({ key, ctrlKey, shiftKey: false, altKey: false, metaKey: false }, contextKeys());
        }

        it("Backspace resolves to deleteLeft while the editor is writable", () => {
            expect(resolve("Backspace")).toEqual({
                kind: "command",
                commandId: "deleteLeft",
                when: "textInputFocus && !editorReadonly",
            });
        });

        it("in read-only Backspace resolves to no command", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(resolve("Backspace")).toEqual({ kind: "none" });
        });

        it("Ctrl+Z in read-only does not resolve to undo", () => {
            h.commands.execute(TOGGLE_READONLY);
            expect(resolve("z", true)).toEqual({ kind: "none" });
        });

        it("non-mutating keybindings keep working in read-only", () => {
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

    describe("paths bypassing EditorViewState", () => {
        it("undo/redo do not revert edits made before the flag was set", () => {
            // The edits went to the undo stack while the editor was writable; in read-only
            // undoing is as much a document mutation as typing.
            h.testApp.sendKey("X");
            expect(h.activeEditor().getText()).toBe("XAlpha");

            h.commands.execute(TOGGLE_READONLY);
            h.commands.execute("undo");

            expect(h.activeEditor().getText()).toBe("XAlpha");
        });

        it("applyExternalEdits is blocked: the shared entry for suggest, rename/bulkEdit and the extension host", () => {
            // Suggest, rename/bulkEdit and the extension host converge on applyExternalEdits →
            // EditorViewState.applyEdits; when clauses don't cover programmatic paths.
            h.commands.execute(TOGGLE_READONLY);

            h.activeEditor().applyExternalEdits([createTextEdit(createRange(0, 0, 0, 5), "Beta")], "external edit");

            expect(h.activeEditor().getText()).toBe("Alpha");
            expect(h.activeEditor().isModified).toBe(false);
        });

        it("TextEditorPane itself rejects setEol/setEncoding/redo", () => {
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

        it("setting the same value again does not wake subscribers", () => {
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

        it("reloading the document does not clear read-only", async () => {
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

        it("changing EOL is blocked", () => {
            const before = h.activeEditor().eol;
            h.commands.execute(TOGGLE_READONLY);

            h.commands.execute("workbench.action.editor.toggleEOL");

            expect(h.activeEditor().eol).toBe(before);
            expect(h.activeEditor().isModified).toBe(false);
        });
    });
});

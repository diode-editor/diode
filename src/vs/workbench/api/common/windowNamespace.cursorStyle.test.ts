import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { TextEditorCursorStyle, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = Uri.file("/a.ts").toString();

function makeCtx(user: Record<string, unknown> = {}) {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const configStore = new WorkspaceConfigStore();
    configStore.setData({ user });
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore,
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const window = createWindowNamespace(ctx);
    stub.fire("editor.activeEditorChanged", { uri: URI, languageId: "typescript" });
    const editor = window.activeTextEditor!;
    const cursorRequests = () =>
        stub.requests.filter(
            (request) =>
                request.method === "editor.setOptions" &&
                (request.params as { cursorStyle?: number }).cursorStyle !== undefined,
        );
    return { stub, configStore, editor, cursorRequests };
}

describe("WindowNamespace — TextEditor.options.cursorStyle", () => {
    it("unset everywhere, the getter has no cursorStyle key", () => {
        const { editor } = makeCtx();
        expect(editor.options).toEqual({});
        expect("cursorStyle" in editor.options).toBe(false);
    });

    it("the getter reads editor.cursorStyle with the document's language override", () => {
        const { editor } = makeCtx({
            "editor.cursorStyle": "line",
            "[typescript]": { "editor.cursorStyle": "underline" },
        });
        expect(editor.options.cursorStyle).toBe(TextEditorCursorStyle.Underline);
    });

    it("an unknown setting value reads as no style", () => {
        const { editor } = makeCtx({ "editor.cursorStyle": "beam" });
        expect(editor.options.cursorStyle).toBeUndefined();
    });

    it("the setter sends the style with uri and group, and the getter has it at once", () => {
        const { stub, editor } = makeCtx({ "editor.cursorStyle": "line" });
        const options = editor.options;
        options.cursorStyle = TextEditorCursorStyle.Block;
        editor.options = options;

        expect(editor.options.cursorStyle).toBe(TextEditorCursorStyle.Block);
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { cursorStyle: TextEditorCursorStyle.Block, uri: URI, groupId: 1 },
        });
    });

    it("the style the editor already has is not sent, so it does not become an override", () => {
        const { configStore, editor, cursorRequests } = makeCtx({ "editor.cursorStyle": "line" });
        editor.options = { ...editor.options, tabSize: 2 };
        expect(cursorRequests()).toEqual([]);

        configStore.setData({ user: { "editor.cursorStyle": "block" } });
        expect(editor.options.cursorStyle).toBe(TextEditorCursorStyle.Block);
    });

    it("an override outlives a settings change", () => {
        const { configStore, editor } = makeCtx({ "editor.cursorStyle": "line" });
        editor.options = { cursorStyle: TextEditorCursorStyle.BlockOutline };
        configStore.setData({ user: { "editor.cursorStyle": "underline" } });
        expect(editor.options.cursorStyle).toBe(TextEditorCursorStyle.BlockOutline);
    });

    it("a value outside the enum is neither sent nor kept", () => {
        const { editor, cursorRequests } = makeCtx();
        for (const invalid of [0, 7, 2.5, "2"]) {
            editor.options = { cursorStyle: invalid } as never;
        }
        expect(cursorRequests()).toEqual([]);
        expect(editor.options).toEqual({});
    });

    it("other options the extension set stay readable next to the style", () => {
        const { editor } = makeCtx();
        editor.options = { tabSize: 2, cursorStyle: TextEditorCursorStyle.Line };
        expect(editor.options).toEqual({ tabSize: 2, cursorStyle: TextEditorCursorStyle.Line });
        editor.options = { insertSpaces: true };
        expect(editor.options).toEqual({ tabSize: 2, insertSpaces: true, cursorStyle: TextEditorCursorStyle.Line });
    });
});

import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { TextEditorCursorStyle, TextEditorLineNumbersStyle, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import type { IWireEditorLayout, IWireTabSnapshot } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const FILE = Uri.file("/ws/main.ts").toString();
const RANGE = { start: { line: 0, character: 0 }, end: { line: 9, character: 4 } };

function textTab(uri: string, extra: Partial<IWireTabSnapshot> = {}): IWireTabSnapshot {
    return {
        uri,
        label: "tab",
        isActive: true,
        isDirty: false,
        kind: "text",
        tabSize: 4,
        insertSpaces: true,
        ...extra,
    };
}

/** `main.ts` in both groups, the first one active. */
function twoGroups(): IWireEditorLayout {
    return {
        groups: [1, 2].map((groupId) => ({
            groupId,
            viewColumn: groupId,
            isActive: groupId === 1,
            tabs: [textTab(FILE)],
        })),
    };
}

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
    stub.fire("editor.layoutChanged", twoGroups());
    stub.fire("editor.activeEditorChanged", { uri: FILE, languageId: "typescript", groupId: 1 });
    const editorIn = (viewColumn: vscode.ViewColumn): vscode.TextEditor => {
        const editor = window.visibleTextEditors.find((candidate) => candidate.viewColumn === viewColumn);
        if (editor === undefined) throw new Error(`no editor in column ${String(viewColumn)}`);
        return editor;
    };
    const events: vscode.TextEditorOptionsChangeEvent[] = [];
    window.onDidChangeTextEditorOptions((e) => events.push(e));
    const report = (groupId: number, options: object, extra: object = {}): void => {
        stub.fire("editor.propertiesChanged", { uri: FILE, groupId, options, ...extra });
    };
    return { stub, window, editorIn, events, report };
}

const REPORTED = { tabSize: 2, insertSpaces: false, cursorStyle: TextEditorCursorStyle.Block };
const RESOLVED = {
    tabSize: 2,
    indentSize: 2,
    insertSpaces: false,
    cursorStyle: TextEditorCursorStyle.Block,
    lineNumbers: TextEditorLineNumbersStyle.On,
};

describe("WindowNamespace — window.onDidChangeTextEditorOptions", () => {
    it("[api:window.onDidChangeTextEditorOptions] fires with the editor and its resolved options, the getter already updated", () => {
        const { window, editorIn, events, report } = makeCtx();
        const seen: unknown[] = [];
        window.onDidChangeTextEditorOptions((e) => seen.push({ ...e.textEditor.options }));

        report(2, REPORTED);

        expect(events).toHaveLength(1);
        expect(events[0].textEditor).toBe(editorIn(2));
        expect(events[0].options).toEqual(RESOLVED);
        expect(seen).toEqual([RESOLVED]);
    });

    it("the editor of the other group is untouched", () => {
        const { editorIn, report } = makeCtx();
        report(2, REPORTED);
        expect({ ...editorIn(1).options }).toEqual({
            tabSize: 4,
            indentSize: 4,
            insertSpaces: true,
            cursorStyle: TextEditorCursorStyle.Line,
            lineNumbers: TextEditorLineNumbersStyle.On,
        });
    });

    it("options fire before the visible ranges of the same message, as upstream", () => {
        const { window, events, report } = makeCtx();
        const order: string[] = [];
        window.onDidChangeTextEditorOptions(() => order.push("options"));
        window.onDidChangeTextEditorVisibleRanges((e) => order.push(`ranges ${String(e.textEditor.options.tabSize)}`));

        report(1, REPORTED, { visibleRanges: [RANGE] });

        expect(order).toEqual(["options", "ranges 2"]);
        expect(events).toHaveLength(1);
    });

    it("a message without options fires none; malformed options are dropped, the message still applies", () => {
        const { stub, events, window } = makeCtx();
        let ranges = 0;
        window.onDidChangeTextEditorVisibleRanges(() => ranges++);

        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 1, visibleRanges: [RANGE] });
        stub.fire("editor.propertiesChanged", {
            uri: FILE,
            groupId: 1,
            options: { tabSize: "2", insertSpaces: false, cursorStyle: 2 },
        });

        expect(events).toEqual([]);
        expect(ranges).toBe(1);
    });

    it("the lineNumbers of the event and the getter come from editor.lineNumbers", () => {
        const { events, report } = makeCtx({ "editor.lineNumbers": "relative" });
        report(1, REPORTED);
        expect(events[0].options.lineNumbers).toBe(TextEditorLineNumbersStyle.Relative);
    });
});

describe("WindowNamespace — TextEditor.options reads the editor's values (#1231)", () => {
    it("[api:TextEditor.options] before any report, the tab's indentation", () => {
        const { editorIn } = makeCtx();
        expect(editorIn(1).options).toMatchObject({ tabSize: 4, indentSize: 4, insertSpaces: true });
    });

    it("[api:TextEditor.options] an assignment reads back at once, then the host's report replaces it", () => {
        const { stub, editorIn, events, report } = makeCtx();
        const editor = editorIn(2);

        editor.options = { tabSize: 8, insertSpaces: false };
        expect(editor.options).toMatchObject({ tabSize: 8, indentSize: 8, insertSpaces: false });
        expect(events).toEqual([]);
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { tabSize: 8, insertSpaces: false, uri: FILE, groupId: 2 },
        });

        // The host applied something else (a `.editorconfig`, a clamp): its value wins and the extension hears of it.
        report(2, { tabSize: 6, insertSpaces: false, cursorStyle: TextEditorCursorStyle.Line });
        expect(editor.options).toMatchObject({ tabSize: 6, insertSpaces: false });
        expect(events).toHaveLength(1);
    });

    it('[api:TextEditor.options] "auto" reads as a number and a boolean, never as "auto"', () => {
        const { stub, editorIn } = makeCtx();
        const editor = editorIn(1);
        editor.options = { tabSize: "auto", insertSpaces: "auto" };
        expect(editor.options.tabSize).toBe(4);
        expect(editor.options.insertSpaces).toBe(true);
        expect(stub.requests.at(-1)?.params).toEqual({ insertSpaces: true, uri: FILE, groupId: 1 });
    });

    it("[api:TextEditor.options] an assigned indentSize is the tab size", () => {
        const { editorIn } = makeCtx();
        const editor = editorIn(1);
        editor.options = { indentSize: 3 };
        expect(editor.options).toMatchObject({ tabSize: 3, indentSize: 3 });
    });

    it("an assignment that changes nothing sends nothing", () => {
        const { stub, editorIn } = makeCtx();
        editorIn(1).options = { lineNumbers: TextEditorLineNumbersStyle.Off, tabSize: "auto" };
        expect(stub.requests).toEqual([]);
    });

    it("a closed and reopened tab reads the snapshot again, not what the old editor was told", () => {
        const { stub, window, report } = makeCtx();
        report(1, REPORTED);
        stub.fire("editor.layoutChanged", { groups: [{ groupId: 1, viewColumn: 1, isActive: true, tabs: [] }] });
        stub.fire("editor.layoutChanged", twoGroups());
        const reopened = window.visibleTextEditors.find((editor) => editor.viewColumn === (1 as vscode.ViewColumn));
        expect(reopened?.options).toMatchObject({
            tabSize: 4,
            insertSpaces: true,
            cursorStyle: TextEditorCursorStyle.Line,
        });
    });
});

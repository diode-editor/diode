import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import type { IWireEditorLayout, IWireTabSnapshot } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const FILE = Uri.file("/ws/main.ts").toString();
const OTHER = Uri.file("/ws/other.ts").toString();
const ORIGINAL = "git:/ws/main.ts";

function wireRange(startLine: number, endLine: number, endCharacter: number) {
    return { start: { line: startLine, character: 0 }, end: { line: endLine, character: endCharacter } };
}

function textTab(uri: string, extra: Partial<IWireTabSnapshot> = {}): IWireTabSnapshot {
    return { uri, label: "tab", isActive: true, isDirty: false, kind: "text", ...extra };
}

function layoutOf(...groups: IWireTabSnapshot[][]): IWireEditorLayout {
    return {
        groups: groups.map((tabs, i) => ({ groupId: i + 1, viewColumn: i + 1, isActive: i === 0, tabs })),
    };
}

function makeCtx(initial: IWireEditorLayout = layoutOf([textTab(FILE, { visibleRanges: [wireRange(0, 9, 4)] })])) {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const window = createWindowNamespace(ctx);
    stub.fire("editor.layoutChanged", initial);
    stub.fire("editor.activeEditorChanged", { uri: FILE, languageId: "typescript", groupId: 1 });
    const events: vscode.TextEditorVisibleRangesChangeEvent[] = [];
    window.onDidChangeTextEditorVisibleRanges((e) => events.push(e));
    return { stub, window, events };
}

function activeEditor(window: typeof vscode.window): vscode.TextEditor {
    const editor = window.activeTextEditor;
    if (editor === undefined) throw new Error("no active editor");
    return editor;
}

describe("WindowNamespace — TextEditor.visibleRanges", () => {
    it("the layout snapshot seeds the active editor before any properties message", () => {
        const { window } = makeCtx();

        expect(activeEditor(window).visibleRanges).toEqual([new Range(0, 0, 9, 4)]);
    });

    it("editor.propertiesChanged fires once with the editor and the new ranges, the getter already updated", () => {
        const { stub, window, events } = makeCtx();
        const seen: (readonly vscode.Range[])[] = [];
        window.onDidChangeTextEditorVisibleRanges((e) => seen.push(e.textEditor.visibleRanges));

        stub.fire("editor.propertiesChanged", {
            uri: FILE,
            groupId: 1,
            visibleRanges: [wireRange(0, 2, 5), wireRange(8, 12, 1)],
        });

        const expected = [new Range(0, 0, 2, 5), new Range(8, 0, 12, 1)];
        expect(events).toHaveLength(1);
        expect(events[0].textEditor).toBe(window.activeTextEditor);
        expect(events[0].visibleRanges).toEqual(expected);
        expect(seen).toEqual([expected]);
    });

    it("an unchanged value fires nothing", () => {
        const { stub, events } = makeCtx();

        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 1, visibleRanges: [wireRange(0, 9, 4)] });

        expect(events).toEqual([]);
    });

    it("a message without ranges or with a broken one changes nothing", () => {
        const { stub, window, events } = makeCtx();

        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 1 });
        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 1, visibleRanges: [] });
        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 1, visibleRanges: [{ start: 1 }] });
        stub.fire("editor.propertiesChanged", { uri: 7, groupId: 1, visibleRanges: [wireRange(1, 2, 3)] });
        stub.fire("editor.propertiesChanged", { uri: FILE, visibleRanges: [wireRange(1, 2, 3)] });

        expect(events).toEqual([]);
        expect(activeEditor(window).visibleRanges).toEqual([new Range(0, 0, 9, 4)]);
    });

    it("each editor keeps its own ranges: one file in two groups is two editors", () => {
        const { stub, window, events } = makeCtx(
            layoutOf(
                [textTab(FILE, { visibleRanges: [wireRange(0, 9, 4)] })],
                [textTab(FILE, { visibleRanges: [wireRange(0, 9, 4)] })],
            ),
        );

        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 2, visibleRanges: [wireRange(40, 49, 2)] });

        const [left, right] = window.visibleTextEditors;
        expect(left.visibleRanges).toEqual([new Range(0, 0, 9, 4)]);
        expect(right.visibleRanges).toEqual([new Range(40, 0, 49, 2)]);
        expect(events.map((e) => e.textEditor)).toEqual([right]);
    });

    it("a later snapshot does not overwrite a known value: only the message changes it, with an event", () => {
        const { stub, window, events } = makeCtx();

        stub.fire("editor.layoutChanged", layoutOf([textTab(FILE, { visibleRanges: [wireRange(5, 14, 1)] })]));

        expect(activeEditor(window).visibleRanges).toEqual([new Range(0, 0, 9, 4)]);
        expect(events).toEqual([]);
    });

    it("the sides of a diff are seeded from the diff tab, each with its own ranges", () => {
        const { window } = makeCtx(
            layoutOf([
                {
                    uri: "diode-diff:/main.ts",
                    label: "diff",
                    isActive: true,
                    isDirty: false,
                    kind: "diff",
                    sideEditors: [ORIGINAL, FILE],
                    sideVisibleRanges: [[wireRange(0, 3, 1)], [wireRange(0, 5, 2)]],
                },
            ]),
        );

        expect(window.visibleTextEditors.map((editor) => editor.visibleRanges)).toEqual([
            [new Range(0, 0, 3, 1)],
            [new Range(0, 0, 5, 2)],
        ]);
    });

    it("a closed tab drops its ranges: a reopened editor starts from its new snapshot", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.propertiesChanged", { uri: FILE, groupId: 1, visibleRanges: [wireRange(20, 29, 2)] });

        stub.fire("editor.layoutChanged", layoutOf([textTab(OTHER)]));
        stub.fire("editor.layoutChanged", layoutOf([textTab(FILE, { visibleRanges: [wireRange(0, 9, 4)] })]));

        expect(window.visibleTextEditors[0].visibleRanges).toEqual([new Range(0, 0, 9, 4)]);
    });

    it("an editor that never had ranges reads an empty list", () => {
        const { window } = makeCtx(layoutOf([textTab(FILE)]));

        expect(activeEditor(window).visibleRanges).toEqual([]);
    });
});

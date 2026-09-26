import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Position, Selection, TextEditorSelectionChangeKind, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const FILE = Uri.file("/ws/main.ts").toString();
const OTHER = Uri.file("/ws/other.ts").toString();

/** Wire-выделение (0-based). */
function wire(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number) {
    return { anchorLine, anchorCharacter, activeLine, activeCharacter };
}

function makeCtx() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const window = createWindowNamespace(ctx);
    stub.fire("editor.activeEditorChanged", { uri: FILE, languageId: "typescript", groupId: 1 });
    return { stub, window };
}

describe("WindowNamespace — window.onDidChangeTextEditorSelection", () => {
    it("editor.selectionChanged даёт событие с редактором, выделениями и видом", () => {
        const { stub, window } = makeCtx();
        const events: vscode.TextEditorSelectionChangeEvent[] = [];
        window.onDidChangeTextEditorSelection((e) => events.push(e));

        stub.fire("editor.selectionChanged", {
            uri: FILE,
            groupId: 1,
            selections: [wire(2, 4, 2, 9)],
            kind: 2,
        });

        expect(events).toHaveLength(1);
        const event = events[0];
        expect(event.textEditor.document.uri.toString()).toBe(FILE);
        expect(event.selections).toHaveLength(1);
        expect(event.selections[0].anchor).toEqual(new Position(2, 4));
        expect(event.selections[0].active).toEqual(new Position(2, 9));
        expect(event.kind).toBe(TextEditorSelectionChangeKind.Mouse);
    });

    it("textEditor события — тот же объект, что window.activeTextEditor", () => {
        const { stub, window } = makeCtx();
        let seen: vscode.TextEditor | undefined;
        window.onDidChangeTextEditorSelection((e) => {
            seen = e.textEditor;
        });
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 3)] });
        expect(seen).toBe(window.activeTextEditor);
    });

    it("слушатель видит УЖЕ обновлённое выделение через editor.selections", () => {
        const { stub, window } = makeCtx();
        const fromEditor: number[] = [];
        window.onDidChangeTextEditorSelection((e) => {
            fromEditor.push(e.textEditor.selection.active.character);
        });
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 7)] });
        expect(fromEditor).toEqual([7]);
    });

    it("все выделения едут в событии, первое — первичное", () => {
        const { stub, window } = makeCtx();
        let selections: readonly vscode.Selection[] = [];
        window.onDidChangeTextEditorSelection((e) => {
            selections = e.selections;
        });
        stub.fire("editor.selectionChanged", {
            uri: FILE,
            groupId: 1,
            selections: [wire(1, 0, 1, 2), wire(3, 0, 3, 5)],
        });
        expect(selections).toHaveLength(2);
        expect(selections[0].active.line).toBe(1);
        expect(selections[1].active.line).toBe(3);
        expect(selections[0]).toBeInstanceOf(Selection);
    });

    it("kind отсутствует или не распознан → undefined (upstream это допускает)", () => {
        const { stub, window } = makeCtx();
        const kinds: (vscode.TextEditorSelectionChangeKind | undefined)[] = [];
        window.onDidChangeTextEditorSelection((e) => kinds.push(e.kind));
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 1)] });
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 2)], kind: 0 });
        stub.fire("editor.selectionChanged", {
            uri: FILE,
            groupId: 1,
            selections: [wire(0, 0, 0, 3)],
            kind: "mouse",
        });
        expect(kinds).toEqual([undefined, undefined, undefined]);
    });

    it("kind 1/3 → Keyboard/Command", () => {
        const { stub, window } = makeCtx();
        const kinds: (vscode.TextEditorSelectionChangeKind | undefined)[] = [];
        window.onDidChangeTextEditorSelection((e) => kinds.push(e.kind));
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 1)], kind: 1 });
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 2)], kind: 3 });
        expect(kinds).toEqual([TextEditorSelectionChangeKind.Keyboard, TextEditorSelectionChangeKind.Command]);
    });

    it("событие приходит и для НЕактивного редактора — со своим textEditor", () => {
        const { stub, window } = makeCtx();
        const uris: string[] = [];
        window.onDidChangeTextEditorSelection((e) => uris.push(e.textEditor.document.uri.toString()));
        stub.fire("editor.selectionChanged", { uri: OTHER, groupId: 2, selections: [wire(0, 0, 0, 1)] });
        expect(uris).toEqual([OTHER]);
        // Активный редактор при этом не сменился.
        expect(window.activeTextEditor?.document.uri.toString()).toBe(FILE);
    });

    it("сообщение без uri игнорируется целиком", () => {
        const { stub, window } = makeCtx();
        let fired = 0;
        window.onDidChangeTextEditorSelection(() => fired++);
        stub.fire("editor.selectionChanged", { groupId: 1, selections: [wire(0, 0, 0, 1)] });
        expect(fired).toBe(0);
    });

    it("подписка снимается dispose'ом", () => {
        const { stub, window } = makeCtx();
        let fired = 0;
        const sub = window.onDidChangeTextEditorSelection(() => fired++);
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 1)] });
        sub.dispose();
        stub.fire("editor.selectionChanged", { uri: FILE, groupId: 1, selections: [wire(0, 0, 0, 2)] });
        expect(fired).toBe(1);
    });

    it("выделение, поставленное самим расширением, события не даёт (эхо-гард на хосте)", () => {
        const { stub, window } = makeCtx();
        let fired = 0;
        window.onDidChangeTextEditorSelection(() => fired++);
        const editor = window.activeTextEditor;
        expect(editor).toBeDefined();
        // Присваивание уходит хосту нотификацией, локального события не рождает.
        editor!.selection = new Selection(new Position(5, 0), new Position(5, 2)) as unknown as vscode.Selection;
        expect(fired).toBe(0);
        expect(stub.notifies.at(-1)?.method).toBe("editor.setSelection");
    });
});

import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    EventEmitter,
    FileDecoration,
    OverviewRulerLane,
    Position,
    Range,
    Selection,
    ThemeColor,
    Uri,
} from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx() {
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
    return { stub, ctx, window: createWindowNamespace(ctx) };
}

describe("WindowNamespace", () => {
    it("terminals: createTerminal, terminals, activeTerminal and events are shared on window", () => {
        const { stub, window } = makeCtx();
        const opened: vscode.Terminal[] = [];
        const active: (vscode.Terminal | undefined)[] = [];
        const closed: vscode.Terminal[] = [];
        window.onDidOpenTerminal((t) => opened.push(t));
        window.onDidChangeActiveTerminal((t) => active.push(t));
        window.onDidCloseTerminal((t) => closed.push(t));
        const terminal = window.createTerminal("t");
        expect(window.terminals).toEqual([terminal]);
        stub.fire("terminal.opened", { id: 1, extHostId: 1, name: "t", launch: {} });
        stub.fire("terminal.activeChanged", { id: 1 });
        expect(window.activeTerminal).toBe(terminal);
        stub.fire("terminal.closed", { id: 1, reason: "user" });
        expect([opened, active, closed]).toEqual([[terminal], [terminal], [terminal]]);
        expect(window.terminals).toEqual([]);
    });

    it("activeEditorChanged with meta passes languageId/isDirty to the document", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", {
            uri: Uri.file("/a.ts").toString(),
            languageId: "typescript",
            isDirty: true,
        });
        const doc = window.activeTextEditor?.document as unknown as {
            languageId: string;
            isDirty: boolean;
            fileName: string;
        };
        expect(doc.fileName).toBe("/a.ts");
        expect(doc.languageId).toBe("typescript");
        expect(doc.isDirty).toBe(true);
    });

    it("activeEditorChanged passes encoding/eol to the document (#106)", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", {
            uri: Uri.file("/a.txt").toString(),
            languageId: "plaintext",
            isDirty: false,
            encoding: "windows1251",
            eol: 2,
        });
        const doc = window.activeTextEditor?.document as unknown as { encoding: string; eol: number };
        expect(doc.encoding).toBe("windows1251");
        expect(doc.eol).toBe(2);

        // Meta without encoding/eol (an older host) does not overwrite known values.
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.txt").toString() });
        expect(doc.encoding).toBe("windows1251");
    });

    it("editor.document is referentially stable across accesses", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString(), languageId: "typescript" });
        expect(window.activeTextEditor?.document).toBe(window.activeTextEditor?.document);
    });

    it("fileName=null → activeTextEditor undefined", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        expect(window.activeTextEditor).toBeDefined();
        stub.fire("editor.activeEditorChanged", { uri: null });
        expect(window.activeTextEditor).toBeUndefined();
    });

    it("setting options proxies to editor.setOptions", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { tabSize: 2, insertSpaces: true };
        expect(stub.requests).toContainEqual({
            method: "editor.setOptions",
            params: { tabSize: 2, insertSpaces: true, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it("indentSize is forwarded to editor.setOptions", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { indentSize: 3 } as never;
        expect(stub.requests).toContainEqual({
            method: "editor.setOptions",
            params: { indentSize: 3, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it('indentSize="tabSize" is not forwarded (same as tabSize)', () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { indentSize: "tabSize" } as never;
        expect(stub.requests).toHaveLength(0);
    });

    it("show*Message is sent to the host as a request with the right severity", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ index: null });
        await window.showErrorMessage("boom");
        await window.showWarningMessage("careful");
        await window.showInformationMessage("fyi");
        expect(stub.notifies).toEqual([]);
        expect(stub.requests).toEqual([
            {
                method: "window.showMessage",
                params: { severity: "error", message: "boom", modal: false, items: [] },
            },
            {
                method: "window.showMessage",
                params: { severity: "warn", message: "careful", modal: false, items: [] },
            },
            {
                method: "window.showMessage",
                params: { severity: "info", message: "fyi", modal: false, items: [] },
            },
        ]);
    });

    it("clicked button reaches the extension through window", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ index: 0 });
        await expect(window.showWarningMessage("careful", "Activate")).resolves.toBe("Activate");
    });

    it("showOpenDialog: options go to the host as a request (filters as pairs), answer is an extension Uri", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ uris: ["file:///ws/a.go", 5] });
        const picked = await window.showOpenDialog({
            defaultUri: Uri.file("/ws"),
            canSelectFiles: true,
            canSelectMany: false,
            openLabel: "Select",
            filters: { Go: ["go"], All: ["*"] },
            title: "Pick",
        });
        expect(picked?.map((uri) => uri.fsPath)).toEqual(["/ws/a.go"]);
        expect(stub.requests[0]).toEqual({
            method: "window.showOpenDialog",
            params: {
                defaultUri: "file:///ws",
                openLabel: "Select",
                canSelectFiles: true,
                canSelectFolders: undefined,
                canSelectMany: false,
                filters: [
                    { name: "Go", extensions: ["go"] },
                    { name: "All", extensions: ["*"] },
                ],
                title: "Pick",
            },
        });
    });

    it("showOpenDialog: cancel and junk answer yield undefined", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ uris: null });
        await expect(window.showOpenDialog()).resolves.toBeUndefined();
        stub.responder = () => null;
        await expect(window.showOpenDialog()).resolves.toBeUndefined();
        expect(stub.requests[0]?.params).toEqual({
            defaultUri: undefined,
            openLabel: undefined,
            canSelectFiles: undefined,
            canSelectFolders: undefined,
            canSelectMany: undefined,
            filters: undefined,
            title: undefined,
        });
    });

    it("showSaveDialog: resource Uri or undefined", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ uri: "file:///ws/new.txt" });
        const uri = await window.showSaveDialog({ defaultUri: Uri.file("/ws/new.txt"), saveLabel: "Save", title: "T" });
        expect(uri?.fsPath).toBe("/ws/new.txt");
        expect(stub.requests[0]).toEqual({
            method: "window.showSaveDialog",
            params: { defaultUri: "file:///ws/new.txt", saveLabel: "Save", filters: undefined, title: "T" },
        });
        stub.responder = () => ({ uri: null });
        await expect(window.showSaveDialog()).resolves.toBeUndefined();
        stub.responder = () => ({ uri: 7 });
        await expect(window.showSaveDialog()).resolves.toBeUndefined();
    });

    it("options without defaultUri let the host pick the dialog folder", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => null;
        await window.showOpenDialog({ title: "Pick" });
        await window.showSaveDialog({ title: "Save" });
        expect(stub.requests.map((request) => (request.params as { defaultUri?: string }).defaultUri)).toEqual([
            undefined,
            undefined,
        ]);
    });

    it("showQuickPick is sent to the host as a request and resolves with the selection", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ indices: [1] });
        await expect(window.showQuickPick(["a", "b"])).resolves.toBe("b");
        expect(stub.requests.map((r) => r.method)).toEqual(["window.showQuickPick"]);
    });

    it("createQuickPick returns a live picker: show() sends its state to the host", () => {
        const { stub, window } = makeCtx();
        const pick = window.createQuickPick();
        pick.title = "Pick";
        pick.show();
        expect(stub.notifies.map((n) => n.method)).toEqual(["window.quickPick.update"]);
        expect(stub.notifies[0]?.params).toMatchObject({ title: "Pick", visible: true });
    });

    it("showInputBox is sent to the host as a request and resolves with the input", async () => {
        const { stub, window } = makeCtx();
        stub.responder = () => ({ value: "Ada" });
        await expect(window.showInputBox({ title: "Your name" })).resolves.toBe("Ada");
        expect(stub.requests[0]).toMatchObject({
            method: "window.showInputBox",
            params: { title: "Your name" },
        });
    });

    it("window.state is focused; onDidChangeWindowState registers and does not fire", () => {
        const { window } = makeCtx();
        expect(window.state).toEqual({ focused: true, active: true });
        let fired = false;
        const bag: { dispose(): unknown }[] = [];
        const d = window.onDidChangeWindowState(() => (fired = true), undefined, bag as never);
        expect(bag).toContain(d);
        expect(typeof d.dispose).toBe("function");
        d.dispose();
        const d2 = window.onDidChangeWindowState(() => undefined);
        expect(typeof d2.dispose).toBe("function");
        expect(fired).toBe(false);
    });

    it("onDidChangeActiveTextEditor: thisArgs binds, disposables and dispose work", () => {
        const { stub, window } = makeCtx();
        const received: [unknown, unknown][] = [];
        const self = { tag: "self" };
        const bag: { dispose(): unknown }[] = [];
        const d = window.onDidChangeActiveTextEditor(
            function (this: { tag: string }, e) {
                received.push([this.tag, e]);
            },
            self,
            bag as never,
        );
        expect(bag).toContain(d);
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        expect(received[0][0]).toBe("self");
        d.dispose();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/b.ts").toString() });
        expect(received).toHaveLength(1);
        // a repeated dispose is safe (idx < 0)
        expect(() => {
            d.dispose();
        }).not.toThrow();
    });

    it("options accepts string tabSize/insertSpaces/indentSize", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { tabSize: "6", insertSpaces: "false" } as never;
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { tabSize: 6, insertSpaces: false, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
        window.activeTextEditor!.options = { insertSpaces: "auto" } as never;
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { insertSpaces: true, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
        window.activeTextEditor!.options = { indentSize: "3" } as never;
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { indentSize: 3, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it("options with junk strings degrades safely", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        // invalid tabSize → 4; invalid indentSize → not forwarded
        window.activeTextEditor!.options = { tabSize: "bad", indentSize: "bad" } as never;
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { tabSize: 4, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it("assigning a non-object to options and other properties is rejected", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        const editor = window.activeTextEditor!;
        // options = non-object → the set trap returns false (TypeError in strict mode)
        expect(() => {
            (editor as unknown as { options: unknown }).options = null;
        }).toThrow();
        // any other editor property is read-only
        expect(() => {
            (editor as unknown as { document: unknown }).document = {};
        }).toThrow();
        expect(stub.requests).toHaveLength(0);
    });

    it("createOutputChannel returns a channel; methods do not throw", () => {
        const { window } = makeCtx();
        const ch = window.createOutputChannel("editorconfig");
        expect(ch.name).toBe("editorconfig");
        expect(() => {
            ch.append("a");
            ch.appendLine("b");
            ch.replace("c");
            ch.clear();
            ch.show();
            ch.hide();
            ch.dispose();
        }).not.toThrow();
    });

    it("createTextEditorDecorationType sends notify with a serialized ThemeColor and a monotonic key", () => {
        const { stub, window } = makeCtx();
        const type = window.createTextEditorDecorationType({
            isWholeLine: true,
            overviewRulerLane: OverviewRulerLane.Left,
            overviewRulerColor: new ThemeColor("editorGutter.modifiedBackground"),
            backgroundColor: "#ff0000",
        });
        expect(type.key).toBe("1");
        expect(stub.notifies.at(-1)).toEqual({
            method: "window.createTextEditorDecorationType",
            params: {
                key: 1,
                options: {
                    isWholeLine: true,
                    overviewRulerLane: OverviewRulerLane.Left,
                    overviewRulerColor: { $themeColor: "editorGutter.modifiedBackground" },
                    backgroundColor: "#ff0000",
                },
            },
        });
        const type2 = window.createTextEditorDecorationType({});
        expect(type2.key).toBe("2");
        type.dispose();
        expect(stub.notifies.at(-1)).toEqual({
            method: "window.disposeTextEditorDecorationType",
            params: { key: 1 },
        });
    });

    it("editor.setDecorations sends notify with the active editor fileName and nested ranges", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/proj/a.ts").toString() });
        const type = window.createTextEditorDecorationType({
            overviewRulerColor: new ThemeColor("editorGutter.modifiedBackground"),
        });
        window.activeTextEditor!.setDecorations(type, [new Range(1, 0, 1, 0), new Range(4, 2, 4, 5)]);
        expect(stub.notifies.at(-1)).toEqual({
            method: "editor.setDecorations",
            params: {
                key: 1,
                uri: Uri.file("/proj/a.ts").toString(),
                ranges: [
                    { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                    { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } },
                ],
                groupId: 1,
            },
        });
    });

    it("setDecorations with DecorationOptions[] takes .range of each item", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/proj/a.ts").toString() });
        const type = window.createTextEditorDecorationType({});
        window.activeTextEditor!.setDecorations(type, [{ range: new Range(2, 0, 2, 3) }] as never);
        expect((stub.notifies.at(-1)!.params as { ranges: unknown }).ranges).toEqual([
            { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
        ]);
    });

    it("setDecorations: a broken range is dropped, a reversed duck-typed one is flipped", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/proj/a.ts").toString() });
        const type = window.createTextEditorDecorationType({});
        window.activeTextEditor!.setDecorations(type, [
            new Range(NaN, 0, 0, 1),
            { line: 0 },
            { start: { line: 3, character: 1 }, end: { line: 2, character: 0 } },
        ] as never);
        expect((stub.notifies.at(-1)!.params as { ranges: unknown }).ranges).toEqual([
            { start: { line: 2, character: 0 }, end: { line: 3, character: 1 } },
        ]);
    });

    it("setDecorations with an unknown type is a no-op (no notify)", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/proj/a.ts").toString() });
        const before = stub.notifies.length;
        window.activeTextEditor!.setDecorations({ key: "999", dispose: () => undefined }, [new Range(0, 0, 0, 1)]);
        expect(stub.notifies.length).toBe(before);
    });

    it("registerFileDecorationProvider queries the provider for changed uris and sends fileDecorationsChanged", async () => {
        const { stub, window } = makeCtx();
        const emitter = new EventEmitter<undefined | Uri | Uri[]>();
        const disposable = window.registerFileDecorationProvider({
            onDidChangeFileDecorations: emitter.event,
            provideFileDecoration: (uri: Uri) =>
                uri.fsPath.endsWith("notes.md")
                    ? new FileDecoration("M", "Modified", new ThemeColor("gitDecoration.modifiedResourceForeground"))
                    : undefined,
        } as unknown as vscode.FileDecorationProvider);
        emitter.fire([Uri.file("/proj/notes.md"), Uri.file("/proj/other.ts")]);
        await flushMicrotasks();
        expect(stub.notifies.at(-1)).toEqual({
            method: "window.fileDecorationsChanged",
            params: {
                decorations: [
                    {
                        uri: "file:///proj/notes.md",
                        badge: "M",
                        colorId: "gitDecoration.modifiedResourceForeground",
                    },
                    // other.ts without a decoration → bare uri (the host clears it)
                    { uri: "file:///proj/other.ts" },
                ],
            },
        });
        expect(typeof disposable.dispose).toBe("function");
    });

    it("registerFileDecorationProvider: single uri (not an array) + propagate", async () => {
        const { stub, window } = makeCtx();
        const emitter = new EventEmitter<undefined | Uri | Uri[]>();
        window.registerFileDecorationProvider({
            onDidChangeFileDecorations: emitter.event,
            provideFileDecoration: () => {
                const d = new FileDecoration("A");
                d.propagate = true;
                return d;
            },
        } as unknown as vscode.FileDecorationProvider);
        emitter.fire(Uri.file("/proj/x.ts")); // a single Uri → the "not an array" branch in normalizeChangedUris
        await flushMicrotasks();
        expect(stub.notifies.at(-1)).toEqual({
            method: "window.fileDecorationsChanged",
            params: { decorations: [{ uri: "file:///proj/x.ts", badge: "A", propagate: true }] },
        });
    });

    it("registerFileDecorationProvider: undefined change (all files) is not expanded", async () => {
        const { stub, window } = makeCtx();
        const emitter = new EventEmitter<undefined | Uri | Uri[]>();
        window.registerFileDecorationProvider({
            onDidChangeFileDecorations: emitter.event,
            provideFileDecoration: () => new FileDecoration("M"),
        } as unknown as vscode.FileDecorationProvider);
        const before = stub.notifies.length;
        emitter.fire(undefined);
        await flushMicrotasks();
        expect(stub.notifies.length).toBe(before);
    });

    it("registerFileDecorationProvider without onDidChangeFileDecorations returns a valid no-op Disposable", () => {
        const { window } = makeCtx();
        const disposable = window.registerFileDecorationProvider({
            provideFileDecoration: () => undefined,
        });
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
    });
});

describe("WindowNamespace — editor write (#194)", () => {
    const URI = Uri.file("/a.ts").toString();

    function activeEditor(overrides: Record<string, unknown> = {}) {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", {
            uri: URI,
            languageId: "typescript",
            isDirty: false,
            selection: { anchorLine: 0, anchorCharacter: 1, activeLine: 2, activeCharacter: 3 },
            ...overrides,
        });
        return { stub, window, editor: window.activeTextEditor! };
    }

    it("editor.selection getter returns the selection from meta", () => {
        const { editor } = activeEditor();
        expect(editor.selection.anchor).toEqual({ line: 0, character: 1 });
        expect(editor.selection.active).toEqual({ line: 2, character: 3 });
        expect(editor.selections).toHaveLength(1);
    });

    it("without selection in meta the getter returns (0,0)", () => {
        const { editor } = activeEditor({ selection: null });
        expect(editor.selection.anchor).toEqual({ line: 0, character: 0 });
        expect(editor.selection.active).toEqual({ line: 0, character: 0 });
        // vscode contract: the active editor always has at least one cursor.
        expect(editor.selections).toHaveLength(1);
        expect(editor.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("editor.selection setter sends editor.setSelection and updates the cache", () => {
        const { stub, editor } = activeEditor();
        editor.selection = new Selection(new Position(1, 0), new Position(1, 4));
        const notif = stub.notifies.find((n) => n.method === "editor.setSelection");
        expect(notif?.params).toEqual({
            uri: URI,
            selections: [{ anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 4 }],
            groupId: 1,
        });
        expect(editor.selection.active).toEqual({ line: 1, character: 4 });
    });

    it("editor.selectionChanged refreshes the selection without changing the active editor", () => {
        const { stub, window, editor } = activeEditor();
        let activeEditorEvents = 0;
        window.onDidChangeActiveTextEditor(() => {
            activeEditorEvents++;
        });

        stub.fire("editor.selectionChanged", {
            uri: URI,
            selections: [{ anchorLine: 5, anchorCharacter: 0, activeLine: 5, activeCharacter: 7 }],
        });

        expect(editor.selection.anchor).toEqual({ line: 5, character: 0 });
        expect(editor.selection.active).toEqual({ line: 5, character: 7 });
        expect(activeEditorEvents).toBe(0);
    });

    it("editor.selectionChanged carries all selections (multi-cursor)", () => {
        const { stub, editor } = activeEditor();
        stub.fire("editor.selectionChanged", {
            uri: URI,
            selections: [
                { anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 2 },
                { anchorLine: 3, anchorCharacter: 0, activeLine: 3, activeCharacter: 4 },
            ],
        });
        expect(editor.selections).toHaveLength(2);
        expect(editor.selections[1].active).toEqual({ line: 3, character: 4 });
    });

    it("editor.selectionChanged for another resource is ignored", () => {
        const { stub, editor } = activeEditor();
        stub.fire("editor.selectionChanged", {
            uri: Uri.file("/other.ts").toString(),
            selections: [{ anchorLine: 9, anchorCharacter: 0, activeLine: 9, activeCharacter: 1 }],
        });
        expect(editor.selection.active).toEqual({ line: 2, character: 3 });
    });

    it("editor.selectionChanged without uri is ignored", () => {
        const { stub, editor } = activeEditor();
        stub.fire("editor.selectionChanged", { selections: [] });
        expect(editor.selection.active).toEqual({ line: 2, character: 3 });
    });

    it("editor.selections setter sends all selections", () => {
        const { stub, editor } = activeEditor();
        editor.selections = [new Selection(0, 0, 0, 1), new Selection(1, 0, 1, 2)];
        const notif = stub.notifies.find((n) => n.method === "editor.setSelection");
        expect((notif?.params as { selections: unknown[] }).selections).toHaveLength(2);
    });

    it("editor.selections setter with an empty array is a no-op", () => {
        const { stub, editor } = activeEditor();
        editor.selections = [];
        expect(stub.notifies.find((n) => n.method === "editor.setSelection")).toBeUndefined();
    });

    /** The builder validates against the mirror, as upstream's `_pushEdit`. */
    function editorWithText(text: string) {
        const context = activeEditor();
        const lines = text.split("\n");
        const document = context.editor.document as unknown as { applyFull(snapshot: unknown): void };
        document.applyFull({ uri: URI, text: lines.join("\n"), version: 7 });
        return context;
    }

    it("[api:TextEditor.edit] collects insert/replace/delete with the document version and EOL", () => {
        const { stub, editor } = editorWithText("aaaa\nbbbb\ncccc\ndddd");
        void editor.edit((builder) => {
            builder.insert(new Position(0, 0), "X");
            builder.replace(new Range(1, 0, 1, 2), "Y");
            builder.delete(new Range(2, 0, 3, 0));
            builder.setEndOfLine(2);
        });
        const req = stub.requests.find((r) => r.method === "editor.applyEdit");
        expect(req?.params).toEqual({
            uri: URI,
            version: 7,
            setEndOfLine: 2,
            edits: [
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "X" },
                { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } }, text: "Y" },
                { range: { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } }, text: "" },
            ],
        });
    });

    it("[api:TextEditorEdit.replace] a range past the end is clamped to the document, unicode included", () => {
        const { stub, editor } = editorWithText("日本語 🙂");
        void editor.edit((builder) => {
            builder.replace(new Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE), "new");
        });
        const req = stub.requests.find((r) => r.method === "editor.applyEdit");
        expect((req?.params as { edits: unknown }).edits).toEqual([
            {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: "日本語 🙂".length } },
                text: "new",
            },
        ]);
    });

    it("[api:TextEditorEdit.insert] an empty document takes an insert", () => {
        const { stub, editor } = editorWithText("");
        void editor.edit((builder) => {
            builder.insert(new Position(5, 5), "x");
        });
        const req = stub.requests.find((r) => r.method === "editor.applyEdit");
        expect((req?.params as { edits: unknown }).edits).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" },
        ]);
    });

    it("[api:TextEditorEdit.replace] overlapping ranges reject with upstream's message, nothing is sent", async () => {
        const { stub, editor } = editorWithText("Hello world!");
        await expect(
            editor.edit((builder) => {
                builder.replace(new Range(0, 0, 0, 2), "He");
                builder.replace(new Range(0, 1, 0, 3), "el");
            }),
        ).rejects.toThrow("Overlapping ranges are not allowed!");
        expect(stub.requests.find((r) => r.method === "editor.applyEdit")).toBeUndefined();
    });

    it("[api:TextEditorEdit.insert] the builder throws outside the callback", async () => {
        const { editor } = editorWithText("foo");
        let kept: vscode.TextEditorEdit | undefined;
        await editor.edit((builder) => {
            kept = builder;
        });
        expect(() => kept?.insert(new Position(0, 0), "x")).toThrow("Edit is only valid while callback runs");
        expect(() => kept?.setEndOfLine(1)).toThrow("Edit is only valid while callback runs");
        expect(() => kept?.delete(new Range(0, 0, 0, 1))).toThrow("Edit is only valid while callback runs");
        expect(() => kept?.replace(new Range(0, 0, 0, 1), "y")).toThrow("Edit is only valid while callback runs");
    });

    it("[api:TextEditorEdit.setEndOfLine] an illegal value and an unknown location throw inside the callback", async () => {
        const { editor } = editorWithText("foo");
        await editor.edit((builder) => {
            expect(() => {
                builder.setEndOfLine(3 as never);
            }).toThrow("Illegal argument: endOfLine");
            expect(() => {
                builder.replace({} as never, "x");
            }).toThrow("Unrecognized location");
            expect(() => {
                builder.delete({} as never);
            }).toThrow("Unrecognized location");
        });
    });

    it("[api:TextEditor.edit] a closed document rejects", async () => {
        const { editor } = editorWithText("foo");
        (editor.document as unknown as { isClosed: boolean }).isClosed = true;
        await expect(editor.edit(() => undefined)).rejects.toThrow("TextEditor#edit not possible on closed editors");
    });

    it("[api:TextEditor.edit] an editor whose tab closed rejects, though its document stays open", async () => {
        const { stub, editor } = editorWithText("foo");
        await expect(editor.edit(() => undefined)).resolves.toBe(true);

        stub.fire("editor.layoutChanged", { groups: [] });

        expect(editor.document.isClosed).toBe(false);
        await expect(editor.edit(() => undefined)).rejects.toThrow("TextEditor#edit not possible on closed editors");
    });

    it("editor.edit without edits resolves true without RPC", async () => {
        const { stub, editor } = activeEditor();
        const ok = await editor.edit(() => {
            /* write nothing */
        });
        expect(ok).toBe(true);
        expect(stub.requests.find((r) => r.method === "editor.applyEdit")).toBeUndefined();
    });

    it("visibleTextEditors is the active editor or empty", () => {
        const { stub, window } = activeEditor();
        expect(window.visibleTextEditors).toHaveLength(1);
        stub.fire("editor.activeEditorChanged", { uri: null });
        expect(window.visibleTextEditors).toHaveLength(0);
    });
});

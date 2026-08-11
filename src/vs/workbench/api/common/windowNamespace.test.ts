import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { flushMicrotasks } from "../../../../TestUtils/timing.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
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
    };
    return { stub, ctx, window: createWindowNamespace(ctx) };
}

describe("WindowNamespace", () => {
    it("activeEditorChanged с meta прокидывает languageId/isDirty в документ", () => {
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

    it("activeEditorChanged прокидывает encoding/eol в документ (#106)", () => {
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

        // Мета без encoding/eol (старый хост) не затирает известные значения.
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.txt").toString() });
        expect(doc.encoding).toBe("windows1251");
    });

    it("editor.document стабилен по ссылке между обращениями", () => {
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

    it("установка options проксируется в editor.setOptions", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { tabSize: 2, insertSpaces: true };
        expect(stub.requests).toContainEqual({
            method: "editor.setOptions",
            params: { tabSize: 2, insertSpaces: true, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it("indentSize форвардится в editor.setOptions", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { indentSize: 3 } as never;
        expect(stub.requests).toContainEqual({
            method: "editor.setOptions",
            params: { indentSize: 3, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it('indentSize="tabSize" не форвардится (совпадает с tabSize)', () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        window.activeTextEditor!.options = { indentSize: "tabSize" } as never;
        expect(stub.requests).toHaveLength(0);
    });

    it("show*Message шлёт window.showMessage с правильным severity", async () => {
        const { stub, window } = makeCtx();
        await window.showErrorMessage("boom");
        await window.showWarningMessage("careful");
        await window.showInformationMessage("fyi");
        expect(stub.notifies).toEqual([
            { method: "window.showMessage", params: { severity: "error", message: "boom" } },
            { method: "window.showMessage", params: { severity: "warn", message: "careful" } },
            { method: "window.showMessage", params: { severity: "info", message: "fyi" } },
        ]);
    });

    it("window.state сфокусировано; onDidChangeWindowState регистрируется и не стреляет", () => {
        const { window } = makeCtx();
        expect(window.state).toEqual({ focused: true, active: true });
        let fired = false;
        const bag: { dispose(): unknown }[] = [];
        const d = window.onDidChangeWindowState(() => (fired = true), undefined, bag as never);
        expect(bag).toContain(d);
        expect(typeof d.dispose).toBe("function");
        d.dispose();
        // без disposables-массива тоже работает
        const d2 = window.onDidChangeWindowState(() => undefined);
        expect(typeof d2.dispose).toBe("function");
        expect(fired).toBe(false);
    });

    it("onDidChangeActiveTextEditor: thisArgs привязывается, disposables и dispose работают", () => {
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
        // после dispose слушатель отписан
        d.dispose();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/b.ts").toString() });
        expect(received).toHaveLength(1);
        // повторный dispose безопасен (idx < 0)
        expect(() => {
            d.dispose();
        }).not.toThrow();
    });

    it("options принимает строковые tabSize/insertSpaces/indentSize", () => {
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

    it("options с мусорными строками деградирует безопасно", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        // tabSize невалидна → 4; indentSize невалидна → не форвардится
        window.activeTextEditor!.options = { tabSize: "bad", indentSize: "bad" } as never;
        expect(stub.requests.at(-1)).toEqual({
            method: "editor.setOptions",
            params: { tabSize: 4, uri: Uri.file("/a.ts").toString(), groupId: 1 },
        });
    });

    it("присвоение options не-объекта и других свойств отклоняется", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.ts").toString() });
        const editor = window.activeTextEditor!;
        // options = не-объект → set-trap возвращает false (TypeError в strict mode)
        expect(() => {
            (editor as unknown as { options: unknown }).options = null;
        }).toThrow();
        // любое другое свойство editor — только для чтения
        expect(() => {
            (editor as unknown as { document: unknown }).document = {};
        }).toThrow();
        expect(stub.requests).toHaveLength(0);
    });

    it("createOutputChannel возвращает канал; методы не бросают", () => {
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

    it("createTextEditorDecorationType шлёт notify с сериализованным ThemeColor и монотонным key", () => {
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
        // key монотонен
        const type2 = window.createTextEditorDecorationType({});
        expect(type2.key).toBe("2");
        // dispose шлёт снятие типа по числовому key
        type.dispose();
        expect(stub.notifies.at(-1)).toEqual({
            method: "window.disposeTextEditorDecorationType",
            params: { key: 1 },
        });
    });

    it("editor.setDecorations шлёт notify с fileName активного редактора и nested-ranges", () => {
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

    it("setDecorations с DecorationOptions[] берёт .range каждого элемента", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/proj/a.ts").toString() });
        const type = window.createTextEditorDecorationType({});
        window.activeTextEditor!.setDecorations(type, [{ range: new Range(2, 0, 2, 3) }] as never);
        expect((stub.notifies.at(-1)!.params as { ranges: unknown }).ranges).toEqual([
            { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } },
        ]);
    });

    it("setDecorations с неизвестным типом — no-op (нет notify)", () => {
        const { stub, window } = makeCtx();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/proj/a.ts").toString() });
        const before = stub.notifies.length;
        window.activeTextEditor!.setDecorations({ key: "999", dispose: () => undefined }, [new Range(0, 0, 0, 1)]);
        expect(stub.notifies.length).toBe(before);
    });

    it("registerFileDecorationProvider опрашивает провайдер по изменённым uri и шлёт fileDecorationsChanged", async () => {
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
                    // other.ts без декорации → голый uri (снятие на стороне host'а)
                    { uri: "file:///proj/other.ts" },
                ],
            },
        });
        expect(typeof disposable.dispose).toBe("function");
    });

    it("registerFileDecorationProvider: одиночный uri (не массив) + propagate", async () => {
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
        emitter.fire(Uri.file("/proj/x.ts")); // одиночный Uri → ветка «не массив» в normalizeChangedUris
        await flushMicrotasks();
        expect(stub.notifies.at(-1)).toEqual({
            method: "window.fileDecorationsChanged",
            params: { decorations: [{ uri: "file:///proj/x.ts", badge: "A", propagate: true }] },
        });
    });

    it("registerFileDecorationProvider: undefined-change (все файлы) не разворачивается", async () => {
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

    it("registerFileDecorationProvider без onDidChangeFileDecorations — валидный no-op Disposable", () => {
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

    it("editor.selection геттер отдаёт выделение из meta", () => {
        const { editor } = activeEditor();
        expect(editor.selection.anchor).toEqual({ line: 0, character: 1 });
        expect(editor.selection.active).toEqual({ line: 2, character: 3 });
        expect(editor.selections).toHaveLength(1);
    });

    it("без selection в meta геттер отдаёт (0,0)", () => {
        const { editor } = activeEditor({ selection: null });
        expect(editor.selection.anchor).toEqual({ line: 0, character: 0 });
        expect(editor.selection.active).toEqual({ line: 0, character: 0 });
        // `selections` при пустом кэше — одно вырожденное, а не пустой массив
        // (контракт vscode: активный редактор всегда имеет хотя бы одну каретку).
        expect(editor.selections).toHaveLength(1);
        expect(editor.selections[0].active).toEqual({ line: 0, character: 0 });
    });

    it("editor.selection сеттер шлёт editor.setSelection и обновляет кэш", () => {
        const { stub, editor } = activeEditor();
        editor.selection = new Selection(new Position(1, 0), new Position(1, 4));
        const notif = stub.notifies.find((n) => n.method === "editor.setSelection");
        expect(notif?.params).toEqual({
            uri: URI,
            selections: [{ anchorLine: 1, anchorCharacter: 0, activeLine: 1, activeCharacter: 4 }],
            groupId: 1,
        });
        // Кэш обновлён — последующее чтение отражает установленное.
        expect(editor.selection.active).toEqual({ line: 1, character: 4 });
    });

    it("editor.selectionChanged освежает выделение без смены активного редактора", () => {
        const { stub, window, editor } = activeEditor();
        let activeEditorEvents = 0;
        window.onDidChangeActiveTextEditor(() => {
            activeEditorEvents++;
        });

        stub.fire("editor.selectionChanged", {
            uri: URI,
            selections: [{ anchorLine: 5, anchorCharacter: 0, activeLine: 5, activeCharacter: 7 }],
        });

        // Расширение видит свежую каретку — именно от этого зависит любая команда,
        // читающая `activeTextEditor.selection` (maptz wrapWithRegion и т.п.).
        expect(editor.selection.anchor).toEqual({ line: 5, character: 0 });
        expect(editor.selection.active).toEqual({ line: 5, character: 7 });
        // И при этом активный редактор не «сменился»: слушателей не дёргаем.
        expect(activeEditorEvents).toBe(0);
    });

    it("editor.selectionChanged переносит все выделения (multi-cursor)", () => {
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

    it("editor.selectionChanged для другого ресурса игнорируется", () => {
        const { stub, editor } = activeEditor();
        stub.fire("editor.selectionChanged", {
            uri: Uri.file("/other.ts").toString(),
            selections: [{ anchorLine: 9, anchorCharacter: 0, activeLine: 9, activeCharacter: 1 }],
        });
        expect(editor.selection.active).toEqual({ line: 2, character: 3 });
    });

    it("editor.selectionChanged без uri игнорируется", () => {
        const { stub, editor } = activeEditor();
        stub.fire("editor.selectionChanged", { selections: [] });
        expect(editor.selection.active).toEqual({ line: 2, character: 3 });
    });

    it("editor.selections сеттер шлёт все выделения", () => {
        const { stub, editor } = activeEditor();
        editor.selections = [new Selection(0, 0, 0, 1), new Selection(1, 0, 1, 2)];
        const notif = stub.notifies.find((n) => n.method === "editor.setSelection");
        expect((notif?.params as { selections: unknown[] }).selections).toHaveLength(2);
    });

    it("editor.selections сеттер с пустым массивом — no-op", () => {
        const { stub, editor } = activeEditor();
        editor.selections = [];
        expect(stub.notifies.find((n) => n.method === "editor.setSelection")).toBeUndefined();
    });

    it("editor.edit собирает insert/replace/delete и шлёт editor.applyEdit", () => {
        const { stub, editor } = activeEditor();
        void editor.edit((builder) => {
            builder.insert(new Position(0, 0), "X");
            builder.replace(new Range(1, 0, 1, 2), "Y");
            builder.delete(new Range(2, 0, 3, 0));
            builder.setEndOfLine(1); // no-op в MVP
        });
        const req = stub.requests.find((r) => r.method === "editor.applyEdit");
        expect(req?.params).toEqual({
            uri: URI,
            edits: [
                { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "X" },
                { range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 2 }, text: "Y" },
                { range: { startLine: 2, startCharacter: 0, endLine: 3, endCharacter: 0 }, text: "" },
            ],
        });
    });

    it("editor.edit без правок резолвится true без RPC", async () => {
        const { stub, editor } = activeEditor();
        const ok = await editor.edit(() => {
            /* ничего не пишем */
        });
        expect(ok).toBe(true);
        expect(stub.requests.find((r) => r.method === "editor.applyEdit")).toBeUndefined();
    });

    it("visibleTextEditors — активный редактор, либо пусто", () => {
        const { stub, window } = activeEditor();
        expect(window.visibleTextEditors).toHaveLength(1);
        stub.fire("editor.activeEditorChanged", { uri: null });
        expect(window.visibleTextEditors).toHaveLength(0);
    });
});

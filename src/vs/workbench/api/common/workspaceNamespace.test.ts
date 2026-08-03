import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { EndOfLine, Position, Range, TextEdit, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

function makeCtx() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, ctx, workspace: createWorkspaceNamespace(ctx) };
}

describe("WorkspaceNamespace — configuration", () => {
    it("getConfiguration читает из pushed workspace.initialize", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { editor: { tabSize: 2 }, editorconfig: { generateAuto: true } },
            workspaceFolders: [],
        });
        expect(workspace.getConfiguration("editor").get("tabSize")).toBe(2);
        expect(workspace.getConfiguration("editorconfig").get("generateAuto")).toBe(true);
        expect(workspace.getConfiguration().get("editor.tabSize")).toBe(2);
    });

    it("get с defaultValue для отсутствующего ключа", () => {
        const { workspace } = makeCtx();
        expect(workspace.getConfiguration("editor").get("tabSize", 4)).toBe(4);
        expect(workspace.getConfiguration("editor").has("tabSize")).toBe(false);
    });

    it("значения секции доступны как поля объекта конфигурации", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { editor: { tabSize: 2, insertSpaces: false } },
            workspaceFolders: [],
        });
        const config = workspace.getConfiguration("editor") as unknown as {
            tabSize: number;
            insertSpaces: boolean;
        };
        expect(config.tabSize).toBe(2);
        expect(config.insertSpaces).toBe(false);
    });

    it("inspect разделяет default/global слои", () => {
        const { ctx, stub, workspace } = makeCtx();
        ctx.configStore.applyDefaults({ "editor.tabSize": 4 });
        stub.fire("workspace.initialize", { configuration: { editor: { tabSize: 8 } }, workspaceFolders: [] });
        const inspected = workspace.getConfiguration("editor").inspect("tabSize");
        expect(inspected?.defaultValue).toBe(4);
        expect(inspected?.globalValue).toBe(8);
    });

    it("update не поддержан — резолвится и шлёт warn", async () => {
        const { stub, workspace } = makeCtx();
        await workspace.getConfiguration("editor").update("tabSize", 2);
        expect(stub.notifies[0]?.method).toBe("window.showMessage");
        expect((stub.notifies[0]?.params as { severity: string }).severity).toBe("warn");
    });

    it("значение секции с именем как у метода (get/has) не затирает метод", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { section: { get: 1, value: 2 } },
            workspaceFolders: [],
        });
        const config = workspace.getConfiguration("section");
        // `get` остаётся функцией, `value` — зеркалится как поле
        expect(typeof config.get).toBe("function");
        expect((config as unknown as { value: number }).value).toBe(2);
    });

    it("configurationChanged без affectedKeys не падает", () => {
        const { stub, workspace } = makeCtx();
        let seen: boolean | undefined;
        workspace.onDidChangeConfiguration((e: { affectsConfiguration(s: string): boolean }) => {
            seen = e.affectsConfiguration("editor");
        });
        stub.fire("workspace.configurationChanged", { configuration: {} });
        expect(seen).toBe(false);
    });

    it("configurationChanged переустанавливает снапшот и стреляет событие", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", { configuration: { editor: { tabSize: 2 } }, workspaceFolders: [] });
        let affectsEditor: boolean | undefined;
        workspace.onDidChangeConfiguration((e: { affectsConfiguration(section: string): boolean }) => {
            affectsEditor = e.affectsConfiguration("editor");
        });
        stub.fire("workspace.configurationChanged", {
            configuration: { editor: { tabSize: 8 } },
            affectedKeys: ["editor.tabSize"],
        });
        expect(workspace.getConfiguration("editor").get("tabSize")).toBe(8);
        expect(affectsEditor).toBe(true);
    });
});

describe("WorkspaceNamespace — folders & documents", () => {
    it("workspaceFolders приходит из initialize", () => {
        const { stub, workspace } = makeCtx();
        expect(workspace.workspaceFolders).toBeUndefined();
        stub.fire("workspace.initialize", {
            configuration: {},
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });
        expect(workspace.workspaceFolders).toHaveLength(1);
        expect(workspace.workspaceFolders![0].name).toBe("repo");
    });

    it("initialize без workspaceFolders → folders пусты", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", { configuration: {} });
        expect(workspace.workspaceFolders).toBeUndefined();
        expect(workspace.name).toBeUndefined();
    });

    it("asRelativePath относительно папки воркспейса", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: {},
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });
        expect(workspace.asRelativePath("/repo/src/a.ts")).toBe("src/a.ts");
        // Uri вместо строки
        expect(workspace.asRelativePath(Uri.file("/repo/src/a.ts") as never)).toBe("src/a.ts");
        // сам корень → возвращается как есть
        expect(workspace.asRelativePath("/repo")).toBe("/repo");
        // вне папки — возвращается как есть
        expect(workspace.asRelativePath("/other/b.ts")).toBe("/other/b.ts");
    });

    it("asRelativePath с includeWorkspaceFolder в multi-root добавляет имя папки", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: {},
            workspaceFolders: [
                { uri: "/a", name: "a", index: 0 },
                { uri: "/b", name: "b", index: 1 },
            ],
        });
        expect(workspace.asRelativePath("/b/x.ts", true)).toBe("b/x.ts");
    });

    it("textDocuments отражает реестр", () => {
        const { ctx, workspace } = makeCtx();
        ctx.registry.getOrCreate(Uri.file("/a.ts"));
        ctx.registry.getOrCreate(Uri.file("/b.ts"));
        expect(workspace.textDocuments).toHaveLength(2);
    });

    it("openTextDocument резолвит открытый документ (строка и Uri)", async () => {
        const { ctx, workspace } = makeCtx();
        ctx.registry.getOrCreate(Uri.file("/a.ts"));
        const byString = await workspace.openTextDocument("/a.ts");
        expect((byString as unknown as { fileName: string }).fileName).toBe("/a.ts");
        const byUri = await workspace.openTextDocument(Uri.file("/a.ts") as never);
        expect((byUri as unknown as { fileName: string }).fileName).toBe("/a.ts");
    });

    it("openTextDocument с не-file URI отказывает и НЕ читает диск", async () => {
        // Тот же класс бага, что #107: раньше схема падала через .fsPath, и
        // "untitled:Untitled-1" уезжал в nodeFs.readFile как относительный путь.
        const { workspace } = makeCtx();
        await expect(workspace.openTextDocument(Uri.parse("untitled:Untitled-1") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("WorkspaceNamespace — openTextDocument от диска (WP7)", () => {
    let tmpDir: string;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vexx-otd-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("на промах реестра читает файл с диска в эфемерный документ (не в реестр)", async () => {
        const { ctx, workspace } = makeCtx();
        const file = path.join(tmpDir, ".editorconfig");
        fs.writeFileSync(file, "root = true\n", "utf8");

        const doc = (await workspace.openTextDocument(file)) as unknown as {
            fileName: string;
            getText(): string;
        };
        expect(doc.fileName).toBe(file);
        expect(doc.getText()).toBe("root = true\n");
        // Эфемерный: в реестр не попал.
        expect(ctx.registry.all()).toHaveLength(0);
        expect(ctx.registry.get(Uri.file(file))).toBeUndefined();
    });

    it("несуществующий файл → reject", async () => {
        const { workspace } = makeCtx();
        await expect(workspace.openTextDocument(path.join(tmpDir, "nope.txt"))).rejects.toThrow();
    });

    it("не-utf8 encoding реально декодирует файл (windows1251) без предупреждений", async () => {
        const { stub, workspace } = makeCtx();
        const file = path.join(tmpDir, "a.txt");
        fs.writeFileSync(file, iconv.encode("Привет, мир!\n", "windows1251"));

        const doc = (await workspace.openTextDocument(
            Uri.file(file) as never,
            {
                encoding: "windows1251",
            } as never,
        )) as unknown as { getText(): string; encoding: string };
        expect(doc.getText()).toBe("Привет, мир!\n");
        expect(doc.encoding).toBe("windows1251");
        expect(stub.notifies.some((n) => n.method === "window.showMessage")).toBe(false);
    });

    it("неизвестный encoding молча откатывается к дефолту (контракт vscode.d.ts)", async () => {
        const { stub, workspace } = makeCtx();
        const file = path.join(tmpDir, "b.txt");
        fs.writeFileSync(file, "x\n", "utf8");
        const doc = (await workspace.openTextDocument(
            Uri.file(file) as never,
            {
                encoding: "martian",
            } as never,
        )) as unknown as { getText(): string; encoding: string };
        expect(doc.getText()).toBe("x\n");
        expect(doc.encoding).toBe("utf8");
        expect(stub.notifies.some((n) => n.method === "window.showMessage")).toBe(false);
    });

    it("эфемерный документ детектит encoding по BOM и EOL по содержимому", async () => {
        const { workspace } = makeCtx();
        const file = path.join(tmpDir, "bom.txt");
        fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\r\n", "utf8")]));

        const doc = (await workspace.openTextDocument(file)) as unknown as {
            getText(): string;
            encoding: string;
            eol: number;
        };
        expect(doc.encoding).toBe("utf8bom");
        expect(doc.eol).toBe(2); // vscode.EndOfLine.CRLF
        // BOM отрезан и не попал в текст.
        expect(doc.getText().charCodeAt(0)).not.toBe(0xfeff);
    });
});

describe("WorkspaceNamespace — save subscriptions", () => {
    it("первый onWillSaveTextDocument шлёт updateSubscriptions {willSave:true}", () => {
        const { stub, workspace } = makeCtx();
        const d1 = workspace.onWillSaveTextDocument(() => undefined);
        expect(stub.notifies).toContainEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: true, didSave: false, documentSync: false },
        });
        // второй слушатель не шлёт повторно
        const before = stub.notifies.length;
        const d2 = workspace.onWillSaveTextDocument(() => undefined);
        expect(stub.notifies.length).toBe(before);
        // dispose обоих → willSave:false
        d1.dispose();
        d2.dispose();
        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: false, didSave: false, documentSync: false },
        });
    });

    it("onWillSaveTextDocument кладёт disposable в переданный массив", () => {
        const { workspace } = makeCtx();
        const bag: { dispose(): unknown }[] = [];
        const d = workspace.onWillSaveTextDocument(() => undefined, undefined, bag as never);
        expect(bag).toContain(d);
    });

    it("onDidSaveTextDocument: флаг, второй слушатель, dispose до нуля, disposables", () => {
        const { stub, workspace } = makeCtx();
        const bag: { dispose(): unknown }[] = [];
        const d1 = workspace.onDidSaveTextDocument(() => undefined, undefined, bag as never);
        expect(bag).toContain(d1);
        expect(stub.notifies).toContainEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: false, didSave: true, documentSync: false },
        });
        // второй слушатель не шлёт повторно
        const before = stub.notifies.length;
        const d2 = workspace.onDidSaveTextDocument(() => undefined);
        expect(stub.notifies.length).toBe(before);
        d1.dispose();
        d2.dispose();
        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: false, didSave: false, documentSync: false },
        });
    });
});

describe("WorkspaceNamespace — will-save request handler", () => {
    const REQUEST = "workspace.willSaveTextDocument";
    const paramsFor = (text: string) => ({
        uri: Uri.file("/f.txt").toString(),
        languageId: "plaintext",
        isDirty: true,
        text,
        reason: 1,
    });

    it("сериализует TextEdit[] участника (upsertFull + fire + waitUntil)", async () => {
        const { stub, ctx, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            // текст доехал в реестр
            expect(e.document.getText()).toBe("abc   \n");
            e.waitUntil(Promise.resolve([TextEdit.delete(new Range(0, 3, 0, 6))]));
        });
        const result = await stub.callRequest(REQUEST, paramsFor("abc   \n"));
        expect(result).toEqual([{ range: { startLine: 0, startCharacter: 3, endLine: 0, endCharacter: 6 }, text: "" }]);
        expect(ctx.registry.get(Uri.file("/f.txt"))?.getText()).toBe("abc   \n");
    });

    it("сериализует setEndOfLine (CRLF→2, LF→1)", async () => {
        const crlf = makeCtx();
        crlf.workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([TextEdit.setEndOfLine(EndOfLine.CRLF)]));
        });
        expect(await crlf.stub.callRequest(REQUEST, paramsFor("a\n"))).toEqual([{ setEndOfLine: 2 }]);

        const lf = makeCtx();
        lf.workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([TextEdit.setEndOfLine(EndOfLine.LF)]));
        });
        expect(await lf.stub.callRequest(REQUEST, paramsFor("a\n"))).toEqual([{ setEndOfLine: 1 }]);
    });

    it("прокидывает eol документа в реестр (для SetEndOfLine расширения)", async () => {
        const { stub, ctx, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([]));
        });
        await stub.callRequest(REQUEST, { ...paramsFor("a\n"), eol: 2 });
        expect(ctx.registry.get(Uri.file("/f.txt"))?.eol).toBe(EndOfLine.CRLF);
    });

    it("прокидывает encoding документа в реестр (#106)", async () => {
        const { stub, ctx, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([]));
        });
        await stub.callRequest(REQUEST, { ...paramsFor("a\n"), encoding: "windows1251" });
        expect(ctx.registry.get(Uri.file("/f.txt"))?.encoding).toBe("windows1251");
    });

    it("минимальные params (без text/reason/languageId) не падают", async () => {
        const { stub, ctx, workspace } = makeCtx();
        let reason: number | undefined;
        workspace.onWillSaveTextDocument((e) => {
            reason = e.reason as unknown as number;
            e.waitUntil(Promise.resolve([]));
        });
        expect(await stub.callRequest(REQUEST, { uri: Uri.file("/x.txt").toString() })).toEqual([]);
        expect(reason).toBe(1); // TextDocumentSaveReason.Manual по умолчанию
        expect(ctx.registry.get(Uri.file("/x.txt"))?.getText()).toBe(""); // text ?? ""
    });

    it("без слушателей возвращает []", async () => {
        const { stub } = makeCtx();
        expect(await stub.callRequest(REQUEST, paramsFor("a\n"))).toEqual([]);
    });

    it("не-TextEdit и не-массив результаты отбрасываются", async () => {
        const { stub, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve("nope"));
        });
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([{ notAnEdit: true }]));
        });
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), "x")]));
        });
        expect(await stub.callRequest(REQUEST, paramsFor("a\n"))).toEqual([
            { range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "x" },
        ]);
    });

    it("отклонённый waitUntil-thenable трактуется как []", async () => {
        const { stub, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.reject(new Error("boom")));
        });
        expect(await stub.callRequest(REQUEST, paramsFor("a\n"))).toEqual([]);
    });

    it("waitUntil после завершения диспетча игнорируется", async () => {
        const { stub, workspace } = makeCtx();
        let captured: { waitUntil: (t: Thenable<unknown>) => void } | undefined;
        workspace.onWillSaveTextDocument((e) => {
            captured = e;
        });
        const result = await stub.callRequest(REQUEST, paramsFor("a\n"));
        expect(result).toEqual([]);
        // collecting уже false — правка не подхватится (и не бросит)
        captured?.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), "x")]));
    });

    it("per-listener таймаут → [] если waitUntil никогда не резолвится", async () => {
        vi.useFakeTimers();
        try {
            const { stub, workspace } = makeCtx();
            workspace.onWillSaveTextDocument((e) => {
                e.waitUntil(new Promise(() => {}));
            });
            const pending = stub.callRequest(REQUEST, paramsFor("a\n"));
            await vi.advanceTimersByTimeAsync(1500);
            expect(await pending).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("WorkspaceNamespace — did-save notification", () => {
    it("фаерит onDidSaveTextDocument с документом из реестра", () => {
        const { stub, workspace } = makeCtx();
        let saved: { fileName: string; languageId: string } | undefined;
        workspace.onDidSaveTextDocument((doc) => {
            saved = doc as unknown as { fileName: string; languageId: string };
        });
        stub.fire("workspace.didSaveTextDocument", { uri: Uri.file("/f.txt").toString(), languageId: "typescript" });
        expect(saved?.fileName).toBe("/f.txt");
        expect(saved?.languageId).toBe("typescript");
    });

    it("без languageId апдейтит только по fileName", () => {
        const { stub, workspace } = makeCtx();
        let saved: { languageId: string } | undefined;
        workspace.onDidSaveTextDocument((doc) => {
            saved = doc as unknown as { languageId: string };
        });
        stub.fire("workspace.didSaveTextDocument", { uri: Uri.file("/g.txt").toString() });
        expect(saved?.languageId).toBe("plaintext");
    });

    it("невалидный fileName игнорируется", () => {
        const { stub, workspace } = makeCtx();
        let fired = false;
        workspace.onDidSaveTextDocument(() => {
            fired = true;
        });
        stub.fire("workspace.didSaveTextDocument", { uri: 42 });
        expect(fired).toBe(false);
    });
});

describe("WorkspaceNamespace — registerFileSystemProvider", () => {
    const provider = (content: string) => ({
        onDidChangeFile: () => ({ dispose: () => undefined }),
        watch: () => ({ dispose: () => undefined }),
        stat: () => ({ type: 1, ctime: 0, mtime: 0, size: 0 }),
        readFile: () => new TextEncoder().encode(content),
    });

    it("регистрация объявляет схему хосту", () => {
        const { stub, workspace } = makeCtx();

        workspace.registerFileSystemProvider("git", provider("x") as never);

        expect(stub.notifies).toContainEqual({
            method: "workspace.fileSystemProvidersChanged",
            params: { schemes: ["git"] },
        });
    });

    it("dispose регистрации снимает схему у хоста", () => {
        const { stub, workspace } = makeCtx();

        workspace.registerFileSystemProvider("git", provider("x") as never).dispose();

        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.fileSystemProvidersChanged",
            params: { schemes: [] },
        });
    });

    it("запрос хоста readFile уходит провайдеру и возвращает base64", async () => {
        const { stub, workspace } = makeCtx();
        workspace.registerFileSystemProvider("git", provider("оригинал") as never);

        const result = await stub.callRequest("workspace.fs.readFile", { uri: "git:/repo/a.ts" });

        expect(Buffer.from((result as { content: string }).content, "base64").toString("utf8")).toBe("оригинал");
    });

    it("readFile без строкового uri — ошибка, а не чтение мусора", async () => {
        const { stub } = makeCtx();

        await expect(stub.callRequest("workspace.fs.readFile", { uri: 42 })).rejects.toThrow(/uri must be a string/);
    });

    it("readFile по незарегистрированной схеме — ошибка", async () => {
        const { stub } = makeCtx();

        await expect(stub.callRequest("workspace.fs.readFile", { uri: "git:/a.ts" })).rejects.toThrow(
            /no file system provider for scheme "git"/,
        );
    });

    it("изменения провайдера уходят хосту нотификацией", () => {
        const { stub, workspace } = makeCtx();
        const listeners: ((events: { uri: Uri }[]) => void)[] = [];
        workspace.registerFileSystemProvider("git", {
            ...provider("x"),
            onDidChangeFile: (cb: (e: { uri: Uri }[]) => void) => {
                listeners.push(cb);
                return { dispose: () => undefined };
            },
        } as never);

        listeners[0]([{ uri: Uri.parse("git:/repo/a.ts") }]);

        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.fs.didChangeFile",
            params: { uris: ["git:/repo/a.ts"] },
        });
    });
});

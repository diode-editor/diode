import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import iconv from "iconv-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    ConfigurationTarget,
    EndOfLine,
    FileSystemError,
    MarkdownString,
    Position,
    Range,
    TextEdit,
    Uri,
} from "./vscodeTypes.ts";
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
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, ctx, workspace: createWorkspaceNamespace(ctx) };
}

describe("WorkspaceNamespace — workspace trust (naive)", () => {
    it("an open workspace is always trusted, the event is subscribable and never fires", () => {
        const { workspace } = makeCtx();
        expect(workspace.isTrusted).toBe(true);

        const listener = vi.fn();
        const subscription = workspace.onDidGrantWorkspaceTrust(listener);
        expect(listener).not.toHaveBeenCalled();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });
});

describe("WorkspaceNamespace — configuration", () => {
    it("getConfiguration reads from the pushed workspace.initialize", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: { editor: { tabSize: 2 }, editorconfig: { generateAuto: true } } },
            workspaceFolders: [],
        });
        expect(workspace.getConfiguration("editor").get("tabSize")).toBe(2);
        expect(workspace.getConfiguration("editorconfig").get("generateAuto")).toBe(true);
        expect(workspace.getConfiguration().get("editor.tabSize")).toBe(2);
    });

    it("scope with languageId (TextDocument or { languageId }) picks the language section", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: {
                defaults: { editor: { formatOnSave: false } },
                user: { "[python]": { "editor.formatOnSave": true } },
            },
            workspaceFolders: [],
        });
        const pythonDocument = { uri: "file:///a.py", languageId: "python" };

        expect(workspace.getConfiguration("editor").get("formatOnSave")).toBe(false);
        expect(workspace.getConfiguration("editor", pythonDocument as never).get("formatOnSave")).toBe(true);
        expect(workspace.getConfiguration("editor", { languageId: "python" } as never).has("formatOnSave")).toBe(true);
        const editor = workspace.getConfiguration("editor", { languageId: "python" } as never) as unknown as {
            formatOnSave: boolean;
            inspect(key: string): { defaultValue: unknown } | undefined;
        };
        expect(editor.formatOnSave).toBe(true);
        expect(editor.inspect("formatOnSave")?.defaultValue).toBe(false);
        // An empty or non-string languageId, or a non-object, means no section.
        expect(workspace.getConfiguration("editor", { languageId: "" } as never).get("formatOnSave")).toBe(false);
        expect(workspace.getConfiguration("editor", { languageId: 1 } as never).get("formatOnSave")).toBe(false);
        expect(workspace.getConfiguration("editor", "python" as never).get("formatOnSave")).toBe(false);
        expect(workspace.getConfiguration("editor", null as never).get("formatOnSave")).toBe(false);
    });

    it("get with defaultValue for a missing key", () => {
        const { workspace } = makeCtx();
        expect(workspace.getConfiguration("editor").get("tabSize", 4)).toBe(4);
        expect(workspace.getConfiguration("editor").has("tabSize")).toBe(false);
    });

    it("section values are available as fields of the configuration object", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: { editor: { tabSize: 2, insertSpaces: false } } },
            workspaceFolders: [],
        });
        const config = workspace.getConfiguration("editor") as unknown as {
            tabSize: number;
            insertSpaces: boolean;
        };
        expect(config.tabSize).toBe(2);
        expect(config.insertSpaces).toBe(false);
    });

    it("inspect separates default/global layers", () => {
        const { ctx, stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: { editor: { tabSize: 4 } }, user: { editor: { tabSize: 8 } } },
            workspaceFolders: [],
        });
        const inspected = workspace.getConfiguration("editor").inspect("tabSize");
        expect(inspected?.defaultValue).toBe(4);
        expect(inspected?.globalValue).toBe(8);
        expect(inspected?.workspaceValue).toBeUndefined();
    });

    it("inspect returns workspaceValue of the workspace layer, get returns the value over user", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: {
                defaults: { editor: { tabSize: 4 } },
                user: { editor: { tabSize: 8 } },
                workspace: { editor: { tabSize: 2 } },
            },
            workspaceFolders: [],
        });
        const config = workspace.getConfiguration("editor");
        expect(config.get("tabSize")).toBe(2);
        expect(config.inspect("tabSize")).toEqual({
            key: "editor.tabSize",
            defaultValue: 4,
            globalValue: 8,
            workspaceValue: 2,
            workspaceFolderValue: undefined,
        });
    });

    it("update sends configuration.update to the host with the full key and no target if none was given", async () => {
        const { stub, workspace } = makeCtx();
        await workspace.getConfiguration("editor").update("tabSize", 2);
        await workspace.getConfiguration().update("files.autoSave", "off");
        expect(stub.requests).toStrictEqual([
            { method: "configuration.update", params: { key: "editor.tabSize", value: 2 } },
            { method: "configuration.update", params: { key: "files.autoSave", value: "off" } },
        ]);
        // Refusals are a rejected promise without a toast, as upstream (donotNotifyError).
        expect(stub.notifies).toEqual([]);
    });

    it("target: boolean and ConfigurationTarget as in upstream parseConfigurationTarget; anything else is unset", async () => {
        const { stub, workspace } = makeCtx();
        const config = workspace.getConfiguration("bazel.projectview");
        await config.update("open", false, true);
        await config.update("open", false, false);
        await config.update("open", false, ConfigurationTarget.Global);
        await config.update("open", false, ConfigurationTarget.Workspace);
        await config.update("open", false, ConfigurationTarget.WorkspaceFolder);
        await config.update("open", false, null);
        await config.update("open", false, 7 as ConfigurationTarget);
        expect(stub.requests.map((r) => (r.params as { target?: string }).target)).toEqual([
            "user",
            "workspace",
            "user",
            "workspace",
            "workspaceFolder",
            undefined,
            undefined,
        ]);
        // Not given — the field is absent altogether (`toStrictEqual` tells it apart from `target: undefined`).
        expect(stub.requests[5]?.params).toStrictEqual({ key: "bazel.projectview.open", value: false });
    });

    it("value undefined removes the key — no value field on the wire", async () => {
        const { stub, workspace } = makeCtx();
        await workspace.getConfiguration("bazel").update("projectview.open", undefined, true);
        expect(stub.requests[0]?.params).toStrictEqual({ key: "bazel.projectview.open", target: "user" });
    });

    it("resource from scope (Uri, TextDocument, WorkspaceFolder) is sent to the host as a string", async () => {
        const { stub, workspace } = makeCtx();
        const uri = Uri.file("/ws/a.ts");
        await workspace.getConfiguration("x", uri).update("y", 1);
        await workspace.getConfiguration("x", { uri: Uri.file("/ws"), name: "ws", index: 0 }).update("y", 1);
        await workspace.getConfiguration("x", { uri: "not-a-Uri" } as unknown as Uri).update("y", 1);
        // Upstream scope `null` means "no resource"; writing must not throw on it.
        await workspace.getConfiguration("x", null).update("y", 1);
        expect(stub.requests.map((r) => (r.params as { resource?: string }).resource)).toEqual([
            uri.toString(),
            Uri.file("/ws").toString(),
            undefined,
            undefined,
        ]);
    });

    it("host rejection reaches the extension as a rejected promise with its message", async () => {
        const { stub, workspace } = makeCtx();
        stub.responder = () =>
            Promise.reject(
                new Error("Unable to write to Workspace Settings because x is not a registered configuration."),
            );
        await expect(workspace.getConfiguration().update("x", 1)).rejects.toThrow("is not a registered configuration");
    });

    it("writing to a language section is rejected before reaching the host", async () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: { "[go]": { "editor.tabSize": 8 } }, workspace: {} },
            workspaceFolders: [],
        });
        const goDoc = { uri: Uri.file("/ws/a.go"), languageId: "go" };
        // Explicitly into the language section — refused for any target.
        await expect(workspace.getConfiguration("editor", goDoc).update("tabSize", 2, true, true)).rejects.toThrow(
            'Unable to write editor.tabSize to the "[go]" section',
        );
        // Not given, but the language has its own value in the target layer (user) — upstream writes into the section: refused.
        await expect(workspace.getConfiguration("editor", goDoc).update("tabSize", 2, true)).rejects.toThrow('"[go]"');
        expect(stub.requests).toEqual([]);
        // go has no section in the workspace layer — a regular key write.
        await workspace.getConfiguration("editor", goDoc).update("tabSize", 2, false);
        // Explicitly bypassing the section — a regular write even when the language has a value.
        await workspace.getConfiguration("editor", goDoc).update("tabSize", 2, true, false);
        expect(stub.requests.map((r) => (r.params as { target: string }).target)).toEqual(["workspace", "user"]);
    });

    it("window from .code-workspace: workspaceFolderValue is the folder layer; a folder write checks its language section", async () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: {
                defaults: { editor: { tabSize: 4 } },
                user: {},
                workspace: { editor: { tabSize: 2 } },
                workspaceFolder: { editor: { tabSize: 8 }, "[go]": { "editor.tabSize": 3 } },
            },
            workspaceFolders: [],
        });
        expect(workspace.getConfiguration("editor").inspect("tabSize")).toMatchObject({
            workspaceValue: 2,
            workspaceFolderValue: 8,
        });
        const goDoc = { uri: Uri.file("/ws/a.go"), languageId: "go" };
        await expect(
            workspace.getConfiguration("editor", goDoc).update("tabSize", 2, ConfigurationTarget.WorkspaceFolder),
        ).rejects.toThrow('"[go]"');
        // go has no section in the workspace layer — a regular write there.
        await workspace.getConfiguration("editor", goDoc).update("tabSize", 2, ConfigurationTarget.Workspace);
        expect(stub.requests.map((r) => (r.params as { target: string }).target)).toEqual(["workspace"]);
    });

    it("a write without target checks the language section of the workspace layer", async () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {}, workspace: { "[go]": { "editor.tabSize": 3 } } },
            workspaceFolders: [],
        });
        const goDoc = { uri: Uri.file("/ws/a.go"), languageId: "go" };
        await expect(workspace.getConfiguration("editor", goDoc).update("tabSize", 2)).rejects.toThrow(
            'Unable to write editor.tabSize to the "[go]" section',
        );
        expect(stub.requests).toEqual([]);
    });

    it("overrideInLanguage without a language in scope writes a plain key", async () => {
        const { stub, workspace } = makeCtx();
        await workspace.getConfiguration("editor", Uri.file("/ws/a.go")).update("tabSize", 2, true, true);
        expect(stub.requests[0]?.params).toMatchObject({ key: "editor.tabSize", value: 2, target: "user" });
    });

    it("a section value named like a method (get/has) does not overwrite the method", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: { section: { get: 1, value: 2 } } },
            workspaceFolders: [],
        });
        const config = workspace.getConfiguration("section");
        // `get` stays a function, `value` is mirrored as a field
        expect(typeof config.get).toBe("function");
        expect((config as unknown as { value: number }).value).toBe(2);
    });

    it("configurationChanged without affectedKeys does not fail", () => {
        const { stub, workspace } = makeCtx();
        let seen: boolean | undefined;
        workspace.onDidChangeConfiguration((e: { affectsConfiguration(s: string): boolean }) => {
            seen = e.affectsConfiguration("editor");
        });
        stub.fire("workspace.configurationChanged", { configuration: { defaults: {}, user: {} } });
        expect(seen).toBe(false);
    });

    it("configurationChanged resets the snapshot and fires the event", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: { editor: { tabSize: 2 } } },
            workspaceFolders: [],
        });
        let affectsEditor: boolean | undefined;
        workspace.onDidChangeConfiguration((e: { affectsConfiguration(section: string): boolean }) => {
            affectsEditor = e.affectsConfiguration("editor");
        });
        stub.fire("workspace.configurationChanged", {
            configuration: { defaults: {}, user: { editor: { tabSize: 8 } } },
            affectedKeys: ["editor.tabSize"],
        });
        expect(workspace.getConfiguration("editor").get("tabSize")).toBe(8);
        expect(affectsEditor).toBe(true);
    });
});

describe("WorkspaceNamespace — folders & documents", () => {
    it("workspaceFolders comes from initialize", () => {
        const { stub, workspace } = makeCtx();
        expect(workspace.workspaceFolders).toBeUndefined();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });
        expect(workspace.workspaceFolders).toHaveLength(1);
        expect(workspace.workspaceFolders![0].name).toBe("repo");
    });

    it("window from .code-workspace: workspaceFile is its Uri, name is '<file> (Workspace)', as upstream", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [{ uri: "file:///repo", name: "repo", index: 0 }],
            workspaceFile: "file:///repo/web.code-workspace",
        });
        expect(workspace.workspaceFile?.toString()).toBe("file:///repo/web.code-workspace");
        expect(workspace.name).toBe("web (Workspace)");
    });

    it("window from a folder: no workspaceFile, name is the folder name", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [{ uri: "file:///repo", name: "repo", index: 0 }],
            workspaceFile: 1,
        });
        expect(workspace.workspaceFile).toBeUndefined();
        expect(workspace.name).toBe("repo");
    });

    it("initialize without workspaceFolders → folders are empty", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", { configuration: { defaults: {}, user: {} } });
        expect(workspace.workspaceFolders).toBeUndefined();
        expect(workspace.name).toBeUndefined();
    });

    it("asRelativePath relative to the workspace folder", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [{ uri: "/repo", name: "repo", index: 0 }],
        });
        expect(workspace.asRelativePath("/repo/src/a.ts")).toBe("src/a.ts");
        expect(workspace.asRelativePath(Uri.file("/repo/src/a.ts") as never)).toBe("src/a.ts");
        expect(workspace.asRelativePath("/repo")).toBe("/repo");
        expect(workspace.asRelativePath("/other/b.ts")).toBe("/other/b.ts");
    });

    it("asRelativePath with includeWorkspaceFolder in multi-root adds the folder name", () => {
        const { stub, workspace } = makeCtx();
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user: {} },
            workspaceFolders: [
                { uri: "/a", name: "a", index: 0 },
                { uri: "/b", name: "b", index: 1 },
            ],
        });
        expect(workspace.asRelativePath("/b/x.ts", true)).toBe("b/x.ts");
    });

    it("textDocuments mirrors the registry", () => {
        const { ctx, workspace } = makeCtx();
        ctx.registry.getOrCreate(Uri.file("/a.ts"));
        ctx.registry.getOrCreate(Uri.file("/b.ts"));
        expect(workspace.textDocuments).toHaveLength(2);
    });

    it("openTextDocument resolves an open document (string and Uri)", async () => {
        const { ctx, workspace } = makeCtx();
        ctx.registry.getOrCreate(Uri.file("/a.ts"));
        const byString = await workspace.openTextDocument("/a.ts");
        expect((byString as unknown as { fileName: string }).fileName).toBe("/a.ts");
        const byUri = await workspace.openTextDocument(Uri.file("/a.ts") as never);
        expect((byUri as unknown as { fileName: string }).fileName).toBe("/a.ts");
    });

    it("openTextDocument with a non-file URI rejects and does NOT read the disk", async () => {
        // Bug class #107: the scheme fell through .fsPath, and `untitled:` went to nodeFs.readFile as a relative path.
        const { workspace } = makeCtx();
        await expect(workspace.openTextDocument(Uri.parse("untitled:Untitled-1") as never)).rejects.toMatchObject({
            code: "Unavailable",
        });
    });
});

describe("WorkspaceNamespace — openTextDocument from disk (WP7)", () => {
    let tmpDir: string;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-otd-"));
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("on a registry miss reads the file from disk into an ephemeral document (not into the registry)", async () => {
        const { ctx, workspace } = makeCtx();
        const file = path.join(tmpDir, ".editorconfig");
        fs.writeFileSync(file, "root = true\n", "utf8");

        const doc = (await workspace.openTextDocument(file)) as unknown as {
            fileName: string;
            getText(): string;
        };
        expect(doc.fileName).toBe(file);
        expect(doc.getText()).toBe("root = true\n");
        // Ephemeral: not added to the registry.
        expect(ctx.registry.all()).toHaveLength(0);
        expect(ctx.registry.get(Uri.file(file))).toBeUndefined();
    });

    it("missing file → reject", async () => {
        const { workspace } = makeCtx();
        await expect(workspace.openTextDocument(path.join(tmpDir, "nope.txt"))).rejects.toThrow();
    });

    it("non-utf8 encoding really decodes the file (windows1251) without warnings", async () => {
        const { stub, workspace } = makeCtx();
        const file = path.join(tmpDir, "a.txt");
        fs.writeFileSync(file, iconv.encode("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n", "windows1251")); // "Privet, mir!": Cyrillic is needed to exercise windows1251

        const doc = (await workspace.openTextDocument(
            Uri.file(file) as never,
            {
                encoding: "windows1251",
            } as never,
        )) as unknown as { getText(): string; encoding: string };
        expect(doc.getText()).toBe("\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440!\n"); // "Privet, mir!"
        expect(doc.encoding).toBe("windows1251");
        expect(stub.requests.some((r) => r.method === "window.showMessage")).toBe(false);
    });

    it("unknown encoding silently falls back to the default (vscode.d.ts contract)", async () => {
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
        expect(stub.requests.some((r) => r.method === "window.showMessage")).toBe(false);
    });

    it("ephemeral document detects encoding from BOM and EOL from content", async () => {
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
        expect(doc.getText().charCodeAt(0)).not.toBe(0xfeff);
    });
});

describe("WorkspaceNamespace — save subscriptions", () => {
    it("first onWillSaveTextDocument sends updateSubscriptions {willSave:true}", () => {
        const { stub, workspace } = makeCtx();
        const d1 = workspace.onWillSaveTextDocument(() => undefined);
        expect(stub.notifies).toContainEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: true, didSave: false, documentSync: false },
        });
        const before = stub.notifies.length;
        const d2 = workspace.onWillSaveTextDocument(() => undefined);
        expect(stub.notifies.length).toBe(before);
        d1.dispose();
        d2.dispose();
        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: false, didSave: false, documentSync: false },
        });
    });

    it("onWillSaveTextDocument puts the disposable into the passed array", () => {
        const { workspace } = makeCtx();
        const bag: { dispose(): unknown }[] = [];
        const d = workspace.onWillSaveTextDocument(() => undefined, undefined, bag as never);
        expect(bag).toContain(d);
    });

    it("onDidSaveTextDocument: flag, second listener, dispose down to zero, disposables", () => {
        const { stub, workspace } = makeCtx();
        const bag: { dispose(): unknown }[] = [];
        const d1 = workspace.onDidSaveTextDocument(() => undefined, undefined, bag as never);
        expect(bag).toContain(d1);
        expect(stub.notifies).toContainEqual({
            method: "workspace.updateSubscriptions",
            params: { willSave: false, didSave: true, documentSync: false },
        });
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
    const F_URI = Uri.file("/f.txt").toString();
    const openDoc = (stub: IStubRpc, text: string, uri = F_URI) => {
        stub.fire("editor.didOpen", { uri, languageId: "plaintext", version: 1, text });
    };
    /** The will-save request carries no text — only the document version. */
    const PARAMS = { uri: F_URI, languageId: "plaintext", version: 1, isDirty: true, reason: 1 };

    it("serializes the participant's TextEdit[] (document from the mirror + fire + waitUntil)", async () => {
        const { stub, ctx, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            expect(e.document).toBe(ctx.registry.get(Uri.file("/f.txt")));
            expect(e.document.getText()).toBe("abc   \n");
            expect(e.document.isDirty).toBe(true);
            e.waitUntil(Promise.resolve([TextEdit.delete(new Range(0, 3, 0, 6))]));
        });
        openDoc(stub, "abc   \n");
        const result = await stub.callRequest(REQUEST, PARAMS);
        expect(result).toEqual([
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 6 } }, text: "" },
        ]);
        expect(ctx.registry.get(Uri.file("/f.txt"))?.getText()).toBe("abc   \n");
    });

    it("serializes setEndOfLine (CRLF→2, LF→1)", async () => {
        const crlf = makeCtx();
        crlf.workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([TextEdit.setEndOfLine(EndOfLine.CRLF)]));
        });
        openDoc(crlf.stub, "a\n");
        expect(await crlf.stub.callRequest(REQUEST, PARAMS)).toEqual([{ setEndOfLine: 2 }]);

        const lf = makeCtx();
        lf.workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([TextEdit.setEndOfLine(EndOfLine.LF)]));
        });
        openDoc(lf.stub, "a\n");
        expect(await lf.stub.callRequest(REQUEST, PARAMS)).toEqual([{ setEndOfLine: 1 }]);
    });

    it("a corrupt edit (non-numeric range, non-string text) is dropped one by one — the host does not re-validate the answer", async () => {
        const { stub, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            const broken = TextEdit.delete(new Range(0, 0, 0, 1));
            (broken as { range: unknown }).range = {
                start: { line: NaN, character: 0 },
                end: { line: 0, character: 1 },
            };
            const noText = TextEdit.replace(new Range(0, 0, 0, 1), "x");
            (noText as { newText: unknown }).newText = 42;
            e.waitUntil(Promise.resolve([broken, noText, TextEdit.insert(new Position(0, 0), "ok")]));
        });
        openDoc(stub, "a\n");
        expect(await stub.callRequest(REQUEST, PARAMS)).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "ok" },
        ]);
    });

    it("passes the document eol into the registry (for the extension's SetEndOfLine)", async () => {
        const { stub, ctx, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([]));
        });
        openDoc(stub, "a\n");
        await stub.callRequest(REQUEST, { ...PARAMS, eol: 2 });
        expect(ctx.registry.get(Uri.file("/f.txt"))?.eol).toBe(EndOfLine.CRLF);
    });

    it("passes the document encoding into the registry (#106)", async () => {
        const { stub, ctx, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.resolve([]));
        });
        openDoc(stub, "a\n");
        await stub.callRequest(REQUEST, { ...PARAMS, encoding: "windows1251" });
        expect(ctx.registry.get(Uri.file("/f.txt"))?.encoding).toBe("windows1251");
    });

    it("minimal params (no reason/languageId/isDirty) do not fail", async () => {
        const { stub, ctx, workspace } = makeCtx();
        let reason: number | undefined;
        workspace.onWillSaveTextDocument((e) => {
            reason = e.reason as unknown as number;
            e.waitUntil(Promise.resolve([]));
        });
        const uri = Uri.file("/x.txt").toString();
        stub.fire("editor.didOpen", { uri, languageId: "markdown", version: 1, text: "x" });
        expect(await stub.callRequest(REQUEST, { uri, version: 1 })).toEqual([]);
        expect(reason).toBe(1); // TextDocumentSaveReason.Manual by default
        // Metadata not present in the request stays from didOpen.
        const doc = ctx.registry.get(Uri.file("/x.txt"));
        expect(doc?.getText()).toBe("x");
        expect(doc?.languageId).toBe("markdown");
        expect(doc?.isDirty).toBe(false);
    });

    it("a document that is not open, stale, or ahead of the mirror gives [] without an event", async () => {
        const { stub, ctx, workspace } = makeCtx();
        let fired = 0;
        workspace.onWillSaveTextDocument((e) => {
            fired++;
            e.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), "x")]));
        });

        // Not open: the host never sent didOpen — no document is created.
        expect(await stub.callRequest(REQUEST, PARAMS)).toEqual([]);
        expect(ctx.registry.get(Uri.file("/f.txt"))).toBeUndefined();

        openDoc(stub, "a\n");
        stub.fire("editor.didChange", {
            uri: F_URI,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "b" }],
        });
        // Stale: the model is already at v2; the request metadata (isDirty) is not applied.
        expect(await stub.callRequest(REQUEST, PARAMS)).toEqual([]);
        expect(ctx.registry.get(Uri.file("/f.txt"))?.isDirty).toBe(false);
        // Ahead of the mirror: an ordering violation, goes to stderr.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await stub.callRequest(REQUEST, { ...PARAMS, version: 3 })).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        // Closed: the version matches, but the document is no longer in the mirror.
        stub.fire("editor.didClose", { uri: F_URI });
        expect(await stub.callRequest(REQUEST, { ...PARAMS, version: 2 })).toEqual([]);
        expect(fired).toBe(0);
    });

    it("returns [] without listeners", async () => {
        const { stub } = makeCtx();
        openDoc(stub, "a\n");
        expect(await stub.callRequest(REQUEST, PARAMS)).toEqual([]);
    });

    it("non-TextEdit and non-array results are dropped", async () => {
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
        openDoc(stub, "a\n");
        expect(await stub.callRequest(REQUEST, PARAMS)).toEqual([
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" },
        ]);
    });

    it("a rejected waitUntil thenable is treated as []", async () => {
        const { stub, workspace } = makeCtx();
        workspace.onWillSaveTextDocument((e) => {
            e.waitUntil(Promise.reject(new Error("boom")));
        });
        openDoc(stub, "a\n");
        expect(await stub.callRequest(REQUEST, PARAMS)).toEqual([]);
    });

    it("waitUntil after dispatch completes is ignored", async () => {
        const { stub, workspace } = makeCtx();
        let captured: { waitUntil: (t: Thenable<unknown>) => void } | undefined;
        workspace.onWillSaveTextDocument((e) => {
            captured = e;
        });
        openDoc(stub, "a\n");
        const result = await stub.callRequest(REQUEST, PARAMS);
        expect(result).toEqual([]);
        // collecting is already false — the edit is not picked up (and does not throw)
        captured?.waitUntil(Promise.resolve([TextEdit.insert(new Position(0, 0), "x")]));
    });

    it("per-listener timeout → [] if waitUntil never resolves", async () => {
        vi.useFakeTimers();
        try {
            const { stub, workspace } = makeCtx();
            workspace.onWillSaveTextDocument((e) => {
                e.waitUntil(new Promise(() => {}));
            });
            openDoc(stub, "a\n");
            const pending = stub.callRequest(REQUEST, PARAMS);
            await vi.advanceTimersByTimeAsync(1500);
            expect(await pending).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("WorkspaceNamespace — did-save notification", () => {
    it("fires onDidSaveTextDocument with the document from the registry", () => {
        const { stub, workspace } = makeCtx();
        let saved: { fileName: string; languageId: string } | undefined;
        workspace.onDidSaveTextDocument((doc) => {
            saved = doc as unknown as { fileName: string; languageId: string };
        });
        stub.fire("workspace.didSaveTextDocument", { uri: Uri.file("/f.txt").toString(), languageId: "typescript" });
        expect(saved?.fileName).toBe("/f.txt");
        expect(saved?.languageId).toBe("typescript");
    });

    it("without languageId updates by fileName only", () => {
        const { stub, workspace } = makeCtx();
        let saved: { languageId: string } | undefined;
        workspace.onDidSaveTextDocument((doc) => {
            saved = doc as unknown as { languageId: string };
        });
        stub.fire("workspace.didSaveTextDocument", { uri: Uri.file("/g.txt").toString() });
        expect(saved?.languageId).toBe("plaintext");
    });

    it("invalid fileName is ignored", () => {
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

    it("registration announces the scheme to the host", () => {
        const { stub, workspace } = makeCtx();

        workspace.registerFileSystemProvider("git", provider("x") as never);

        expect(stub.notifies).toContainEqual({
            method: "workspace.fileSystemProvidersChanged",
            params: { schemes: ["git"], readonly: ["git"] },
        });
    });

    it("read-only via isReadonly (also with a MarkdownString reason) and for a provider without writeFile", () => {
        const { stub, workspace } = makeCtx();
        const writable = { ...provider("x"), writeFile: () => undefined };

        workspace.registerFileSystemProvider("rw", writable as never);
        workspace.registerFileSystemProvider("flag", writable as never, { isReadonly: true });
        workspace.registerFileSystemProvider("reason", writable as never, {
            isReadonly: new MarkdownString("revision"),
        });
        workspace.registerFileSystemProvider("nowrite", provider("x") as never);

        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.fileSystemProvidersChanged",
            params: { schemes: ["rw", "flag", "reason", "nowrite"], readonly: ["flag", "reason", "nowrite"] },
        });
        expect(workspace.fs.isWritableFileSystem("rw")).toBe(true);
        expect(workspace.fs.isWritableFileSystem("flag")).toBe(false);
        expect(workspace.fs.isWritableFileSystem("unknown")).toBeUndefined();
    });

    it("disposing the registration removes the scheme from the host", () => {
        const { stub, workspace } = makeCtx();

        workspace.registerFileSystemProvider("git", provider("x") as never).dispose();

        expect(stub.notifies.at(-1)).toEqual({
            method: "workspace.fileSystemProvidersChanged",
            params: { schemes: [], readonly: [] },
        });
    });

    it("host readFile request goes to the provider and returns base64", async () => {
        const { stub, workspace } = makeCtx();
        workspace.registerFileSystemProvider("git", provider("original") as never);

        const result = await stub.callRequest("workspace.fs.readFile", { uri: "git:/repo/a.ts" });

        expect(Buffer.from((result as { content: string }).content, "base64").toString("utf8")).toBe("original");
    });

    it("host writeFile request writes the whole content to the provider: create or overwrite", async () => {
        const { stub, workspace } = makeCtx();
        const writeFile = vi.fn();
        workspace.registerFileSystemProvider("rw", { ...provider("x"), writeFile } as never);

        await expect(
            stub.callRequest("workspace.fs.writeFile", {
                uri: "rw:/repo/a.ts",
                content: Buffer.from("edit").toString("base64"),
            }),
        ).resolves.toBeNull();

        expect(writeFile).toHaveBeenCalledTimes(1);
        const [uri, content, options] = writeFile.mock.calls[0] as [Uri, Uint8Array, unknown];
        expect(uri.toString()).toBe("rw:/repo/a.ts");
        expect(Buffer.from(content).toString("utf8")).toBe("edit");
        expect(options).toEqual({ create: true, overwrite: true });
    });

    it("writeFile to a read-only scheme gives NoPermissions, the provider is not called", async () => {
        const { stub, workspace } = makeCtx();
        const writeFile = vi.fn();
        workspace.registerFileSystemProvider("ro", { ...provider("x"), writeFile } as never, { isReadonly: true });

        await expect(stub.callRequest("workspace.fs.writeFile", { uri: "ro:/a", content: "" })).rejects.toMatchObject({
            code: "NoPermissions",
        });
        await expect(stub.callRequest("workspace.fs.writeFile", { uri: "ro:/a" })).rejects.toThrow(
            /content must be a string/,
        );
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("host stat request: provider metadata; FileNotFound gives null, other errors reject", async () => {
        const { stub, workspace } = makeCtx();
        let failure: Error | null = null;
        workspace.registerFileSystemProvider("rw", {
            ...provider("x"),
            stat: () => {
                if (failure !== null) throw failure;
                return { type: 1, ctime: 2, mtime: 3, size: 4, permissions: 1 };
            },
        } as never);

        await expect(stub.callRequest("workspace.fs.stat", { uri: "rw:/a" })).resolves.toEqual({
            type: 1,
            ctime: 2,
            mtime: 3,
            size: 4,
        });
        failure = FileSystemError.FileNotFound();
        await expect(stub.callRequest("workspace.fs.stat", { uri: "rw:/a" })).resolves.toBeNull();
        failure = FileSystemError.Unavailable();
        await expect(stub.callRequest("workspace.fs.stat", { uri: "rw:/a" })).rejects.toMatchObject({
            code: "Unavailable",
        });
    });

    it("openTextDocument on a provider scheme reads through the provider", async () => {
        const { workspace } = makeCtx();
        workspace.registerFileSystemProvider("rw", provider("proposed\n") as never);

        const doc = await workspace.openTextDocument(Uri.parse("rw:/repo/a.ts"));

        expect(doc.uri.toString()).toBe("rw:/repo/a.ts");
        expect(doc.getText()).toBe("proposed\n");
    });

    it("workspace.fs routes stat and writeFile of the scheme to the provider", async () => {
        const { workspace } = makeCtx();
        const writeFile = vi.fn();
        workspace.registerFileSystemProvider("rw", { ...provider("x"), writeFile } as never);
        workspace.registerFileSystemProvider("ro", provider("x") as never);

        await expect(workspace.fs.stat(Uri.parse("rw:/a"))).resolves.toMatchObject({ type: 1 });
        await workspace.fs.writeFile(Uri.parse("rw:/a"), new Uint8Array([1]));
        expect(writeFile).toHaveBeenCalledWith(expect.anything(), new Uint8Array([1]), {
            create: true,
            overwrite: true,
        });
        await expect(workspace.fs.writeFile(Uri.parse("ro:/a"), new Uint8Array())).rejects.toMatchObject({
            code: "NoPermissions",
        });
        await expect(workspace.fs.stat(Uri.parse("none:/a"))).rejects.toMatchObject({ code: "Unavailable" });
    });

    it("a provider request without a string uri errors with the request name instead of reading garbage", async () => {
        const { stub } = makeCtx();

        for (const method of ["workspace.fs.readFile", "workspace.fs.stat", "workspace.fs.writeFile"]) {
            await expect(stub.callRequest(method, { uri: 42 })).rejects.toThrow(`${method}: uri must be a string`);
        }
    });

    it("readFile on an unregistered scheme errors", async () => {
        const { stub } = makeCtx();

        await expect(stub.callRequest("workspace.fs.readFile", { uri: "git:/a.ts" })).rejects.toThrow(
            /no file system provider for scheme "git"/,
        );
    });

    it("provider changes are sent to the host as a notification", () => {
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

describe("WorkspaceNamespace — registerTaskProvider without tasks", () => {
    it("without a tasks bridge, registration is an empty Disposable and nothing is sent to the host", () => {
        const { stub, workspace } = makeCtx();
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the deprecated `workspace.registerTaskProvider` is exactly what is under test
        const registration = workspace.registerTaskProvider("demo", {
            provideTasks: () => [],
            resolveTask: () => undefined,
        });
        expect(() => {
            registration.dispose();
        }).not.toThrow();
        expect(stub.notifies).toStrictEqual([]);
    });
});

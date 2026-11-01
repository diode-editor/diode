import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { makeStubRpc as makeSharedStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/** Regression: editorconfig compares `activeTextEditor.document === doc` by reference. */
interface StubRpc {
    rpc: SubprocessRpc;
    fireActiveEditorChanged: (filePath: string | null) => void;
    request: ReturnType<typeof vi.fn>;
}

function makeStubRpc(): StubRpc {
    let activeEditorHandler: ((params: unknown) => void) | undefined;
    const request = vi.fn().mockResolvedValue(undefined);
    const rpc = {
        handleNotification: (method: string, handler: (params: unknown) => void) => {
            if (method === "editor.activeEditorChanged") activeEditorHandler = handler;
            return { dispose: () => undefined };
        },
        handleRequest: () => ({ dispose: () => undefined }),
        request,
        notify: vi.fn(),
        dispose: vi.fn(),
    } as unknown as SubprocessRpc;
    return {
        rpc,
        request,
        fireActiveEditorChanged: (filePath) => {
            if (activeEditorHandler === undefined) throw new Error("handler not registered");
            activeEditorHandler({ uri: filePath === null ? null : Uri.file(filePath).toString() });
        },
    };
}

describe("VscodeNamespace: stable activeTextEditor identity", () => {
    it("repeated activeTextEditor returns the same reference", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        expect(vscode.window.activeTextEditor).toBe(vscode.window.activeTextEditor);
    });

    it("editor.document is reference-stable (=== doc for editorconfig)", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        const doc1 = vscode.window.activeTextEditor?.document;
        const doc2 = vscode.window.activeTextEditor?.document;
        expect(doc1).toBe(doc2);
        expect(doc1?.fileName).toBe("/f.ts");
    });

    it("editor from onDidChangeActiveTextEditor === window.activeTextEditor", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        let delivered: unknown;
        vscode.window.onDidChangeActiveTextEditor((e) => (delivered = e));
        fireActiveEditorChanged("/f.ts");
        expect(delivered).toBe(vscode.window.activeTextEditor);
    });

    it("document is a full ExtHostTextDocument (uri/lineAt)", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/dir/f.ts");
        const doc = vscode.window.activeTextEditor?.document as unknown as {
            uri: { fsPath: string };
            lineAt: (n: number) => { text: string };
        };
        expect(doc.uri.fsPath).toBe("/dir/f.ts");
        expect(doc.lineAt(0).text).toBe("");
    });

    it("setting options is proxied to rpc.request(editor.setOptions)", () => {
        const { rpc, fireActiveEditorChanged, request } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        const editor = vscode.window.activeTextEditor!;
        editor.options = { tabSize: 2, insertSpaces: true };
        expect(request).toHaveBeenCalledWith("editor.setOptions", {
            tabSize: 2,
            insertSpaces: true,
            uri: Uri.file("/f.ts").toString(),
            groupId: 1,
        });
    });

    it("no active resource -> activeTextEditor undefined", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        expect(vscode.window.activeTextEditor).toBeDefined();
        fireActiveEditorChanged(null);
        expect(vscode.window.activeTextEditor).toBeUndefined();
    });

    it("value types are exported as runtime fields", () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace as unknown as Record<
            string,
            unknown
        >;
        for (const name of [
            "Position",
            "Range",
            "Selection",
            "TextEdit",
            "Uri",
            "EventEmitter",
            "EndOfLine",
            "FoldingRange",
            "FoldingRangeKind",
            "Location",
            "Diagnostic",
            "DiagnosticRelatedInformation",
            "DiagnosticSeverity",
            "DiagnosticTag",
            "CodeLens",
            "CodeAction",
            "CodeActionKind",
            "DocumentLink",
            "DocumentHighlight",
            "DocumentHighlightKind",
            "LinkedEditingRanges",
            "InlayHint",
            "SymbolInformation",
            "SymbolKind",
            "SymbolTag",
            "CompletionItemTag",
            "CompletionList",
            "CompletionTriggerKind",
            "SnippetString",
            "CallHierarchyItem",
            "CallHierarchyIncomingCall",
            "CallHierarchyOutgoingCall",
            "TypeHierarchyItem",
            "CancellationError",
            "CancellationTokenSource",
            "LogLevel",
            "ProgressLocation",
            "MarkdownString",
            "Hover",
            "WorkspaceEdit",
            "ViewColumn",
            "TabInputText",
            "TabInputTextDiff",
            "TabInputCustom",
            "TabInputWebview",
            "TabInputNotebook",
            "TabInputNotebookDiff",
            "TabInputTerminal",
        ]) {
            expect(vscode[name], name).toBeDefined();
        }
    });

    it("version is a valid VS Code semver in lockstep with extensions/VSCODE_VERSION", async () => {
        const { readFile } = await import("node:fs/promises");
        const pinned = (
            await readFile(new URL("../../../../../extensions/VSCODE_VERSION", import.meta.url), "utf8")
        ).trim();
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        // vscode-languageclient checks semver `^1.91.0`.
        expect(vscode.version).toBe(pinned);
        expect(vscode.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("registerTextEditorCommand receives EXACTLY window.activeTextEditor (getter wiring)", async () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.py");
        let delivered: unknown;
        vscode.commands.registerTextEditorCommand("test.te", (editor) => {
            delivered = editor;
        });
        await vscode.commands.executeCommand("test.te");
        expect(delivered).toBeDefined();
        expect(delivered).toBe(vscode.window.activeTextEditor);
    });

    it("extensions is the host's catalog, honestly empty until it arrives", () => {
        const stub = makeSharedStubRpc();
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        // The host has not sent the catalog yet (in real life it is seeded before the first activation): an empty set is the correct answer.
        expect(vscode.extensions.getExtension("ms-python.vscode-pylance")).toBeUndefined();
        expect(vscode.extensions.all).toEqual([]);
        const sub = vscode.extensions.onDidChange(() => undefined);
        sub.dispose();

        stub.fire("extensions.catalog", {
            extensions: [{ id: "pub.one", extensionPath: "/ext/one", packageJSON: { name: "one" }, isActive: true }],
        });
        expect(vscode.extensions.getExtension("pub.one")?.isActive).toBe(true);
        expect(vscode.extensions.all.map((e) => e.id)).toEqual(["pub.one"]);
    });

    it("tasks is a naive namespace: registerTaskProvider returns a disposable, events are subscribable", () => {
        const { rpc } = makeStubRpc();
        // Duck cast: the no-op namespace of the dormant part of d.ts does not widen the active surface.
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace as unknown as {
            tasks: {
                registerTaskProvider(type: string, provider: unknown): { dispose(): void };
                taskExecutions: readonly unknown[];
                onDidStartTask(listener: () => void): { dispose(): void };
                onDidEndTask(listener: () => void): { dispose(): void };
            };
        };
        // vscode-eslint calls this with `eslint.lintTask.enable: true`.
        const registration = vscode.tasks.registerTaskProvider("eslint", {
            provideTasks: () => [],
            resolveTask: () => undefined,
        });
        registration.dispose();
        expect(vscode.tasks.taskExecutions).toEqual([]);
        vscode.tasks.onDidStartTask(() => undefined).dispose();
        vscode.tasks.onDidEndTask(() => undefined).dispose();
    });

    it("ExtensionMode is a runtime enum (context.extensionMode is compared against it)", () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        expect(vscode.ExtensionMode.Production).toBe(1);
        expect(vscode.ExtensionMode.Development).toBe(2);
        expect(vscode.ExtensionMode.Test).toBe(3);
    });

    it("env holds the shim constants read by vscode-languageclient", () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { appName: string; appHost: string; language: string; uriScheme: string };
        };
        expect(vscode.env.appName).toBe("Diode");
        expect(vscode.env.appHost).toBe("desktop");
        expect(vscode.env.language).toBe("en");
        expect(vscode.env.uriScheme).toBe("diode");
    });

    it("env.clipboard goes to the host instead of answering empty", async () => {
        const stub = makeSharedStubRpc();
        stub.responder = (method) => (method === "env.clipboard.readText" ? { text: "from host" } : null);
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { clipboard: { readText(): Thenable<string>; writeText(t: string): Thenable<void> } };
        };

        expect(await vscode.env.clipboard.readText()).toBe("from host");
        await vscode.env.clipboard.writeText("copied");

        expect(stub.requests).toEqual([
            { method: "env.clipboard.readText", params: undefined },
            { method: "env.clipboard.writeText", params: { text: "copied" } },
        ]);
    });

    it("env.openExternal is sent to the host in UNencoded form (as upstream)", async () => {
        const stub = makeSharedStubRpc();
        stub.responder = () => ({ opened: true });
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { openExternal(target: unknown): Thenable<boolean> };
        };

        await expect(vscode.env.openExternal(Uri.parse("https://example.com/a?token=42"))).resolves.toBe(true);

        expect(stub.requests).toEqual([
            { method: "env.openExternal", params: { uri: "https://example.com/a?token=42" } },
        ]);
    });

    it("env.openExternal returns false when the host did not open the link", async () => {
        const stub = makeSharedStubRpc();
        stub.responder = () => ({ opened: false });
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { openExternal(target: unknown): Thenable<boolean> };
        };

        await expect(vscode.env.openExternal(Uri.parse("file:///etc/passwd"))).resolves.toBe(false);
    });
});

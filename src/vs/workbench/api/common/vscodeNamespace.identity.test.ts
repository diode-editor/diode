import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import type { RpcEndpoint } from "./rpcEndpoint.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/**
 * Регресс на баг идентичности: раньше `makeEditorProxy` создавал НОВЫЙ объект
 * editor/document на каждый геттер `activeTextEditor`, и `activeTextEditor.
 * document === doc` (сравнение по ссылке, как в editorconfig) ломалось.
 */
interface StubRpc {
    rpc: RpcEndpoint;
    /** Принимает путь на диске и поднимает его в ресурс — как это делает хост. */
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
    } as unknown as RpcEndpoint;
    return {
        rpc,
        request,
        fireActiveEditorChanged: (filePath) => {
            if (activeEditorHandler === undefined) throw new Error("handler not registered");
            activeEditorHandler({ uri: filePath === null ? null : Uri.file(filePath).toString() });
        },
    };
}

describe("VscodeNamespace — стабильная идентичность activeTextEditor", () => {
    it("повторный activeTextEditor возвращает ту же ссылку", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
        fireActiveEditorChanged("/f.ts");
        expect(vscode.window.activeTextEditor).toBe(vscode.window.activeTextEditor);
    });

    it("editor.document стабилен по ссылке (=== doc для editorconfig)", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
        fireActiveEditorChanged("/f.ts");
        const doc1 = vscode.window.activeTextEditor?.document;
        const doc2 = vscode.window.activeTextEditor?.document;
        expect(doc1).toBe(doc2);
        expect(doc1?.fileName).toBe("/f.ts");
    });

    it("editor из onDidChangeActiveTextEditor === window.activeTextEditor", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
        let delivered: unknown;
        vscode.window.onDidChangeActiveTextEditor((e) => (delivered = e));
        fireActiveEditorChanged("/f.ts");
        expect(delivered).toBe(vscode.window.activeTextEditor);
    });

    it("document — полноценный ExtHostTextDocument (uri/lineAt)", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
        fireActiveEditorChanged("/dir/f.ts");
        const doc = vscode.window.activeTextEditor?.document as unknown as {
            uri: { fsPath: string };
            lineAt: (n: number) => { text: string };
        };
        expect(doc.uri.fsPath).toBe("/dir/f.ts");
        expect(doc.lineAt(0).text).toBe("");
    });

    it("установка options проксируется в rpc.request(editor.setOptions)", () => {
        const { rpc, fireActiveEditorChanged, request } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
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

    it("отсутствие активного ресурса → activeTextEditor undefined", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
        fireActiveEditorChanged("/f.ts");
        expect(vscode.window.activeTextEditor).toBeDefined();
        fireActiveEditorChanged(null);
        expect(vscode.window.activeTextEditor).toBeUndefined();
    });

    it("value-типы экспортированы как runtime-поля", () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace as unknown as Record<string, unknown>;
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
            // Поверхность vscode-languageclient (LSP): он extends-ит эти типы на require.
            "Location",
            "Diagnostic",
            "DiagnosticSeverity",
            "DiagnosticTag",
            "CodeLens",
            "CodeAction",
            "CodeActionKind",
            "DocumentLink",
            "DocumentHighlightKind",
            "InlayHint",
            "SymbolInformation",
            "SymbolKind",
            "SymbolTag",
            "CompletionItemTag",
            // Конвертер completion'ов конструирует их на КАЖДЫЙ ответ сервера
            // (`new code.CompletionList(...)`, `new code.SnippetString(...)`);
            // пропуск ронял конвертацию целиком, а ошибка видна только в
            // outputChannel клиента — попап молча оставался без LSP-пунктов.
            "CompletionList",
            "CompletionTriggerKind",
            "SnippetString",
            "CallHierarchyItem",
            "TypeHierarchyItem",
            "CancellationError",
            "CancellationTokenSource",
            "LogLevel",
            "ProgressLocation",
            "MarkdownString",
            "Hover",
            "WorkspaceEdit",
            // Полоса групп (EditorGroups): instanceof-каскад по TabInput* — типовой
            // код расширений, отсутствующий класс дал бы TypeError, не false.
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

    it("version — валидный VS Code semver в лок-степе с extensions/VSCODE_VERSION", async () => {
        const { readFile } = await import("node:fs/promises");
        const pinned = (await readFile(new URL("../../../../../extensions/VSCODE_VERSION", import.meta.url), "utf8")).trim();
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace;
        // vscode-languageclient проверяет semver `^1.91.0` — «vexx-phase-1» его ронял.
        expect(vscode.version).toBe(pinned);
        expect(vscode.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("env — наивные поля, которые читает vscode-languageclient", async () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc).namespace as unknown as {
            env: {
                appName: string;
                language: string;
                clipboard: { readText(): Thenable<string>; writeText(t: string): Thenable<void> };
                openExternal(): Thenable<boolean>;
            };
        };
        expect(vscode.env.appName).toBe("Vexx");
        expect(vscode.env.language).toBe("en");
        expect(await vscode.env.clipboard.readText()).toBe("");
        await vscode.env.clipboard.writeText("x");
        expect(await vscode.env.openExternal()).toBe(false);
    });
});

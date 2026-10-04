import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { makeStubRpc as makeSharedStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/**
 * Регресс на баг идентичности: раньше `makeEditorProxy` создавал НОВЫЙ объект
 * editor/document на каждый геттер `activeTextEditor`, и `activeTextEditor.
 * document === doc` (сравнение по ссылке, как в editorconfig) ломалось.
 */
interface StubRpc {
    rpc: SubprocessRpc;
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

describe("VscodeNamespace — стабильная идентичность activeTextEditor", () => {
    it("повторный activeTextEditor возвращает ту же ссылку", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        expect(vscode.window.activeTextEditor).toBe(vscode.window.activeTextEditor);
    });

    it("editor.document стабилен по ссылке (=== doc для editorconfig)", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        const doc1 = vscode.window.activeTextEditor?.document;
        const doc2 = vscode.window.activeTextEditor?.document;
        expect(doc1).toBe(doc2);
        expect(doc1?.fileName).toBe("/f.ts");
    });

    it("editor из onDidChangeActiveTextEditor === window.activeTextEditor", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        let delivered: unknown;
        vscode.window.onDidChangeActiveTextEditor((e) => (delivered = e));
        fireActiveEditorChanged("/f.ts");
        expect(delivered).toBe(vscode.window.activeTextEditor);
    });

    it("document — полноценный ExtHostTextDocument (uri/lineAt)", () => {
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

    it("установка options проксируется в rpc.request(editor.setOptions)", () => {
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

    it("отсутствие активного ресурса → activeTextEditor undefined", () => {
        const { rpc, fireActiveEditorChanged } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        fireActiveEditorChanged("/f.ts");
        expect(vscode.window.activeTextEditor).toBeDefined();
        fireActiveEditorChanged(null);
        expect(vscode.window.activeTextEditor).toBeUndefined();
    });

    it("value-типы экспортированы как runtime-поля", () => {
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
            // Поверхность vscode-languageclient (LSP): он extends-ит эти типы на require.
            "Location",
            "Diagnostic",
            // Конвертер диагностик конструирует его на КАЖДУЮ диагностику с
            // related information (у tsserver это TS2741 «Property … is missing»
            // и дубликаты идентификаторов): без класса падала вся пачка —
            // файл оставался вообще без squiggle.
            "DiagnosticRelatedInformation",
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
        const pinned = (
            await readFile(new URL("../../../../../extensions/VSCODE_VERSION", import.meta.url), "utf8")
        ).trim();
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        // vscode-languageclient проверяет semver `^1.91.0` — «diode-phase-1» его ронял.
        expect(vscode.version).toBe(pinned);
        expect(vscode.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("registerTextEditorCommand получает ИМЕННО window.activeTextEditor (проводка геттера)", async () => {
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

    it("extensions — каталог от хоста, до его приезда состав честно пуст", () => {
        // Общий стаб — здешний ловит только editor.activeEditorChanged.
        const stub = makeSharedStubRpc();
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        // Хост ещё не прислал каталог (в жизни он приезжает семенем ДО первой
        // активации) — пустой состав тут верный ответ, а не заглушка.
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

    it("tasks — наивный namespace: registerTaskProvider отдаёт disposable, события подписываем", () => {
        const { rpc } = makeStubRpc();
        // Утиный каст как у env-теста: no-op namespace дормантной части dts
        // (`vscode.tasks`) активную поверхность не расширяет.
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace as unknown as {
            tasks: {
                registerTaskProvider(type: string, provider: unknown): { dispose(): void };
                taskExecutions: readonly unknown[];
                onDidStartTask(listener: () => void): { dispose(): void };
                onDidEndTask(listener: () => void): { dispose(): void };
            };
        };
        // vscode-eslint зовёт это при `eslint.lintTask.enable: true` — включённая
        // пользователем настройка не должна ронять клиент целиком.
        const registration = vscode.tasks.registerTaskProvider("eslint", {
            provideTasks: () => [],
            resolveTask: () => undefined,
        });
        registration.dispose();
        expect(vscode.tasks.taskExecutions).toEqual([]);
        vscode.tasks.onDidStartTask(() => undefined).dispose();
        vscode.tasks.onDidEndTask(() => undefined).dispose();
    });

    it("ExtensionMode — runtime-enum (context.extensionMode сравнивают с ним)", () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace;
        expect(vscode.ExtensionMode.Production).toBe(1);
        expect(vscode.ExtensionMode.Development).toBe(2);
        expect(vscode.ExtensionMode.Test).toBe(3);
    });

    it("env — константы шима, которые читает vscode-languageclient", () => {
        const { rpc } = makeStubRpc();
        const vscode = buildVscodeNamespace(rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { appName: string; appHost: string; language: string; uriScheme: string };
        };
        expect(vscode.env.appName).toBe("Diode");
        expect(vscode.env.appHost).toBe("desktop");
        expect(vscode.env.language).toBe("en");
        expect(vscode.env.uriScheme).toBe("diode");
    });

    it("env.clipboard ходит к хосту, а не отвечает пустотой", async () => {
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

    it("env.openExternal уезжает хосту в НЕкодированной форме (как в эталоне)", async () => {
        const stub = makeSharedStubRpc();
        stub.responder = () => ({ opened: true });
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { openExternal(target: unknown): Thenable<boolean> };
        };

        // `toString()` дал бы `?token%3D42`, и системному обработчику досталась
        // бы не та ссылка.
        await expect(vscode.env.openExternal(Uri.parse("https://example.com/a?token=42"))).resolves.toBe(true);

        expect(stub.requests).toEqual([
            { method: "env.openExternal", params: { uri: "https://example.com/a?token=42" } },
        ]);
    });

    it("env.openExternal отдаёт false, когда хост ссылку не открыл", async () => {
        const stub = makeSharedStubRpc();
        stub.responder = () => ({ opened: false });
        const vscode = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace as unknown as {
            env: { openExternal(target: unknown): Thenable<boolean> };
        };

        await expect(vscode.env.openExternal(Uri.parse("file:///etc/passwd"))).resolves.toBe(false);
    });
});

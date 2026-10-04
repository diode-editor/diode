import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { createExtensionApi, OWNED_MEMBERS } from "./extensionApiFactory.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

/**
 * Оверлей поверх НАСТОЯЩЕГО общего namespace: список обёрнутых членов сверен с
 * ним, а поведение через оверлей то же, что напрямую.
 */

/**
 * `register*Provider` общего `languages`, которые оверлей сознательно не
 * оборачивает: no-op заглушки вне активной поверхности `vscode.d.ts`. Новый
 * `register*Provider` в шиме обязан попасть либо в OWNED_MEMBERS, либо сюда.
 */
const NOOP_PROVIDERS = [
    "registerCallHierarchyProvider",
    "registerCodeLensProvider",
    "registerColorProvider",
    "registerDeclarationProvider",
    "registerDocumentHighlightProvider",
    "registerDocumentLinkProvider",
    "registerDocumentRangeSemanticTokensProvider",
    "registerDocumentSemanticTokensProvider",
    "registerDocumentSymbolProvider",
    "registerImplementationProvider",
    "registerInlayHintsProvider",
    "registerInlineValuesProvider",
    "registerLinkedEditingRangeProvider",
    "registerOnTypeFormattingEditProvider",
    "registerSelectionRangeProvider",
    "registerTypeDefinitionProvider",
    "registerTypeHierarchyProvider",
    "registerWorkspaceSymbolProvider",
];

function build(): ReturnType<typeof buildVscodeNamespace> & { stub: ReturnType<typeof makeStubRpc> } {
    const stub = makeStubRpc();
    return { ...buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()), stub };
}

describe("оверлей поверх настоящего namespace", () => {
    it("каждый обёрнутый член существует и является функцией", () => {
        const { namespace } = build();
        for (const name of OWNED_MEMBERS.window) expect(typeof namespace.window[name]).toBe("function");
        for (const name of OWNED_MEMBERS.languages) expect(typeof namespace.languages[name]).toBe("function");
        for (const name of OWNED_MEMBERS.commands) expect(typeof namespace.commands[name]).toBe("function");
    });

    it("все `register*Provider` languages либо обёрнуты, либо известные no-op", () => {
        const { namespace } = build();
        const providers = Object.keys(namespace.languages).filter((k) => /^register\w*Provider$/.test(k));
        const owned: readonly string[] = OWNED_MEMBERS.languages;
        expect(providers.filter((k) => !owned.includes(k)).sort()).toEqual([...NOOP_PROVIDERS].sort());
    });

    it("window.activeTextEditor через оверлей живой", () => {
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a");
        expect(api.window.activeTextEditor).toBeUndefined();
        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/a.txt").toString() });
        expect(api.window.activeTextEditor?.document.uri.fsPath).toBe(Uri.file("/a.txt").fsPath);
        expect(api.window.activeTextEditor).toBe(namespace.window.activeTextEditor);
    });

    it("регистрация через оверлей доходит до хоста так же, как напрямую", () => {
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a");
        const disposable = api.commands.registerCommand("pub.a.cmd", () => "ok");
        expect(stub.notifies).toContainEqual({ method: "commands.registerCommand", params: { id: "pub.a.cmd" } });
        disposable.dispose();
        expect(stub.notifies).toContainEqual({ method: "commands.unregisterCommand", params: { id: "pub.a.cmd" } });
        expect(owner.current).toBeUndefined();
    });

    it("value-типы одни на все расширения", () => {
        const { namespace, owner } = build();
        const a = createExtensionApi(namespace, owner, "pub.a");
        const b = createExtensionApi(namespace, owner, "pub.b");
        expect(a.Position).toBe(b.Position);
        expect(new a.Range(0, 0, 0, 1)).toBeInstanceOf(b.Range);
        expect(a.workspace).toBe(b.workspace);
    });
});

describe("владелец оверлея в логах сбоев", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("сбой провайдера, зарегистрированного через оверлей, — строка stderr с id; напрямую — без", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined).mock.calls;
        const { namespace, owner, stub } = build();
        const api = createExtensionApi(namespace, owner, "pub.a");
        stub.fire("editor.didOpen", { uri: "file:///proj/a.py", languageId: "python", version: 1, text: "x\n" });
        const boom = new Error("hover boom");
        const failing: vscode.HoverProvider = {
            provideHover: () => {
                throw boom;
            },
        };
        api.languages.registerHoverProvider("python", failing);
        namespace.languages.registerHoverProvider("python", failing);

        const params = { uri: "file:///proj/a.py", languageId: "python", version: 1, line: 0, character: 0 };
        await stub.callRequest("languages.provideHover", { ...params, handle: 0 });
        await stub.callRequest("languages.provideHover", { ...params, handle: 1 });

        expect(errors).toEqual([
            [`[ext-host] [pub.a] provideHover failed: ${String(boom.stack)}`],
            [`[ext-host] provideHover failed: ${String(boom.stack)}`],
        ]);
    });

    it("предупреждение текстовой команды без редактора несёт id владельца оверлея", async () => {
        const warns = vi.spyOn(console, "warn").mockImplementation(() => undefined).mock.calls;
        const { namespace, owner } = build();
        const api = createExtensionApi(namespace, owner, "pub.a");
        api.commands.registerTextEditorCommand("pub.a.edit", () => undefined);

        await namespace.commands.executeCommand("pub.a.edit");

        expect(warns).toEqual([['[pub.a] Cannot execute text editor command "pub.a.edit": no active text editor']]);
    });
});

import { describe, expect, it, vi } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { createExtensionApi } from "./extensionApiFactory.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

function makeVscode() {
    const stub = makeStubRpc();
    const { namespace, owner } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    return { stub, vscode: namespace, apiOf: (id: string) => createExtensionApi(namespace, owner, id) };
}

function warnings(stub: ReturnType<typeof makeStubRpc>): string[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { value: string; level: string; channel: string; label: string })
        .map((p) => `${p.channel}/${p.label}/${p.level}: ${p.value}`);
}

const makeTool = () => ({ invoke: vi.fn(), prepareInvocation: vi.fn() });

describe("vscode.lm — null object: there are no language models and no tools", () => {
    it("nothing is available: no tools, no chat models", async () => {
        const { vscode } = makeVscode();
        expect(vscode.lm.tools).toEqual([]);
        await expect(vscode.lm.selectChatModels()).resolves.toEqual([]);
        await expect(vscode.lm.selectChatModels({ vendor: "copilot" })).resolves.toEqual([]);
    });

    it("onDidChangeChatModels is a valid subscription that never fires", () => {
        const { vscode } = makeVscode();
        const listener = vi.fn();
        vscode.lm.onDidChangeChatModels(listener).dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("register* return a Disposable; nobody calls the tool or the providers; tools stay empty", () => {
        const { vscode } = makeVscode();
        const tool = makeTool();
        const mcp = { provideMcpServerDefinitions: vi.fn() };
        const chat = {
            provideLanguageModelChatInformation: vi.fn(),
            provideLanguageModelChatResponse: vi.fn(),
            provideTokenCount: vi.fn(),
        };
        const disposables = [
            vscode.lm.registerTool("codelldb", tool),
            vscode.lm.registerMcpServerDefinitionProvider("pub.mcp", mcp),
            vscode.lm.registerLanguageModelChatProvider("pub", chat),
        ];
        for (const disposable of disposables) {
            expect(() => {
                disposable.dispose();
            }).not.toThrow();
        }
        for (const fn of [tool.invoke, tool.prepareInvocation, mcp.provideMcpServerDefinitions]) {
            expect(fn).not.toHaveBeenCalled();
        }
        for (const fn of Object.values(chat)) expect(fn).not.toHaveBeenCalled();
    });

    it("invokeTool is refused with a reason, even for a tool that was registered", async () => {
        const { vscode } = makeVscode();
        const tool = makeTool();
        vscode.lm.registerTool("codelldb", tool);
        expect(vscode.lm.tools).toEqual([]);
        const options = { toolInvocationToken: undefined, input: {} };
        await expect(vscode.lm.invokeTool("codelldb", options)).rejects.toThrow(
            'cannot invoke language model tool "codelldb": no language model tools in Diode',
        );
        expect(tool.invoke).not.toHaveBeenCalled();
    });

    it("the user gets one line per extension, naming it", () => {
        const { stub, apiOf } = makeVscode();
        const tool = makeTool();
        const lldb = apiOf("vadimcn.vscode-lldb");
        lldb.lm.registerTool("codelldb_session_info", tool);
        lldb.lm.registerTool("codelldb", tool);
        lldb.lm.registerMcpServerDefinitionProvider("lldb.mcp", { provideMcpServerDefinitions: () => [] });
        apiOf("pub.mcp").lm.registerMcpServerDefinitionProvider("pub.mcp", { provideMcpServerDefinitions: () => [] });
        apiOf("pub.chat").lm.registerLanguageModelChatProvider("pub", {
            provideLanguageModelChatInformation: () => [],
            provideLanguageModelChatResponse: () => Promise.resolve(),
            provideTokenCount: () => Promise.resolve(0),
        });
        expect(warnings(stub)).toEqual([
            'extensions/Extensions/warn: "vadimcn.vscode-lldb" registers language model tools; Diode has no language models, they are ignored',
            'extensions/Extensions/warn: "pub.mcp" registers MCP server definitions; Diode has no language models, they are ignored',
            'extensions/Extensions/warn: "pub.chat" registers a language model chat provider; Diode has no language models, they are ignored',
        ]);
    });

    it("outside an extension's overlay the line names nobody, once", () => {
        const { stub, vscode } = makeVscode();
        const tool = makeTool();
        vscode.lm.registerTool("a", tool);
        vscode.lm.registerTool("b", tool);
        expect(warnings(stub)).toEqual([
            "extensions/Extensions/warn: an extension registers language model tools; Diode has no language models, they are ignored",
        ]);
    });
});

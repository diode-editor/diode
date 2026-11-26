import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, EventEmitter } from "./vscodeTypes.ts";

/**
 * There are no language models in Diode (no chat, no Copilot), but without the namespace
 * CodeLLDB died on `vscode.lm.registerTool(...)` in the middle of `activate()` and its `lldb.*`
 * commands never got registered. Shape follows upstream, behavior is "no models and no tools";
 * the user gets one warn line in Output per extension that registers something here.
 */

const OUTPUT_CHANNEL = "extensions";
const OUTPUT_LABEL = "Extensions";

export function createLmNoop(rpc: SubprocessRpc, owner: ExtensionOwner): typeof vscode.lm {
    const reported = new Set<string | undefined>();

    // The registering extension comes from the overlay (`OWNED_MEMBERS.lm`); outside it — "an extension".
    function report(what: string): vscode.Disposable {
        const id = owner.current;
        if (!reported.has(id)) {
            reported.add(id);
            const who = id === undefined ? "an extension" : `"${id}"`;
            rpc.notify("output.append", {
                channel: OUTPUT_CHANNEL,
                label: OUTPUT_LABEL,
                level: "warn",
                value: `${who} registers ${what}; Diode has no language models, they are ignored`,
            });
        }
        return new DisposableImpl(() => undefined);
    }

    return {
        onDidChangeChatModels: new EventEmitter<void>().event,
        selectChatModels: (): Promise<vscode.LanguageModelChat[]> => Promise.resolve([]),
        registerTool: (): vscode.Disposable => report("language model tools"),
        tools: [],
        invokeTool: (name: string): Promise<vscode.LanguageModelToolResult> =>
            Promise.reject(new Error(`cannot invoke language model tool "${name}": no language model tools in Diode`)),
        registerMcpServerDefinitionProvider: (): vscode.Disposable => report("MCP server definitions"),
        registerLanguageModelChatProvider: (): vscode.Disposable => report("a language model chat provider"),
    };
}

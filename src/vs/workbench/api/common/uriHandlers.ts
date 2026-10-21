import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, Uri } from "./vscodeTypes.ts";
import { parseWireHandleUri } from "./wireTypes.ts";

/** Upstream's `ExtHostUrls`: the host decides who gets a URI and when (trust, buffering until activation). */
export function createUriHandlers(rpc: SubprocessRpc, owner: ExtensionOwner): typeof vscode.window.registerUriHandler {
    const handlers = new Map<string, vscode.UriHandler>();

    rpc.handleRequest("window.handleUri", async (params): Promise<null> => {
        const { extensionId, uri } = parseWireHandleUri(params);
        const handler = handlers.get(extensionId.toLowerCase());
        if (handler === undefined) return null;
        // A handler failure is the handler's problem (upstream's `onUnexpectedError`): the URI is already delivered, nothing to report back to the host.
        try {
            await handler.handleUri(Uri.parse(uri));
        } catch (err) {
            console.error(`[${extensionId}] uri handler failed`, err);
        }
        return null;
    });

    return (handler: vscode.UriHandler): vscode.Disposable => {
        const extensionId = owner.current;
        if (extensionId === undefined) {
            throw new Error("registerUriHandler: called outside of an extension");
        }
        const key = extensionId.toLowerCase();
        if (handlers.has(key)) {
            throw new Error(`Protocol handler already registered for extension ${extensionId}`);
        }
        handlers.set(key, handler);
        rpc.notify("window.registerUriHandler", { extensionId });
        return new DisposableImpl(() => {
            if (handlers.get(key) !== handler) return;
            handlers.delete(key);
            rpc.notify("window.unregisterUriHandler", { extensionId });
        });
    };
}

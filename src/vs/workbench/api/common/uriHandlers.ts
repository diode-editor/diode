import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, Uri } from "./vscodeTypes.ts";
import { parseWireHandleUri } from "./wireTypes.ts";

/**
 * `window.registerUriHandler` — `ExtHostUrls` эталона (`extHostUrls.ts`): у
 * расширения один обработчик на всю жизнь активации, адресует его id
 * расширения (authority URI). Субпроцесс держит обработчики, хост — решение,
 * кому и когда отдать URI (доверие, буфер до активации, `onUri:<id>`), и
 * присылает его запросом `window.handleUri`.
 *
 * Владелец — окружающий ({@link ExtensionOwner}): оверлей расширения
 * оборачивает вызов в `runAs`, как у прочих «создающих» членов.
 */
export function createUriHandlers(rpc: SubprocessRpc, owner: ExtensionOwner): typeof vscode.window.registerUriHandler {
    const handlers = new Map<string, vscode.UriHandler>();

    rpc.handleRequest("window.handleUri", async (params): Promise<null> => {
        const { extensionId, uri } = parseWireHandleUri(params);
        const handler = handlers.get(extensionId.toLowerCase());
        if (handler === undefined) return null;
        // Сбой обработчика — его забота, не хоста (`onUnexpectedError` эталона):
        // URI уже отдан, отвечать хосту ошибкой не о чем.
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
            // Повторный dispose — уже снято, второго снятия хосту не шлём.
            if (handlers.get(key) !== handler) return;
            handlers.delete(key);
            rpc.notify("window.unregisterUriHandler", { extensionId });
        });
    };
}

import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";
import { describeRejection } from "../../../base/common/describeRejection.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { callWithVscodeToken } from "./vscodeCancellation.ts";
import type { ExtensionOwner } from "./vscodeHostContext.ts";
import { DisposableImpl, FileDecoration } from "./vscodeTypes.ts";
import type { IWireFileDecoration } from "./wireTypes.ts";

/** Upstream `ExtHostDecorations._maxEventSize`. */
export const MAX_DECORATION_EVENT_SIZE = 250;

interface IProviderData {
    readonly provider: vscode.FileDecorationProvider;
    readonly extensionId: string;
}

function countSlashes(path: string): number {
    return path.split("/").length - 1;
}

/**
 * Upstream's cap of a too big event, as its code behaves: sorted by depth, then by path, the shallowest first, up
 * to the cap. Upstream means "one resource per folder", but its `groupBy` groups only equal paths, so what it
 * drops are repeats of a path (the same file with another query) — kept as is.
 */
export function capDecorationEvent(uris: readonly vscode.Uri[]): vscode.Uri[] {
    const sorted = uris
        .map((uri) => ({ uri, rank: countSlashes(uri.path) }))
        .sort((a, b) => a.rank - b.rank || (a.uri.path < b.uri.path ? -1 : a.uri.path > b.uri.path ? 1 : 0));
    const picked: vscode.Uri[] = [];
    let previousPath: string | undefined;
    for (const { uri } of sorted) {
        if (uri.path === previousPath) continue;
        previousPath = uri.path;
        if (picked.push(uri) >= MAX_DECORATION_EVENT_SIZE) break;
    }
    return picked;
}

/**
 * Upstream `ExtHostDecorations`: every provider gets a handle and is registered with the host, which asks it about
 * the resources it shows in batches (`window.provideFileDecorations`).
 */
export function createFileDecorations(rpc: SubprocessRpc, owner: ExtensionOwner): typeof vscode.window.registerFileDecorationProvider {
    const providers = new Map<number, IProviderData>();
    let nextHandle = 0;

    rpc.handleRequest("window.provideFileDecorations", async ({ handle, requests }, token) => {
        const result: Record<number, IWireFileDecoration> = {};
        const data = providers.get(handle);
        // Might have been unregistered in the meantime.
        if (data === undefined) return result;
        const { provider, extensionId } = data;
        await Promise.all(
            requests.map(async ({ id, uri }) => {
                try {
                    const decoration = await callWithVscodeToken(token, (vsToken) =>
                        provider.provideFileDecoration(Uri.parse(uri), vsToken),
                    );
                    if (decoration === undefined || decoration === null) return;
                    try {
                        FileDecoration.validate(decoration);
                    } catch (err) {
                        console.warn(`[ext-host] INVALID decoration from extension '${extensionId}': ${describeRejection(err)}`);
                        return;
                    }
                    result[id] = {
                        ...(decoration.propagate !== undefined ? { propagate: decoration.propagate } : {}),
                        ...(decoration.tooltip !== undefined ? { tooltip: decoration.tooltip } : {}),
                        ...(decoration.badge !== undefined ? { badge: decoration.badge } : {}),
                        ...(decoration.color !== undefined ? { colorId: decoration.color.id } : {}),
                    };
                } catch (err) {
                    console.error(`[ext-host] [${extensionId}] provideFileDecoration failed: ${describeRejection(err)}`);
                }
            }),
        );
        return result;
    });

    return (provider) => {
        const extensionId = owner.current ?? "";
        const handle = nextHandle++;
        providers.set(handle, { provider, extensionId });
        rpc.notify("window.registerFileDecorationProvider", { handle, extensionId });
        // `null` too: upstream tests `!e`.
        const listener = provider.onDidChangeFileDecorations?.((changed: vscode.Uri | vscode.Uri[] | undefined | null) => {
            if (changed === undefined || changed === null) {
                rpc.notify("window.fileDecorationsChanged", { handle, uris: null });
                return;
            }
            let uris = Array.isArray(changed) ? changed : [changed];
            if (uris.length > MAX_DECORATION_EVENT_SIZE) {
                console.warn(`[ext-host] [Decorations] CAPPING events from decorations provider ${extensionId} ${String(uris.length)}`);
                uris = capDecorationEvent(uris);
            }
            rpc.notify("window.fileDecorationsChanged", { handle, uris: uris.map((uri) => uri.toString()) });
        });
        return new DisposableImpl(() => {
            listener?.dispose();
            rpc.notify("window.unregisterFileDecorationProvider", { handle });
            providers.delete(handle);
        });
    };
}

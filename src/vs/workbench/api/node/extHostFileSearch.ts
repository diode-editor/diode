import { DisposableStore, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { IUseIgnoreFiles } from "../../common/configuration/excludeSettings.ts";
import type { IFileIndexRequest, IFileQueryRequest } from "../../services/search/common/fileSearch.ts";
import { FileSearchEngine } from "../../services/search/node/fileSearchEngine.ts";
import type { SubprocessRpc } from "../common/extHostProtocol.ts";

/**
 * Upstream `ExtHostSearch` (node) with its internal file search provider: the core asks, the
 * subprocess walks and matches, only the top results cross the wire.
 */
export function registerExtHostFileSearch(rpc: SubprocessRpc, engine = new FileSearchEngine()): IDisposable {
    const store = new DisposableStore();
    store.add(engine);
    store.add(
        engine.onDidChangeIndex((cacheKey) => {
            rpc.notify("search.fileIndexChanged", { cacheKey });
        }),
    );
    store.add(rpc.handleRequest("search.fileIndex", (params) => engine.index(parseFileIndexRequest(params))));
    store.add(rpc.handleRequest("search.fileQuery", (params) => engine.query(parseFileQueryRequest(params))));
    store.add(
        // Only the core sends it; a key the engine does not hold is a no-op there.
        rpc.handleNotification("search.clearCache", (params) => {
            engine.clearCache(params.cacheKey);
        }),
    );
    return store;
}

export function parseFileIndexRequest(params: unknown): IFileIndexRequest {
    const p = (params ?? {}) as Partial<Record<keyof IFileIndexRequest, unknown>>;
    if (typeof p.cacheKey !== "string") throw new Error("search.fileIndex: cacheKey must be a string");
    if (typeof p.folder !== "string") throw new Error("search.fileIndex: folder must be a string");
    if (!Array.isArray(p.excludes) || !p.excludes.every((e) => typeof e === "string")) {
        throw new Error("search.fileIndex: excludes must be an array of strings");
    }
    const ignore = (p.useIgnoreFiles ?? {}) as Partial<Record<keyof IUseIgnoreFiles, unknown>>;
    return {
        cacheKey: p.cacheKey,
        folder: p.folder,
        excludes: p.excludes,
        useIgnoreFiles: {
            local: ignore.local !== false,
            parent: ignore.parent === true,
            global: ignore.global === true,
        },
    };
}

export function parseFileQueryRequest(params: unknown): IFileQueryRequest {
    const p = (params ?? {}) as Partial<Record<keyof IFileQueryRequest, unknown>>;
    if (typeof p.cacheKey !== "string") throw new Error("search.fileQuery: cacheKey must be a string");
    if (typeof p.query !== "string") throw new Error("search.fileQuery: query must be a string");
    if (typeof p.maxResults !== "number") throw new Error("search.fileQuery: maxResults must be a number");
    return { cacheKey: p.cacheKey, query: p.query, maxResults: p.maxResults };
}

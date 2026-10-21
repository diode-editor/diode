import * as dns from "node:dns";
import * as fs from "node:fs";
import { createRequire, Module, registerHooks } from "node:module";
import * as path from "node:path";

import type * as vscode from "vscode";

import { describeRejection } from "../../../../base/common/describeRejection.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { importModule } from "../../../../base/node/importModule.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ExtHostEnvironmentVariableCollections } from "../../../api/common/environmentVariableCollection.ts";
import { ExtensionApiFactory, VSCODE_GLOBAL_KEY_NAME } from "../../../api/common/extensionApiFactory.ts";
import { ExtensionPaths } from "../../../api/common/extensionPaths.ts";
import type { IExtensionSecretsFactory } from "../../../api/common/extensionSecrets.ts";
import type { SubprocessRpc } from "../../../api/common/extHostProtocol.ts";
import type { IIpcEndpoint } from "../../../api/common/ipcMessageChannel.ts";
import { IpcMessageChannel } from "../../../api/common/ipcMessageChannel.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import { buildVscodeNamespace } from "../../../api/common/vscodeNamespace.ts";
import { ExtensionMode, Uri } from "../../../api/common/vscodeTypes.ts";
import { parseWireMementoValue } from "../../../api/common/wireTypes.ts";
import type { WorkspaceConfigStore } from "../../../api/common/workspaceConfigStore.ts";
import { createNodeExtHostDisk } from "../../../api/node/extHostDisk.ts";

import { deactivateExtension } from "./extensionDeactivation.ts";
import { createExtensionMemento, type IExtensionMemento } from "./extensionMemento.ts";
import { extensionRootPath } from "./iExtensionEntry.ts";
import { createStderrLogger } from "./stderrLogger.ts";

interface ActivatedExtension {
    readonly id: string;
    readonly mod: ExtensionModule;
    readonly context: ExtensionContext;
}

interface ExtensionModule {
    activate?: (context: ExtensionContext) => unknown;
    deactivate?: () => unknown;
}

interface ExtensionContext {
    readonly subscriptions: { dispose: () => unknown }[];
    readonly extensionPath: string;
    readonly extensionUri: Uri;
    readonly extensionMode: ExtensionMode;
    readonly globalState: IExtensionMemento;
    readonly workspaceState: IExtensionMemento;
    readonly secrets: ReturnType<IExtensionSecretsFactory["create"]>;
    asAbsolutePath(relativePath: string): string;
    readonly globalStorageUri: Uri;
    readonly globalStoragePath: string;
    /** `undefined` when no folder/workspace is open (vscode semantics). */
    readonly storageUri: Uri | undefined;
    readonly storagePath: string | undefined;
    readonly logUri: Uri;
    readonly logPath: string;
    /**
     * Upstream builds a separate `Extension`; we take the entry from the catalog the host sends before the first
     * activation.
     */
    readonly extension: vscode.Extension<unknown>;
    /** The extension's terminal environment collection, surviving its reactivation. */
    readonly environmentVariableCollection: vscode.GlobalEnvironmentVariableCollection;
}

/** Doesn't return in normal operation: the process lives until `host.shutdown` or `disconnect`. */
export function runExtensionHostSubprocess(): void {
    if (typeof process.send !== "function") {
        console.error("[ext-host] subprocess started without IPC channel; exiting");
        process.exit(2);
    }

    // `localhost` → 127.0.0.1 first, like the VS Code extension host (issue #189805): with `verbatim`
    // an extension's TCP server binds `::1` while its Java server connects to 127.0.0.1:
    // "Connection refused" (bazel-java). A call, not a flag: under SEA execArgv isn't ours.
    // Deviation: the subprocess's children don't inherit the order, in VS Code it travels with execArgv.
    dns.setDefaultResultOrder("ipv4first");

    // Extensions fork `process.execPath` (vscode-languageclient, basedpyright), and under SEA
    // that is the diode binary itself: an inherited flag would send the child down the extension host branch.
    // `main.ts` checks `DIODE_RUN_AS_NODE` first.
    delete process.env.DIODE_EXTENSION_HOST;
    process.env.DIODE_RUN_AS_NODE = "1";

    // A forgotten extension promise must not crash the subprocess with all extensions
    // (#194: fire-and-forget `executeCommand` in maptz.regionfolder).
    process.on("unhandledRejection", (reason: unknown) => {
        console.error(`[ext-host] unhandled rejection in extension code: ${describeRejection(reason)}`);
    });
    // The `[ext-host]` prefix lets the host recognize its lines in stderr.
    setUnexpectedErrorHandler((e: unknown) => {
        console.error(`[ext-host] unexpected error: ${describeRejection(e)}`);
    });

    const channel = new IpcMessageChannel(process as unknown as IIpcEndpoint);
    const logger = createStderrLogger();
    const rpc: SubprocessRpc = new RpcEndpoint(channel, logger);

    const {
        configStore,
        extensionExports,
        secrets,
        environmentVariableCollections,
        paths,
        extensions: catalog,
    } = installVscodeStub(rpc, logger);

    const extensions = new Map<string, ActivatedExtension>();

    const persistMemento = async (
        extensionId: string,
        shared: boolean,
        value: Record<string, unknown>,
    ): Promise<void> => {
        await rpc.request("memento.update", { extensionId, shared, value });
    };

    rpc.handleRequest("host.activateExtension", async (params): Promise<null> => {
        const { id, mainPath, source, filename, moduleType, extensionPath, storage, memento } =
            parseActivateParams(params);
        if (extensions.has(id)) {
            throw new Error(`Extension "${id}" already activated`);
        }
        // Index before loading: a `require("vscode")` at module top level must already know whose it is.
        const rootPath = extensionRootPath({ extensionPath, mainPath, filename });
        paths.add(rootPath, id);
        const loaded = await loadExtensionModule({ mainPath, source, filename, moduleType });
        if (typeof loaded.activate !== "function") {
            throw new Error(`Extension "${id}" has no activate() in ${filename ?? mainPath}`);
        }
        // The host sends `extensions.catalog` before activation over the same channel; a missing entry breaks
        // the host contract: fail with the name, not with a TypeError inside `activate()`.
        const extension = catalog.getExtension(id);
        if (extension === undefined) {
            throw new Error(
                `Extension "${id}" is not in the extensions catalog: host must push extensions.catalog before activation`,
            );
        }
        const context: ExtensionContext = {
            subscriptions: [],
            extensionPath: rootPath,
            extensionUri: Uri.file(rootPath),
            extensionMode: ExtensionMode.Production,
            globalState: createExtensionMemento({
                initial: memento.globalState,
                withSync: true,
                persist: (value) => persistMemento(id, true, value),
            }),
            workspaceState: createExtensionMemento({
                initial: memento.workspaceState,
                withSync: false,
                persist: (value) => persistMemento(id, false, value),
            }),
            secrets: secrets.create(id),
            asAbsolutePath: (relativePath: string): string => path.join(rootPath, relativePath),
            // Directories aren't created: per the vscode.d.ts contract the extension does it, the host guarantees
            // only the parent.
            globalStorageUri: Uri.file(storage.globalStoragePath),
            globalStoragePath: storage.globalStoragePath,
            storageUri: storage.storagePath === null ? undefined : Uri.file(storage.storagePath),
            storagePath: storage.storagePath ?? undefined,
            logUri: Uri.file(storage.logPath),
            logPath: storage.logPath,
            extension,
            environmentVariableCollection: environmentVariableCollections.get(id),
        };
        const active: ActivatedExtension = { id, mod: loaded, context };
        extensions.set(id, active);
        try {
            extensionExports.set(id, await loaded.activate(context));
        } catch (err) {
            extensions.delete(id);
            extensionExports.delete(id);
            // A non-`Error` rejection (golang.go without `go` rejects with bare `undefined`) is wrapped, like upstream
            // `ActivatedExtension._activate`, otherwise the host log shows an empty error.
            if (err instanceof Error) throw err;
            throw new Error(`activate() rejected with a non-Error value: ${String(err)}`, { cause: err });
        }
        return null;
    });

    rpc.handleRequest("host.deactivateExtension", async (params): Promise<null> => {
        const id = parseExtensionId(params);
        const active = extensions.get(id);
        if (active === undefined) return null;
        extensions.delete(id);
        extensionExports.delete(id);
        await deactivateExtension(active, logger);
        return null;
    });

    // Don't close the channel: the response goes out after the handler, a closed RPC would swallow it.
    // The parent (SIGTERM on response) or `disconnect` completes the exit.
    rpc.handleRequest("host.shutdown", async (): Promise<null> => {
        await deactivateAll();
        return null;
    });

    const shutdownOnce = (): void => {
        void deactivateAll().finally(() => {
            rpc.dispose();
            channel.dispose();
            process.exit(0);
        });
    };
    process.once("disconnect", shutdownOnce);
    process.once("SIGTERM", shutdownOnce);
    process.once("SIGINT", shutdownOnce);

    async function deactivateAll(): Promise<void> {
        const all = [...extensions.values()];
        extensions.clear();
        extensionExports.clear();
        for (const active of all) await deactivateExtension(active, logger);
    }

    rpc.notify("host.ready", null);
}

/** Upstream's `_isESM` rule (`abstractExtHostExtensionService`). */
export function isEsmEntry(mainPath: string, moduleType: string | undefined): boolean {
    if (mainPath.endsWith(".mjs")) return true;
    if (mainPath.endsWith(".cjs")) return false;
    return moduleType === "module";
}

/** `source` is compiled in memory: the bundle has no relative requires, so `filename` is synthetic. */
async function loadExtensionModule(spec: {
    mainPath: string | undefined;
    source: string | undefined;
    filename: string | undefined;
    moduleType: string | undefined;
}): Promise<ExtensionModule> {
    if (spec.source !== undefined && spec.filename !== undefined) {
        const ModuleCtor = Module as unknown as {
            new (
                id: string,
                parent: unknown,
            ): {
                filename: string;
                paths: string[];
                exports: unknown;
                _compile(content: string, filename: string): void;
            };
            _nodeModulePaths(from: string): string[];
        };
        const m = new ModuleCtor(spec.filename, null);
        m.filename = spec.filename;
        m.paths = ModuleCtor._nodeModulePaths(path.dirname(spec.filename));
        m._compile(spec.source, spec.filename);
        return m.exports as ExtensionModule;
    }
    if (spec.mainPath === undefined) throw new Error("Extension spec has neither inline source nor mainPath");
    if (isEsmEntry(spec.mainPath, spec.moduleType)) {
        return (await importModule(spec.mainPath)) as ExtensionModule;
    }
    const extRequire = createRequire(spec.mainPath);
    return extRequire(spec.mainPath) as ExtensionModule;
}

function parseActivateParams(raw: unknown): {
    id: string;
    mainPath: string | undefined;
    source: string | undefined;
    filename: string | undefined;
    moduleType: string | undefined;
    extensionPath: string | undefined;
    storage: { globalStoragePath: string; storagePath: string | null; logPath: string };
    memento: { globalState: Readonly<Record<string, unknown>>; workspaceState: Readonly<Record<string, unknown>> };
} {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("activateExtension: params must be an object");
    }
    const obj = raw as {
        id?: unknown;
        mainPath?: unknown;
        source?: unknown;
        filename?: unknown;
        moduleType?: unknown;
        extensionPath?: unknown;
        globalStoragePath?: unknown;
        storagePath?: unknown;
        logPath?: unknown;
        globalState?: unknown;
        workspaceState?: unknown;
    };
    if (typeof obj.id !== "string" || obj.id === "") {
        throw new Error("activateExtension: id must be a non-empty string");
    }
    const hasSource = typeof obj.source === "string" && obj.source !== "";
    const hasMain = typeof obj.mainPath === "string" && obj.mainPath !== "";
    if (hasSource === hasMain) {
        throw new Error("activateExtension: provide exactly one of mainPath or source");
    }
    if (hasSource && (typeof obj.filename !== "string" || obj.filename === "")) {
        throw new Error("activateExtension: source requires a non-empty filename");
    }
    // Not optional: without `globalStorageUri`/`logUri` an extension crashes on `.fsPath` in the first line of
    // activate().
    const globalStoragePath = requireNonEmptyString(obj.globalStoragePath, "globalStoragePath");
    const logPath = requireNonEmptyString(obj.logPath, "logPath");
    return {
        id: obj.id,
        mainPath: hasMain ? (obj.mainPath as string) : undefined,
        source: hasSource ? (obj.source as string) : undefined,
        filename: hasSource ? (obj.filename as string) : undefined,
        moduleType: typeof obj.moduleType === "string" ? obj.moduleType : undefined,
        extensionPath:
            typeof obj.extensionPath === "string" && obj.extensionPath !== "" ? obj.extensionPath : undefined,
        storage: {
            globalStoragePath,
            storagePath: typeof obj.storagePath === "string" && obj.storagePath !== "" ? obj.storagePath : null,
            logPath,
        },
        memento: {
            globalState: parseWireMementoValue(obj.globalState),
            workspaceState: parseWireMementoValue(obj.workspaceState),
        },
    };
}

function requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value === "") {
        throw new Error(`activateExtension: ${field} must be a non-empty string`);
    }
    return value;
}

function parseExtensionId(raw: unknown): string {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("deactivateExtension: params must be an object");
    }
    const obj = raw as { id?: unknown };
    if (typeof obj.id !== "string" || obj.id === "") {
        throw new Error("deactivateExtension: id must be a non-empty string");
    }
    return obj.id;
}

const VSCODE_GLOBAL_KEY = Symbol.for(VSCODE_GLOBAL_KEY_NAME);

/**
 * Virtual `"vscode"` module per importer: a module under an extension root gets that extension's overlay.
 * CJS via patching `Module._resolveFilename`, ESM via `registerHooks`: the CJS cache isn't visible
 * to the ESM loader, upstream keeps both mechanisms for the same reason.
 */
function installVscodeStub(
    rpc: SubprocessRpc,
    logger: ILogger,
): IDisposable & {
    configStore: WorkspaceConfigStore;
    extensionExports: Map<string, unknown>;
    secrets: IExtensionSecretsFactory;
    environmentVariableCollections: ExtHostEnvironmentVariableCollections;
    paths: ExtensionPaths;
    extensions: typeof vscode.extensions;
} {
    const host = buildVscodeNamespace(rpc, createNodeExtHostDisk());
    const { configStore, extensionExports, secrets, environmentVariableCollections } = host;
    // Shared namespace: the overlay doesn't override `extensions`.
    const extensions = host.namespace.extensions;
    const paths = new ExtensionPaths({ realpath: fs.realpathSync.native });
    // Roots come from the host's catalog, to recognize `require("vscode")` before its extension's `activate()`.
    const catalogSubscription = host.onDidReceiveCatalog((catalog) => {
        for (const description of catalog) paths.add(description.extensionPath, description.id);
    });
    const api = new ExtensionApiFactory({
        shared: host.namespace,
        owner: host.owner,
        paths,
        warn: (message) => {
            logger.warn(message);
        },
    });
    const moduleAny = Module as unknown as {
        _cache: Record<string, { exports: unknown; loaded: boolean; id: string; filename: string }>;
        _resolveFilename: (request: string, parent: unknown, ...rest: unknown[]) => string;
    };

    const cacheKeys = new Set<string>();
    const origResolve = moduleAny._resolveFilename;
    moduleAny._resolveFilename = function (request: string, parent: unknown, ...rest: unknown[]): string {
        if (request !== "vscode") return origResolve.call(this, request, parent, ...rest);
        const { key, exports } = api.cjsModule((parent as { filename?: string } | null | undefined)?.filename);
        if (!cacheKeys.has(key)) {
            cacheKeys.add(key);
            moduleAny._cache[key] = { id: key, filename: key, loaded: true, exports };
        }
        return key;
    };

    // The generated ESM module takes the API from globalThis: it can't be passed into source via a closure.
    (globalThis as unknown as Record<symbol, unknown>)[VSCODE_GLOBAL_KEY] = api.lookup;
    const hooks = registerHooks({
        resolve: (specifier, context, nextResolve) =>
            specifier === "vscode"
                ? { url: api.esmUrl(context.parentURL), shortCircuit: true }
                : nextResolve(specifier, context),
        load: (url, context, nextLoad) => {
            const source = api.esmSource(url);
            return source === undefined ? nextLoad(url, context) : { format: "module", source, shortCircuit: true };
        },
    });

    return {
        configStore,
        extensionExports,
        secrets,
        environmentVariableCollections,
        paths,
        extensions,
        dispose: (): void => {
            hooks.deregister();
            catalogSubscription.dispose();
            Reflect.deleteProperty(globalThis as unknown as Record<symbol, unknown>, VSCODE_GLOBAL_KEY);
            moduleAny._resolveFilename = origResolve;
            for (const key of cacheKeys) Reflect.deleteProperty(moduleAny._cache, key);
        },
    };
}

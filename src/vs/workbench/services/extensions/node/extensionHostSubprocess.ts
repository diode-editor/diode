import { createRequire, Module } from "node:module";
import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";
import type { IIpcEndpoint } from "../../../api/common/ipcMessageChannel.ts";
import { IpcMessageChannel } from "../../../api/common/ipcMessageChannel.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import { buildVscodeNamespace } from "../../../api/common/vscodeNamespace.ts";
import type { WorkspaceConfigStore } from "../../../api/common/workspaceConfigStore.ts";

/**
 * Сообщения protocol host -> subprocess. RPC-методы:
 *
 * - `host.activateExtension({ id, mainPath, configDefaults? })` -> `null`.
 *   Кладёт `configDefaults` (дефолты `contributes.configuration`) в config store,
 *   загружает CJS-модуль через `createRequire`, вызывает `module.activate(context)`.
 *   Бросает на ошибках загрузки/активации.
 * - `host.deactivateExtension({ id })` -> `null`. Вызывает `deactivate()` +
 *   disposes `context.subscriptions`. Idempotent.
 * - `host.shutdown()` -> `null`. Снимает все расширения и инициирует exit.
 *
 * Subprocess -> host RPC:
 *   `editor.setOptions`, `editor.getOptions` (см. `buildVscodeNamespace`).
 */

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
}

/**
 * Точка входа в subprocess extension host'а. Вызывается из `main.ts` при
 * обнаружении env-флага `VEXX_EXTENSION_HOST=1`. НИКОГДА не возвращает в
 * нормальном режиме — процесс живёт до `host.shutdown` или `disconnect`.
 */
export function runExtensionHostSubprocess(): void {
    if (typeof process.send !== "function") {
        // Без IPC-канала смысла нет. Завершаемся, чтобы не висеть мёртвым.

        console.error("[ext-host] subprocess started without IPC channel; exiting");
        process.exit(2);
    }

    // Расширение, забывшее поймать свой промис, не должно убивать extension host.
    // Реальный кейс (#194): maptz.regionfolder после wrapWithRegion делает
    // fire-and-forget `executeCommand("editor.action.formatDocument")`; такой
    // команды у нас нет, RPC отклоняется — и без этого гарда Node роняет
    // субпроцесс, унося с собой ВСЕ расширения (в т.ч. только что отработавший
    // folding-провайдер). Логируем в stderr — host зеркалит его в свой лог-канал.
    process.on("unhandledRejection", (reason: unknown) => {
        console.error(`[ext-host] unhandled rejection in extension code: ${String(reason)}`);
    });

    const channel = new IpcMessageChannel(process as unknown as IIpcEndpoint);
    const rpc = new RpcEndpoint(channel);

    const { configStore } = installVscodeStub(rpc);

    const extensions = new Map<string, ActivatedExtension>();

    rpc.handleRequest("host.activateExtension", async (params): Promise<unknown> => {
        const { id, mainPath, source, filename, configDefaults } = parseActivateParams(params);
        if (extensions.has(id)) {
            throw new Error(`Extension "${id}" already activated`);
        }
        // Дефолты из `contributes.configuration` — под пользовательским снапшотом,
        // должны быть доступны через getConfiguration ДО activate().
        configStore.applyDefaults(configDefaults);
        const loaded = loadExtensionModule({ mainPath, source, filename });
        if (typeof loaded.activate !== "function") {
            throw new Error(`Extension "${id}" has no activate() in ${filename ?? mainPath}`);
        }
        const context: ExtensionContext = { subscriptions: [] };
        const active: ActivatedExtension = { id, mod: loaded, context };
        extensions.set(id, active);
        try {
            await loaded.activate(context);
        } catch (err) {
            extensions.delete(id);
            throw err;
        }
        return null;
    });

    rpc.handleRequest("host.deactivateExtension", async (params): Promise<unknown> => {
        const id = parseExtensionId(params);
        const active = extensions.get(id);
        if (active === undefined) return null;
        extensions.delete(id);
        await deactivate(active);
        return null;
    });

    rpc.handleRequest("host.shutdown", async (): Promise<unknown> => {
        await shutdown();
        return null;
    });

    const shutdownOnce = (): void => {
        void shutdown().finally(() => process.exit(0));
    };
    process.once("disconnect", shutdownOnce);
    process.once("SIGTERM", shutdownOnce);
    process.once("SIGINT", shutdownOnce);

    async function shutdown(): Promise<void> {
        const all = [...extensions.values()];
        extensions.clear();
        for (const active of all) {
            try {
                await deactivate(active);
            } catch {
                // глотаем — мы уже завершаемся
            }
        }
        rpc.dispose();
        channel.dispose();
    }

    // Сигнал готовности parent'у: можно слать activateExtension.
    rpc.notify("host.ready", null);
}

async function deactivate(active: ActivatedExtension): Promise<void> {
    try {
        await active.mod.deactivate?.();
    } finally {
        for (const sub of active.context.subscriptions.splice(0).reverse()) {
            try {
                sub.dispose();
            } catch {
                // глотаем
            }
        }
    }
}

/**
 * Загружает CJS-модуль расширения одним из двух способов:
 *  - `mainPath` → `createRequire(mainPath)` (файл на ФС subprocess'а);
 *  - `source` (+`filename`) → `Module._compile` в памяти (скомпилированный builtin;
 *    `require("vscode")` внутри резолвится через `installVscodeStub`, node:builtins —
 *    штатно; относительных require в бандле нет, поэтому `filename` синтетический).
 */
function loadExtensionModule(spec: {
    mainPath: string | undefined;
    source: string | undefined;
    filename: string | undefined;
}): ExtensionModule {
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
    const extRequire = createRequire(spec.mainPath);
    return extRequire(spec.mainPath) as ExtensionModule;
}

function parseActivateParams(raw: unknown): {
    id: string;
    mainPath: string | undefined;
    source: string | undefined;
    filename: string | undefined;
    configDefaults: Record<string, unknown> | undefined;
} {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("activateExtension: params must be an object");
    }
    const obj = raw as {
        id?: unknown;
        mainPath?: unknown;
        source?: unknown;
        filename?: unknown;
        configDefaults?: unknown;
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
    const configDefaults =
        typeof obj.configDefaults === "object" && obj.configDefaults !== null
            ? (obj.configDefaults as Record<string, unknown>)
            : undefined;
    return {
        id: obj.id,
        mainPath: hasMain ? (obj.mainPath as string) : undefined,
        source: hasSource ? (obj.source as string) : undefined,
        filename: hasSource ? (obj.filename as string) : undefined,
        configDefaults,
    };
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

/**
 * Регистрирует виртуальный модуль `"vscode"` в кэше Node CJS-loader'а, чтобы
 * `require("vscode")` внутри расширения возвращал host-backed namespace.
 *
 * Используем приватные API `Module._cache` и `Module._resolveFilename` —
 * стандартный приём расширений Node и оригинальный приём VS Code.
 */
function installVscodeStub(rpc: RpcEndpoint): IDisposable & { configStore: WorkspaceConfigStore } {
    const { namespace, configStore } = buildVscodeNamespace(rpc);
    const moduleAny = Module as unknown as {
        _cache: Record<string, { exports: unknown; loaded: boolean; id: string; filename: string }>;
        _resolveFilename: (request: string, parent: unknown, ...rest: unknown[]) => string;
    };

    const cacheKey = "vscode";
    moduleAny._cache[cacheKey] = {
        id: cacheKey,
        filename: cacheKey,
        loaded: true,
        exports: namespace,
    };

    const origResolve = moduleAny._resolveFilename;
    moduleAny._resolveFilename = function (request: string, parent: unknown, ...rest: unknown[]): string {
        if (request === "vscode") return cacheKey;
        return origResolve.call(this, request, parent, ...rest);
    };

    return {
        configStore,
        dispose: (): void => {
            moduleAny._resolveFilename = origResolve;
            Reflect.deleteProperty(moduleAny._cache, cacheKey);
        },
    };
}

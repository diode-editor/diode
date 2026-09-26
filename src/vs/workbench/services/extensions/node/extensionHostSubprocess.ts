import { createRequire, Module } from "node:module";
import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";

import type { IIpcEndpoint } from "../../../api/common/ipcMessageChannel.ts";
import { IpcMessageChannel } from "../../../api/common/ipcMessageChannel.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import { buildVscodeNamespace } from "../../../api/common/vscodeNamespace.ts";
import { ExtensionMode, Uri } from "../../../api/common/vscodeTypes.ts";
import type { WorkspaceConfigStore } from "../../../api/common/workspaceConfigStore.ts";

import { createExtensionMemento, type IExtensionMemento } from "./extensionMemento.ts";

/**
 * Сообщения protocol host -> subprocess. RPC-методы:
 *
 * - `host.activateExtension({ id, mainPath, extensionPath?, configDefaults?,
 *   globalStoragePath?, storagePath?, logPath? })` -> `null`.
 *   Кладёт `configDefaults` (дефолты `contributes.configuration`) в config store,
 *   загружает CJS-модуль через `createRequire`, вызывает `module.activate(context)`.
 *   Бросает на ошибках загрузки/активации. Каталоги хранения приходят ОТ ХОСТА
 *   (он владеет раскладкой user-data) — субпроцесс их не выдумывает и не создаёт.
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
    readonly extensionPath: string;
    readonly extensionUri: Uri;
    readonly extensionMode: ExtensionMode;
    readonly globalState: IExtensionMemento;
    readonly workspaceState: IExtensionMemento;
    asAbsolutePath(relativePath: string): string;
    readonly globalStorageUri: Uri;
    readonly globalStoragePath: string;
    /** `undefined` — папка/воркспейс не открыт (семантика vscode). */
    readonly storageUri: Uri | undefined;
    readonly storagePath: string | undefined;
    readonly logUri: Uri;
    readonly logPath: string;
}

/**
 * Точка входа в subprocess extension host'а. Вызывается из `main.ts` при
 * обнаружении env-флага `DIODE_EXTENSION_HOST=1`. НИКОГДА не возвращает в
 * нормальном режиме — процесс живёт до `host.shutdown` или `disconnect`.
 */
export function runExtensionHostSubprocess(): void {
    if (typeof process.send !== "function") {
        // Без IPC-канала смысла нет. Завершаемся, чтобы не висеть мёртвым.

        console.error("[ext-host] subprocess started without IPC channel; exiting");
        process.exit(2);
    }

    // Дети этого процесса — НЕ extension host'ы. Сторонние расширения спавнят
    // `process.execPath` в обход наших резолверов (`cp.fork` внутри
    // vscode-languageclient при `TransportKind.ipc` — путь basedpyright); под SEA
    // execPath — сам diode-бинарь, и унаследованный `DIODE_EXTENSION_HOST` увёл бы
    // ребёнка в ext-host-ветку (exit 2 без IPC-регистрации). Свой флаг мы уже
    // прочитали (иначе не были бы здесь) — снимаем его из наследуемого окружения
    // и включаем node-режим: `main.ts` проверяет `DIODE_RUN_AS_NODE` ПЕРВЫМ,
    // поэтому любой форк diode-бинаря отсюда работает как node (runAsNode.ts);
    // в dev execPath — настоящий node, и флаг безвреден.
    delete process.env.DIODE_EXTENSION_HOST;
    process.env.DIODE_RUN_AS_NODE = "1";

    // Расширение, забывшее поймать свой промис, не должно убивать extension host.
    // Реальный кейс (#194): maptz.regionfolder после wrapWithRegion делает
    // fire-and-forget `executeCommand("editor.action.formatDocument")`; такой
    // команды у нас нет, RPC отклоняется — и без этого гарда Node роняет
    // субпроцесс, унося с собой ВСЕ расширения (в т.ч. только что отработавший
    // folding-провайдер). Логируем в stderr — host зеркалит его в свой лог-канал.
    process.on("unhandledRejection", (reason: unknown) => {
        console.error(`[ext-host] unhandled rejection in extension code: ${describeRejection(reason)}`);
    });

    const channel = new IpcMessageChannel(process as unknown as IIpcEndpoint);
    const rpc = new RpcEndpoint(channel);

    const { configStore } = installVscodeStub(rpc);

    const extensions = new Map<string, ActivatedExtension>();

    rpc.handleRequest("host.activateExtension", async (params): Promise<unknown> => {
        const { id, mainPath, source, filename, extensionPath, configDefaults, storage } = parseActivateParams(params);
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
        // Корень расширения: для user-vsix приходит от host'а (каталог установки);
        // builtin'ы из in-memory source его не имеют — берём каталог filename
        // (синтетический путь): asAbsolutePath у них указывает «в бандл», честнее
        // фиктивного, а сравнение extensionMode работает всегда.
        /* v8 ignore next -- одно из двух есть всегда: без mainPath и без filename расширение не загрузилось бы выше */
        const rootPath = extensionPath ?? path.dirname(mainPath ?? filename ?? "");
        const context: ExtensionContext = {
            subscriptions: [],
            extensionPath: rootPath,
            extensionUri: Uri.file(rootPath),
            extensionMode: ExtensionMode.Production,
            // In-memory memento (setKeysForSync — только у globalState, как в
            // vscode API); без него activate() ruff падал на globalState.get.
            globalState: createExtensionMemento(true),
            workspaceState: createExtensionMemento(false),
            asAbsolutePath: (relativePath: string): string => path.join(rootPath, relativePath),
            // Приватные каталоги расширения. `storageUri` отсутствует, когда папка
            // не открыта — так же, как в vscode (`workspaceValue` там возвращает
            // undefined без воркспейса). Сами каталоги НЕ создаём: по контракту
            // vscode.d.ts это делает расширение, хост гарантирует только родителя.
            globalStorageUri: Uri.file(storage.globalStoragePath),
            globalStoragePath: storage.globalStoragePath,
            storageUri: storage.storagePath === null ? undefined : Uri.file(storage.storagePath),
            storagePath: storage.storagePath ?? undefined,
            logUri: Uri.file(storage.logPath),
            logPath: storage.logPath,
        };
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

/**
 * Человекочитаемое описание причины unhandled rejection. `String(err)` на Error
 * даёт только «Error: message» — по такой строке не найти ни виноватое
 * расширение, ни строку кода. Стек называет и то, и другое; у не-Error причин
 * (строка, объект) стека нет — их печатаем как есть.
 */
function describeRejection(reason: unknown): string {
    if (reason instanceof Error) return reason.stack ?? `${reason.name}: ${reason.message}`;
    return String(reason);
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
    extensionPath: string | undefined;
    configDefaults: Record<string, unknown> | undefined;
    storage: { globalStoragePath: string; storagePath: string | null; logPath: string };
} {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("activateExtension: params must be an object");
    }
    const obj = raw as {
        id?: unknown;
        mainPath?: unknown;
        source?: unknown;
        filename?: unknown;
        extensionPath?: unknown;
        configDefaults?: unknown;
        globalStoragePath?: unknown;
        storagePath?: unknown;
        logPath?: unknown;
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
    // `globalStorageUri`/`logUri` в API необязательными не бывают — без них
    // расширение падает на `.fsPath` в первой же строке activate(). Поэтому это
    // не опциональные поля протокола, а требование: не приехали — виноват хост.
    const globalStoragePath = requireNonEmptyString(obj.globalStoragePath, "globalStoragePath");
    const logPath = requireNonEmptyString(obj.logPath, "logPath");
    return {
        id: obj.id,
        mainPath: hasMain ? (obj.mainPath as string) : undefined,
        source: hasSource ? (obj.source as string) : undefined,
        filename: hasSource ? (obj.filename as string) : undefined,
        extensionPath:
            typeof obj.extensionPath === "string" && obj.extensionPath !== "" ? obj.extensionPath : undefined,
        configDefaults,
        storage: {
            globalStoragePath,
            // Отсутствие и `null` — одно и то же: папка не открыта.
            storagePath: typeof obj.storagePath === "string" && obj.storagePath !== "" ? obj.storagePath : null,
            logPath,
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

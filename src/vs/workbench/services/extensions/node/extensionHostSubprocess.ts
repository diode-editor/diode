import * as dns from "node:dns";
import * as fs from "node:fs";
import { createRequire, Module, registerHooks } from "node:module";
import * as path from "node:path";

import { describeRejection } from "../../../../base/common/describeRejection.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { importModule } from "../../../../base/node/importModule.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
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

/**
 * Сообщения protocol host -> subprocess. RPC-методы:
 *
 * - `host.activateExtension({ id, mainPath, moduleType?, extensionPath?,
 *   globalStoragePath?, storagePath?, logPath? })` -> `null`.
 *   Загружает модуль (CJS или ESM — см. `loadExtensionModule`; `moduleType` —
 *   это `"type"` из `package.json` расширения), вызывает `module.activate(context)`.
 *   Бросает на ошибках загрузки/активации. Каталоги хранения приходят ОТ ХОСТА
 *   (он владеет раскладкой user-data) — субпроцесс их не выдумывает и не создаёт.
 * - `host.deactivateExtension({ id })` -> `null`. Вызывает `deactivate()` +
 *   disposes `context.subscriptions`. Idempotent. Сбой уборки не бросается —
 *   warn с id расширения в stderr (`extensionDeactivation.ts`).
 * - `host.shutdown()` -> `null`. Снимает все расширения (`deactivate()`); выход
 *   доводит родитель сигналом сразу по ответу.
 * - `extensions.catalog` / `extensions.activated` (уведомления) — состав
 *   установленных расширений и их активность для `vscode.extensions`.
 * - `secrets.changed` (уведомление) — `SecretStorage.onDidChange`.
 *
 * Subprocess -> host RPC:
 *   `editor.setOptions`, `editor.getOptions`, `secrets.*` (см.
 *   `buildVscodeNamespace`).
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
    /** `ExtensionContext.secrets` — хранилище на хосте (`extensionSecrets.ts`). */
    readonly secrets: ReturnType<IExtensionSecretsFactory["create"]>;
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

    // `localhost` → 127.0.0.1 первым, как у extension host'а VS Code
    // (`--dns-result-order=ipv4first` в execArgv форка, localProcessExtensionHost.ts
    // и server/node/extensionHostConnection.ts, issue #189805). С дефолтным
    // `verbatim` Node отдаёт `::1` там, где /etc/hosts ставит его выше, и
    // TCP-сервер расширения, слушающий `localhost`, встаёт на IPv6 — а его же
    // языковой сервер на Java открывает `Socket("localhost", port)`, JVM берёт
    // первым 127.0.0.1 и получает «Connection refused» (так bazel-java терял лог
    // синхронизации). Функцией, а не флагом процесса: под SEA execArgv бинаря не
    // наш (прецедент эталона — cliProcessMain.ts). Отступление: дети субпроцесса
    // (`cp.fork` из расширения) порядок не наследуют, в VS Code он уезжает с execArgv.
    dns.setDefaultResultOrder("ipv4first");

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
    // Пойманные кодом непредвиденные ошибки (исключение слушателя Emitter) —
    // тем же путём, с префиксом, по которому host узнаёт свои строки.
    setUnexpectedErrorHandler((e: unknown) => {
        console.error(`[ext-host] unexpected error: ${describeRejection(e)}`);
    });

    const channel = new IpcMessageChannel(process as unknown as IIpcEndpoint);
    // Логгер — в stderr: сбой обработчика запроса (провайдер расширения упал)
    // и запрос без обработчика видны в канале `extensions.host.stderr`.
    const logger = createStderrLogger();
    const rpc: SubprocessRpc = new RpcEndpoint(channel, logger);

    const { configStore, extensionExports, secrets, paths } = installVscodeStub(rpc, logger);

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
        // Корень расширения — общее правило обеих сторон RPC (тот же путь хост
        // кладёт в `Extension.extensionPath` каталога `vscode.extensions`). В
        // индекс — ДО загрузки: `require("vscode")` верхнего уровня модуля
        // должен уже знать, чьё оно.
        const rootPath = extensionRootPath({ extensionPath, mainPath, filename });
        paths.add(rootPath, id);
        const loaded = await loadExtensionModule({ mainPath, source, filename, moduleType });
        if (typeof loaded.activate !== "function") {
            throw new Error(`Extension "${id}" has no activate() in ${filename ?? mainPath}`);
        }
        const context: ExtensionContext = {
            subscriptions: [],
            extensionPath: rootPath,
            extensionUri: Uri.file(rootPath),
            extensionMode: ExtensionMode.Production,
            // Memento: словарь здесь (синхронные get/keys), хранилище — на хосте,
            // переживает перезапуск. setKeysForSync — только у globalState, как в
            // vscode API.
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
            // Секреты — тоже на хосте, но отдельным файлом 0600. Лоток
            // адресуется id расширения.
            secrets: secrets.create(id),
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
            // Возвращённое значение — публичный API расширения
            // (`extensions.getExtension(id).exports`); больше его взять негде.
            extensionExports.set(id, await loaded.activate(context));
        } catch (err) {
            extensions.delete(id);
            extensionExports.delete(id);
            throw err;
        }
        return null;
    });

    rpc.handleRequest("host.deactivateExtension", async (params): Promise<null> => {
        const id = parseExtensionId(params);
        const active = extensions.get(id);
        if (active === undefined) return null;
        extensions.delete(id);
        // Снятое расширение больше не активно — его `exports` невалидны.
        extensionExports.delete(id);
        await deactivateExtension(active, logger);
        return null;
    });

    // Канал здесь не закрываем: ответ на запрос уходит ПОСЛЕ обработчика, и
    // закрытый RPC его бы проглотил — родитель ждал бы свой тайм-аут впустую.
    // Выход доводит родитель (SIGTERM сразу по ответу) или `disconnect`.
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
        // Сбои уборки (с id расширения) пишет в stderr сам deactivateExtension
        // и наружу не бросает — одно упавшее расширение не мешает остальным.
        for (const active of all) await deactivateExtension(active, logger);
    }

    // Сигнал готовности parent'у: можно слать activateExtension.
    rpc.notify("host.ready", null);
}

/**
 * ESM ли точка входа расширения — правило эталона (`_isESM` в
 * `abstractExtHostExtensionService`): `.mjs` всегда модуль, `.cjs` всегда CJS, в
 * остальных случаях решает `"type"` из `package.json` расширения.
 */
export function isEsmEntry(mainPath: string, moduleType: string | undefined): boolean {
    if (mainPath.endsWith(".mjs")) return true;
    if (mainPath.endsWith(".cjs")) return false;
    return moduleType === "module";
}

/**
 * Загружает модуль расширения одним из трёх способов:
 *  - `mainPath` + CJS → `createRequire(mainPath)` (файл на ФС subprocess'а);
 *  - `mainPath` + ESM ({@link isEsmEntry}) → `importModule` (настоящий
 *    ESM-loader; `import … from "vscode"` резолвится ESM-хуком из
 *    `installVscodeStub`). Такие расширения уже в ходу: `esbenp.prettier-vscode`
 *    с 12.x — `"type": "module"`, и CJS-веткой он падал на
 *    `ERR_MODULE_NOT_FOUND: Cannot find package 'vscode'`;
 *  - `source` (+`filename`) → `Module._compile` в памяти (скомпилированный builtin;
 *    `require("vscode")` внутри резолвится через `installVscodeStub`, node:builtins —
 *    штатно; относительных require в бандле нет, поэтому `filename` синтетический).
 */
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
        moduleType: typeof obj.moduleType === "string" ? obj.moduleType : undefined,
        extensionPath:
            typeof obj.extensionPath === "string" && obj.extensionPath !== "" ? obj.extensionPath : undefined,
        storage: {
            globalStoragePath,
            // Отсутствие и `null` — одно и то же: папка не открыта.
            storagePath: typeof obj.storagePath === "string" && obj.storagePath !== "" ? obj.storagePath : null,
            logPath,
        },
        // Нет сохранённого memento (или хост старше) — расширение начинает с пустого.
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

/** Ключ, под которым ESM-шим достаёт API из `globalThis`. */
const VSCODE_GLOBAL_KEY = Symbol.for(VSCODE_GLOBAL_KEY_NAME);

/**
 * Регистрирует виртуальный модуль `"vscode"` для ОБОИХ loader'ов Node — и
 * раздаёт его ПО ИМПОРТЁРУ: модуль внутри корня расширения получает оверлей
 * этого расширения (`extensionApiFactory.ts`), чужой — общий namespace.
 *
 * - CJS: патч `Module._resolveFilename` отдаёт `vscode:<id>` по
 *   `parent.filename` и лениво кладёт под этот ключ в `Module._cache` API
 *   расширения. Приватные API — приём расширений Node и оригинальный приём VS Code;
 * - ESM (и `require` на Node с `module.registerHooks`: синхронные хуки видят оба
 *   loader'а): `resolve` отдаёт `diode-vscode:api/<id>` по `context.parentURL`,
 *   `load` — сгенерированный модуль с именованными export'ами этого API
 *   (`buildVscodeEsmShim`). Без хуков ESM-ветка падает на
 *   `ERR_MODULE_NOT_FOUND`: CJS-кэш ESM-loader'у не виден. Эталон держит ровно
 *   эти два механизма рядом по той же причине.
 *
 * Вся логика опознания — в покрытых модулях `api/common` (`ExtensionPaths`,
 * `ExtensionApiFactory`); здесь только проводка.
 */
function installVscodeStub(
    rpc: SubprocessRpc,
    logger: ILogger,
): IDisposable & {
    configStore: WorkspaceConfigStore;
    extensionExports: Map<string, unknown>;
    secrets: IExtensionSecretsFactory;
    paths: ExtensionPaths;
} {
    const host = buildVscodeNamespace(rpc, createNodeExtHostDisk());
    const { configStore, extensionExports, secrets } = host;
    const paths = new ExtensionPaths({ realpath: fs.realpathSync.native });
    // Корни расширений — из каталога хоста (семя ДО первой активации), чтобы
    // опознать и `require("vscode")` раньше `activate()` своего расширения.
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

    // ESM-ветка: сгенерированный модуль берёт API из globalThis — через
    // замыкание его в исходник не передать.
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
        paths,
        dispose: (): void => {
            hooks.deregister();
            catalogSubscription.dispose();
            Reflect.deleteProperty(globalThis as unknown as Record<symbol, unknown>, VSCODE_GLOBAL_KEY);
            moduleAny._resolveFilename = origResolve;
            for (const key of cacheKeys) Reflect.deleteProperty(moduleAny._cache, key);
        },
    };
}

import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../base/common/event.ts";
import { isFileNotFound } from "../../../base/node/fsErrors.ts";
import { type IUserDataPaths, resolveWorkspaceStatePath } from "../../environment/node/userDataPaths.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";
import { EMPTY_WINDOW_WORKSPACE_ID } from "../../workspace/common/workspaceId.ts";
import type { IStateDescriptor, IStateService, IStateStore, StateScope } from "../common/iStateService.ts";

/**
 * Реализация {@link IStateService}. Движок key/value со scope, поверх plain-JSON
 * файлов (не jsonc — файл машинный, комментарии не нужны; см. docs/arch/State.md).
 *
 * Инварианты:
 *  - `store` обновляет in-memory стор **синхронно**, запись на диск — debounced
 *    (async), плюс `flushSync` на выходе процесса. Так `get` всегда видит
 *    последнее значение, а `process.on("exit")` гарантирует durability.
 *  - весь распарсенный объект хранится целиком: правим только известные ключи,
 *    сериализуем объект целиком → unknown-ключи (от других/будущих версий) не
 *    затираются.
 *  - битый/нечитаемый файл трактуется как пустой стор + лог — bootstrap не падает.
 */

const VERSIONS_KEY = "$versions";
export const WRITE_DEBOUNCE_MS = 500;

/**
 * Один plain-JSON файл состояния — стор одной области видимости. Сам читает
 * файл, сам пишет (debounce + `flushSync`), версии ключей ведёт как
 * {@link StateService}. Наружу отдаётся как {@link IStateStore}: сервису,
 * которому нужна ровно одна область и раньше, чем собран весь
 * {@link StateService}. Так устроен application-стор: реестр профилей читается
 * до того, как известен каталог активного профиля (а с ним — `global` и
 * `workspace` сторы), и тот же экземпляр потом усыновляет `StateService`
 * ({@link loadState}) — писатель у файла один.
 *
 * Без `filePath` стор живёт только в памяти (тесты, null-окружение).
 */
export class StateFileStore implements IStateStore {
    /** Полное дерево из файла: известные ключи + `$versions` + unknown-ключи. */
    private data: Record<string, unknown>;
    private filePath: string | undefined;
    private dirty = false;
    private writeTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private readonly logger: ILogger;
    private readonly writeDebounceMs: number;

    public constructor(
        filePath: string | undefined,
        options: {
            readonly logger?: ILogger;
            /** Задержка debounced-записи; по умолчанию {@link WRITE_DEBOUNCE_MS}. Инъекция — ради тестов. */
            readonly writeDebounceMs?: number;
        } = {},
    ) {
        this.logger = options.logger ?? NULL_LOGGER;
        this.writeDebounceMs = options.writeDebounceMs ?? WRITE_DEBOUNCE_MS;
        this.filePath = filePath;
        this.data = filePath === undefined ? {} : loadStateFile(filePath, this.logger);
    }

    public get<T>(descriptor: IStateDescriptor<T>): T {
        const raw = this.data[descriptor.key];
        if (raw === undefined) return clone(descriptor.default);

        if (descriptor.version !== undefined && descriptor.migrate) {
            const versions = asRecord(this.data[VERSIONS_KEY]);
            const stored = versions[descriptor.key];
            const from = typeof stored === "number" ? stored : 0;
            if (from !== descriptor.version) {
                return descriptor.migrate(clone(raw), from);
            }
        }
        return clone(raw) as T;
    }

    public store<T>(descriptor: IStateDescriptor<T>, value: T): void {
        this.data[descriptor.key] = clone(value);
        if (descriptor.version !== undefined) {
            const versions = asRecord(this.data[VERSIONS_KEY]);
            versions[descriptor.key] = descriptor.version;
            this.data[VERSIONS_KEY] = versions;
        }
        this.markDirty();
    }

    public remove<T>(descriptor: IStateDescriptor<T>): void {
        Reflect.deleteProperty(this.data, descriptor.key);
        const versions = asRecord(this.data[VERSIONS_KEY]);
        if (Reflect.deleteProperty(versions, descriptor.key) && Object.keys(versions).length === 0) {
            Reflect.deleteProperty(this.data, VERSIONS_KEY);
        }
        this.markDirty();
    }

    /**
     * Переключает стор на другой файл (стор воркспейса следует за открытым
     * проектом): текущее содержимое сначала синхронно сбрасывается на диск, а
     * отложенная запись снимается — она была про прежний файл.
     */
    public open(filePath: string): void {
        this.flushSync();
        this.data = loadStateFile(filePath, this.logger);
        this.filePath = filePath;
        this.dirty = false;
    }

    /** Синхронно пишет файл, если стор грязный. Безопасно из `process.on("exit")`. */
    public flushSync(): void {
        // Stryker disable next-line CallExpression: неснятый таймер нашёл бы стор уже чистым и ничего не записал — эквивалентный мутант
        clearTimeout(this.writeTimer);
        this.writeTimer = undefined;
        this.writeSync();
    }

    /** Глушит писателя: снимает отложенную запись и больше её не взводит (см. {@link StateService.dispose}). */
    public dispose(): void {
        this.disposed = true;
        clearTimeout(this.writeTimer);
        this.writeTimer = undefined;
    }

    private markDirty(): void {
        this.dirty = true;
        const filePath = this.filePath;
        if (this.disposed || filePath === undefined || this.writeTimer !== undefined) return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            void this.writeAsync(filePath);
        }, this.writeDebounceMs);
        // Запись состояния не должна держать event loop живым.
        // Stryker disable next-line CallExpression: держит ли таймер event loop, из теста не видно — только у процесса целиком
        this.writeTimer.unref();
    }

    /**
     * Отложенная запись по таймеру. Таймер взводится только у грязного стора с
     * файлом и снимается всем, что пишет или глушит стор (`flushSync`, `open`,
     * `dispose`), так что сюда приходит грязный стор с тем же файлом.
     */
    private async writeAsync(filePath: string): Promise<void> {
        this.dirty = false;
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            // Stryker disable next-line StringLiteral: пустая кодировка у writeFile — та же utf-8 по умолчанию
            await fs.promises.writeFile(filePath, serialize(this.data), "utf-8");
        } catch (err) {
            this.dirty = true; // не удалось — повторим на следующем flush
            this.logger.error(`Failed to write state file ${filePath}`, err);
        }
    }

    private writeSync(): void {
        if (!this.dirty || this.filePath === undefined) return;
        this.dirty = false;
        const filePath = this.filePath;
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            // Stryker disable next-line StringLiteral: пустая кодировка у writeFileSync — та же utf-8 по умолчанию
            fs.writeFileSync(filePath, serialize(this.data), "utf-8");
        } catch (err) {
            this.dirty = true;
            this.logger.error(`Failed to write state file ${filePath}`, err);
        }
    }
}

export class StateService implements IStateService {
    private readonly application: StateFileStore;
    private readonly global: StateFileStore;
    private readonly workspace: StateFileStore;
    private readonly workspaceStorageDir: string;
    private readonly onDidOpenWorkspaceEmitter = new Emitter<WorkspaceId>();
    public readonly onDidOpenWorkspace = this.onDidOpenWorkspaceEmitter.event;

    public constructor(input: {
        /**
         * Application-стор (`User/globalStorage/storage.json`): готовый экземпляр,
         * если его уже читали до сборки сервиса (реестр профилей, см.
         * {@link StateFileStore}), либо путь к файлу. Нет ни того, ни другого —
         * стор только в памяти (тесты).
         */
        readonly application?: StateFileStore | string;
        readonly globalStateFile: string;
        readonly workspaceStorageDir: string;
        readonly logger?: ILogger;
        /** Задержка debounced-записи; по умолчанию {@link WRITE_DEBOUNCE_MS}. Инъекция — ради тестов. */
        readonly writeDebounceMs?: number;
    }) {
        const options = { logger: input.logger, writeDebounceMs: input.writeDebounceMs };
        this.workspaceStorageDir = input.workspaceStorageDir;
        this.application =
            input.application instanceof StateFileStore
                ? input.application
                : new StateFileStore(input.application, options);
        this.global = new StateFileStore(input.globalStateFile, options);
        // Пока проект не открыт, workspace-скоуп — стор пустого окна, а не global:
        // ключи пустого окна не смешиваются с глобальными.
        this.workspace = new StateFileStore(
            resolveWorkspaceStatePath(this.workspaceStorageDir, EMPTY_WINDOW_WORKSPACE_ID),
            options,
        );
    }

    public get<T>(descriptor: IStateDescriptor<T>): T {
        return this.resolveStore(descriptor.scope).get(descriptor);
    }

    public store<T>(descriptor: IStateDescriptor<T>, value: T): void {
        this.resolveStore(descriptor.scope).store(descriptor, value);
    }

    public remove<T>(descriptor: IStateDescriptor<T>): void {
        this.resolveStore(descriptor.scope).remove(descriptor);
    }

    public openWorkspace(workspaceId: WorkspaceId): void {
        // Сбросить текущий workspace-стор на диск перед переключением на другой.
        this.workspace.open(resolveWorkspaceStatePath(this.workspaceStorageDir, workspaceId));
        this.onDidOpenWorkspaceEmitter.fire(workspaceId);
    }

    public flushSync(): void {
        this.application.flushSync();
        this.global.flushSync();
        this.workspace.flushSync();
    }

    /**
     * Глушит писателя: снимает запланированную debounced-запись, и после
     * `dispose` её не взводит заново ни один `store`/`remove`.
     *
     * Durability — НЕ задача `dispose`: грязные сторы остаются несохранёнными,
     * на диск их отправляет {@link flushSync} (участник прощания,
     * см. docs/arch/State.md). Разделение намеренное: владельцу временного
     * каталога нужно уметь остановить писателя, ничего не записав, — иначе
     * отложенная запись пересоздаёт уже удалённый каталог (`mkdir` с
     * `recursive` в `writeAsync`) и каталог «воскресает» после сноса.
     */
    public dispose(): void {
        this.application.dispose();
        this.global.dispose();
        this.workspace.dispose();
        this.onDidOpenWorkspaceEmitter.dispose();
    }

    /** `application` → стор вне профиля, `global` → стор профиля, `workspace` → стор открытого проекта (или пустого окна). */
    private resolveStore(scope: StateScope): StateFileStore {
        switch (scope) {
            case "application":
                return this.application;
            case "workspace":
                return this.workspace;
            default:
                return this.global;
        }
    }
}

/**
 * Фабрика: собирает {@link StateService} из путей user data (зеркало
 * `loadConfiguration`). `application` — стор `storage.json`, если его уже
 * прочитали раньше ({@link loadApplicationState}): тот же экземпляр, а не
 * второй читатель того же файла.
 */
export function loadState(paths: IUserDataPaths, logger?: ILogger, application?: StateFileStore): StateService {
    return new StateService({
        application: application ?? paths.applicationStateFile,
        globalStateFile: paths.globalStateFile,
        workspaceStorageDir: paths.workspaceStorageDir,
        logger,
    });
}

/**
 * Application-стор отдельно от сервиса: `<userDataDir>/User/globalStorage/storage.json`
 * читается на старте раньше всего остального состояния — в нём реестр
 * профилей, от которого зависит каталог активного профиля. Дальше экземпляр
 * усыновляет {@link loadState}.
 */
export function loadApplicationState(applicationStateFile: string, logger?: ILogger): StateFileStore {
    return new StateFileStore(applicationStateFile, { logger });
}

function loadStateFile(filePath: string, logger: ILogger): Record<string, unknown> {
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
        if (isFileNotFound(err)) return {};
        logger.error(`Failed to read state file ${filePath}`, err);
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(content);
        return isPlainObject(parsed) ? parsed : {};
    } catch (err) {
        logger.error(`Corrupt state file ${filePath} — resetting`, err);
        return {};
    }
}

function serialize(data: Record<string, unknown>): string {
    return JSON.stringify(data, null, 2) + "\n";
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? value : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

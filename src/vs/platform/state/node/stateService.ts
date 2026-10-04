import * as fs from "node:fs";
import * as path from "node:path";

import { Emitter } from "../../../base/common/event.ts";
import { type IUserDataPaths, resolveWorkspaceStatePath } from "../../environment/node/userDataPaths.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";
import { EMPTY_WINDOW_WORKSPACE_ID } from "../../workspace/common/workspaceId.ts";
import type { IStateDescriptor, IStateService, StateScope } from "../common/iStateService.ts";

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
const WRITE_DEBOUNCE_MS = 500;

interface ScopeStore {
    /** Полное дерево из файла: известные ключи + `$versions` + unknown-ключи. */
    data: Record<string, unknown>;
    filePath: string;
    dirty: boolean;
}

export class StateService implements IStateService {
    private readonly global: ScopeStore;
    private readonly workspace: ScopeStore;
    private readonly workspaceStorageDir: string;
    private readonly logger: ILogger | undefined;
    private readonly writeDebounceMs: number;
    private readonly onDidOpenWorkspaceEmitter = new Emitter<WorkspaceId>();
    public readonly onDidOpenWorkspace = this.onDidOpenWorkspaceEmitter.event;
    private writeTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    public constructor(input: {
        readonly globalStateFile: string;
        readonly workspaceStorageDir: string;
        readonly logger?: ILogger;
        /** Задержка debounced-записи; по умолчанию {@link WRITE_DEBOUNCE_MS}. Инъекция — ради тестов. */
        readonly writeDebounceMs?: number;
    }) {
        this.workspaceStorageDir = input.workspaceStorageDir;
        this.logger = input.logger;
        this.writeDebounceMs = input.writeDebounceMs ?? WRITE_DEBOUNCE_MS;
        this.global = {
            data: loadStateFile(input.globalStateFile, this.logger),
            filePath: input.globalStateFile,
            dirty: false,
        };
        // Пока проект не открыт, workspace-скоуп — стор пустого окна, а не global:
        // ключи пустого окна не смешиваются с глобальными.
        const emptyWindowFile = resolveWorkspaceStatePath(this.workspaceStorageDir, EMPTY_WINDOW_WORKSPACE_ID);
        this.workspace = { data: loadStateFile(emptyWindowFile, this.logger), filePath: emptyWindowFile, dirty: false };
    }

    public get<T>(descriptor: IStateDescriptor<T>): T {
        const store = this.resolveStore(descriptor.scope);
        const raw = store.data[descriptor.key];
        if (raw === undefined) return clone(descriptor.default);

        if (descriptor.version !== undefined && descriptor.migrate) {
            const versions = asRecord(store.data[VERSIONS_KEY]);
            const stored = versions[descriptor.key];
            const from = typeof stored === "number" ? stored : 0;
            if (from !== descriptor.version) {
                return descriptor.migrate(clone(raw), from);
            }
        }
        return clone(raw) as T;
    }

    public store<T>(descriptor: IStateDescriptor<T>, value: T): void {
        const store = this.resolveStore(descriptor.scope);
        store.data[descriptor.key] = clone(value);
        if (descriptor.version !== undefined) {
            const versions = asRecord(store.data[VERSIONS_KEY]);
            versions[descriptor.key] = descriptor.version;
            store.data[VERSIONS_KEY] = versions;
        }
        store.dirty = true;
        this.scheduleWrite();
    }

    public remove<T>(descriptor: IStateDescriptor<T>): void {
        const store = this.resolveStore(descriptor.scope);
        Reflect.deleteProperty(store.data, descriptor.key);
        const versions = asRecord(store.data[VERSIONS_KEY]);
        if (Reflect.deleteProperty(versions, descriptor.key) && Object.keys(versions).length === 0) {
            Reflect.deleteProperty(store.data, VERSIONS_KEY);
        }
        store.dirty = true;
        this.scheduleWrite();
    }

    public openWorkspace(workspaceId: WorkspaceId): void {
        // Сбросить текущий workspace-стор на диск перед переключением на другой.
        this.writeStoreSync(this.workspace);
        const filePath = resolveWorkspaceStatePath(this.workspaceStorageDir, workspaceId);
        this.workspace.data = loadStateFile(filePath, this.logger);
        this.workspace.filePath = filePath;
        this.workspace.dirty = false;
        this.onDidOpenWorkspaceEmitter.fire(workspaceId);
    }

    public flushSync(): void {
        if (this.writeTimer !== undefined) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        this.writeStoreSync(this.global);
        this.writeStoreSync(this.workspace);
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
     * `recursive` в `writeStoreAsync`) и каталог «воскресает» после сноса.
     */
    public dispose(): void {
        this.disposed = true;
        if (this.writeTimer !== undefined) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        this.onDidOpenWorkspaceEmitter.dispose();
    }

    /** `global` → global-стор, `workspace` → стор открытого проекта (или пустого окна). */
    private resolveStore(scope: StateScope): ScopeStore {
        return scope === "workspace" ? this.workspace : this.global;
    }

    private scheduleWrite(): void {
        if (this.disposed || this.writeTimer !== undefined) return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            void this.writeStoreAsync(this.global);
            void this.writeStoreAsync(this.workspace);
        }, this.writeDebounceMs);
        // Запись состояния не должна держать event loop живым.
        this.writeTimer.unref();
    }

    private async writeStoreAsync(store: ScopeStore): Promise<void> {
        if (!store.dirty) return;
        store.dirty = false;
        const filePath = store.filePath;
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            await fs.promises.writeFile(filePath, serialize(store.data), "utf-8");
        } catch (err) {
            store.dirty = true; // не удалось — повторим на следующем flush
            this.logger?.error(`Failed to write state file ${filePath}`, err);
        }
    }

    private writeStoreSync(store: ScopeStore): void {
        if (!store.dirty) return;
        store.dirty = false;
        const filePath = store.filePath;
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, serialize(store.data), "utf-8");
        } catch (err) {
            store.dirty = true;
            this.logger?.error(`Failed to write state file ${filePath}`, err);
        }
    }
}

/** Фабрика: собирает {@link StateService} из путей user data (зеркало `loadConfiguration`). */
export function loadState(paths: IUserDataPaths, logger?: ILogger): StateService {
    return new StateService({
        globalStateFile: paths.globalStateFile,
        workspaceStorageDir: paths.workspaceStorageDir,
        logger,
    });
}

function loadStateFile(filePath: string, logger: ILogger | undefined): Record<string, unknown> {
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf-8");
    } catch (err) {
        if (isFileNotFound(err)) return {};
        logger?.error(`Failed to read state file ${filePath}`, err);
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(content);
        return isPlainObject(parsed) ? parsed : {};
    } catch (err) {
        logger?.error(`Corrupt state file ${filePath} — resetting`, err);
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

function isFileNotFound(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

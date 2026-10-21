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

// The file object is kept and written whole, so unknown keys from other versions aren't lost.
// A corrupt file yields an empty store and a log entry; bootstrap doesn't fail.

const VERSIONS_KEY = "$versions";
export const WRITE_DEBOUNCE_MS = 500;

/**
 * A standalone store, for the application scope: the profile registry is read before the profile
 * directory is known, and `StateService` then adopts the same instance ({@link loadState}), so the
 * file has a single writer. Without `filePath` it lives in memory only.
 */
export class StateFileStore implements IStateStore {
    /** Full tree from the file: known keys + `$versions` + unknown keys. */
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

    /** First flushes the contents synchronously to the previous file and cancels the pending write. */
    public open(filePath: string): void {
        this.flushSync();
        this.data = loadStateFile(filePath, this.logger);
        this.filePath = filePath;
        this.dirty = false;
    }

    public flushSync(): void {
        // Stryker disable next-line CallExpression: an uncancelled timer would find the store already clean and write nothing; equivalent mutant
        clearTimeout(this.writeTimer);
        this.writeTimer = undefined;
        this.writeSync();
    }

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
        // Writing state must not keep the event loop alive.
        // Stryker disable next-line CallExpression: whether the timer holds the event loop isn't visible from a test, only for the whole process
        this.writeTimer.unref();
    }

    /** Anything that writes or silences the store cancels the timer, so this always sees a dirty store with the same file. */
    private async writeAsync(filePath: string): Promise<void> {
        this.dirty = false;
        try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            // Stryker disable next-line StringLiteral: an empty encoding for writeFile is the same default utf-8
            await fs.promises.writeFile(filePath, serialize(this.data), "utf-8");
        } catch (err) {
            this.dirty = true; // failed: retry on the next flush
            this.logger.error(`Failed to write state file ${filePath}`, err);
        }
    }

    private writeSync(): void {
        if (!this.dirty || this.filePath === undefined) return;
        this.dirty = false;
        const filePath = this.filePath;
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            // Stryker disable next-line StringLiteral: an empty encoding for writeFileSync is the same default utf-8
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
         * Application store (`User/globalStorage/storage.json`): a ready instance
         * if it was already read before the service was built (profile registry, see
         * {@link StateFileStore}), or a file path. With neither, the store is
         * in-memory only (tests).
         */
        readonly application?: StateFileStore | string;
        readonly globalStateFile: string;
        readonly workspaceStorageDir: string;
        readonly logger?: ILogger;
        /** Debounced write delay; defaults to {@link WRITE_DEBOUNCE_MS}. Injectable for tests. */
        readonly writeDebounceMs?: number;
    }) {
        const options = { logger: input.logger, writeDebounceMs: input.writeDebounceMs };
        this.workspaceStorageDir = input.workspaceStorageDir;
        this.application =
            input.application instanceof StateFileStore
                ? input.application
                : new StateFileStore(input.application, options);
        this.global = new StateFileStore(input.globalStateFile, options);
        // Until a project is open, the workspace scope is the empty window's store, not global:
        // empty-window keys don't mix with global ones.
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
        // `open` flushes the current workspace store to disk before switching.
        this.workspace.open(resolveWorkspaceStatePath(this.workspaceStorageDir, workspaceId));
        this.onDidOpenWorkspaceEmitter.fire(workspaceId);
    }

    public flushSync(): void {
        this.application.flushSync();
        this.global.flushSync();
        this.workspace.flushSync();
    }

    /**
     * Silences the writer: cancels the scheduled debounced write, and after
     * `dispose` no `store`/`remove` schedules it again.
     *
     * Durability is NOT `dispose`'s job: dirty stores stay unsaved, and
     * {@link flushSync} sends them to disk (a shutdown participant,
     * see docs/arch/State.md). The split is deliberate: the owner of a temp
     * directory must be able to stop the writer without writing anything, otherwise
     * the pending write recreates an already deleted directory (`mkdir` with
     * `recursive` in `writeAsync`) and the directory "comes back" after removal.
     */
    public dispose(): void {
        this.application.dispose();
        this.global.dispose();
        this.workspace.dispose();
        this.onDidOpenWorkspaceEmitter.dispose();
    }

    /** `application` → store outside the profile, `global` → profile store, `workspace` → open project's (or empty window's) store. */
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
 * Factory: builds a {@link StateService} from user data paths (mirrors
 * `loadConfiguration`). `application` is the `storage.json` store if it was
 * already read earlier ({@link loadApplicationState}): the same instance rather
 * than a second reader of the same file.
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
 * The application store, separate from the service: `<userDataDir>/User/globalStorage/storage.json`
 * is read at startup before any other state, since it holds the profile registry that
 * determines the active profile's directory. {@link loadState} then adopts the instance.
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

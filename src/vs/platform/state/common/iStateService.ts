import type { Event } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

/** Separate from {@link IConfigurationService}: state is machine-owned plain JSON, not edited by hand (docs/arch/State.md). */
export interface IStateService {
    /** A deep copy: mutating the result doesn't touch the store. A corrupt file yields `descriptor.default`. */
    get<T>(descriptor: IStateDescriptor<T>): T;

    /** The store updates synchronously, disk is debounced; durability is {@link flushSync} on exit. The value is copied. */
    store<T>(descriptor: IStateDescriptor<T>, value: T): void;

    /** Along with the version entry, so the file doesn't accumulate empty leftovers. */
    remove<T>(descriptor: IStateDescriptor<T>): void;

    /**
     * The previous workspace store is first flushed to disk synchronously. Until a workspace is opened,
     * `workspace` descriptors are served by the empty window's store (`EMPTY_WINDOW_WORKSPACE_ID`), not `global`.
     */
    openWorkspace(workspaceId: WorkspaceId): void;

    /** Synchronous, after the new store is loaded; the empty window's store at startup fires no event. */
    readonly onDidOpenWorkspace: Event<WorkspaceId>;

    /** Synchronous I/O only, so it's fit for `process.on("exit")`. */
    flushSync(): void;

    /**
     * Writes nothing, only cancels the pending write: otherwise for short-lived storage
     * (a test's temp directory) it would fire after the directory is removed and recreate it.
     */
    dispose(): void;
}

export type StateScope =
    /** Outside the profile: upstream `User/globalStorage/storage.json`; holds the profile registry. */
    | "application"
    /** `<profileDir>/globalState.json`; fallback when no project is open. */
    | "global"
    /** Per-project: `workspaceStorage/<workspaceId>/state.json`. */
    | "workspace";

/** One scope without the whole service: the profile registry reads the application store before the profile directory is resolved. */
export type IStateStore = Pick<IStateService, "get" | "store" | "remove">;

/** Declared next to the owning controller, not next to the TUIDom element. */
export interface IStateDescriptor<T> {
    readonly key: string;
    readonly scope: StateScope;
    readonly default: T;
    /** Set together with {@link migrate}: the store remembers the entry's version and migrates stale ones. */
    readonly version?: number;
    /** `from` is the entry's version, 0 if unknown. */
    readonly migrate?: (raw: unknown, from: number) => T;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string is only a debug label
export const StateServiceDIToken = token<IStateService>("StateService");

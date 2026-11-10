import type * as vscode from "vscode";

import { matchRelativeGlob } from "../../../base/common/glob.ts";
import { DisposableStore } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";

import { EventEmitter, FileChangeType, RelativePattern } from "./vscodeTypes.ts";
import type { IWireWatcherCreate, IWireWatcherEvents } from "./wireTypes.ts";

export interface IWatcherTransport {
    create(request: IWireWatcherCreate): void;
    dispose(id: number): void;
}

export interface IResolvedGlobPattern {
    readonly base: string;
    readonly pattern: string;
}

/**
 * A string pattern means "in all workspace folders", and we have a single folder. No
 * workspace: `null` — the watcher is valid but silent, as in an empty VS Code window.
 */
export function resolveGlobPattern(
    // `unknown`, not `vscode.GlobPattern`: a foreign object from another extension runtime
    // routinely arrives here, so the checks below are not decorative.
    globPattern: unknown,
    workspaceRoot: string | undefined,
): IResolvedGlobPattern | null {
    if (typeof globPattern === "string") {
        return workspaceRoot === undefined ? null : { base: workspaceRoot, pattern: globPattern };
    }
    if (typeof globPattern !== "object" || globPattern === null) return null;
    const raw = globPattern as { baseUri?: unknown; base?: unknown; pattern?: unknown };
    if (typeof raw.pattern !== "string") return null;
    const base = baseFsPath(globPattern instanceof RelativePattern ? globPattern.baseUri : raw.baseUri, raw.base);
    return base === null ? null : { base, pattern: raw.pattern };
}

/** A string `base` is the legacy form of `RelativePattern`. */
function baseFsPath(baseUri: unknown, base: unknown): string | null {
    if (baseUri instanceof Uri) return baseUri.fsPath;
    if (typeof baseUri === "object" && baseUri !== null) {
        const fsPath = (baseUri as { fsPath?: unknown }).fsPath;
        if (typeof fsPath === "string" && fsPath !== "") return fsPath;
    }
    return typeof base === "string" && base !== "" ? base : null;
}

/**
 * VS Code rule: a single-segment pattern watches only direct children of the base,
 * `**` or a separator watches the subtree. The cheap `.git` watcher relies on this:
 * `new RelativePattern(dotGit, "*")` doesn't drag `.git/objects` along.
 */
export function isRecursiveWatchPattern(pattern: string): boolean {
    return pattern.includes("**") || pattern.includes("/");
}

export interface IProviderWatchTarget {
    readonly provider: vscode.FileSystemProvider;
    readonly base: Uri;
    readonly pattern: string;
}

/** A pattern whose base is not on disk: a `RelativePattern` on a `Uri` of another scheme that has a provider. */
export function providerWatchTarget(
    globPattern: unknown,
    providerOf: (scheme: string) => vscode.FileSystemProvider | undefined,
): IProviderWatchTarget | null {
    // `Object()`: a string pattern or garbage has no `baseUri` and falls through to `null` below.
    const { baseUri, pattern } = Object(globPattern) as { baseUri?: unknown; pattern?: unknown };
    if (!(baseUri instanceof Uri) || baseUri.scheme === "file" || typeof pattern !== "string") return null;
    const provider = providerOf(baseUri.scheme);
    return provider === undefined ? null : { provider, base: baseUri, pattern };
}

export interface IWatcherIgnoreFlags {
    readonly ignoreCreateEvents: boolean;
    readonly ignoreChangeEvents: boolean;
    readonly ignoreDeleteEvents: boolean;
}

/**
 * Upstream routes such a watcher through the main thread's file service back to the provider; here the
 * provider lives in the same subprocess, so the hop is skipped. As upstream (`extHostFileSystemEventService.ts`):
 * `provider.watch` is recursive by {@link isRecursiveWatchPattern}, a recursive watch gets `files.watcherExclude`
 * as `excludes`, and `onDidChangeFile` events reach the watcher only when they match the pattern under the base.
 */
export function watchProviderFiles(
    target: IProviderWatchTarget,
    flags: IWatcherIgnoreFlags,
    watcherExcludes: readonly string[],
): vscode.FileSystemWatcher {
    const { provider } = target;
    const store = new DisposableStore();
    const onDidCreate = store.add(new EventEmitter<vscode.Uri>());
    const onDidChange = store.add(new EventEmitter<vscode.Uri>());
    const onDidDelete = store.add(new EventEmitter<vscode.Uri>());
    const byType = new Map<vscode.FileChangeType, EventEmitter<vscode.Uri>>();
    if (!flags.ignoreCreateEvents) byType.set(FileChangeType.Created, onDidCreate);
    if (!flags.ignoreChangeEvents) byType.set(FileChangeType.Changed, onDidChange);
    if (!flags.ignoreDeleteEvents) byType.set(FileChangeType.Deleted, onDidDelete);
    const relativePattern = { base: target.base.path, pattern: target.pattern };
    store.add(
        provider.onDidChangeFile((events) => {
            for (const { type, uri } of events) {
                if (matchRelativeGlob(relativePattern, uri.path)) byType.get(type)?.fire(uri);
            }
        }),
    );
    const recursive = isRecursiveWatchPattern(target.pattern);
    // Never synchronously: upstream's `watch` arrives after an RPC round trip, and callers (upstream's own
    // `workspace-watcher` test) subscribe to the provider's side only after `createFileSystemWatcher` returns.
    queueMicrotask(() => {
        if (store.isDisposed) return;
        try {
            store.add(provider.watch(target.base, { recursive, excludes: recursive ? watcherExcludes : [] }));
        } catch {
            // The provider may belong to another extension: its failure must not throw into the caller,
            // upstream only logs it on the main side. The watcher stays valid and hears `onDidChangeFile`.
        }
    });
    return {
        ...flags,
        onDidCreate: onDidCreate.event,
        onDidChange: onDidChange.event,
        onDidDelete: onDidDelete.event,
        dispose: () => {
            store.dispose();
        },
    };
}

/** The core does the watching: the subprocess must not hand out the inotify budget or know `files.watcherExclude`. */
export class SubprocessFileSystemWatchers {
    private readonly emitters = new Map<
        number,
        {
            readonly onDidCreate: EventEmitter<vscode.Uri>;
            readonly onDidChange: EventEmitter<vscode.Uri>;
            readonly onDidDelete: EventEmitter<vscode.Uri>;
        }
    >();
    private nextId = 1;

    public constructor(private readonly transport: IWatcherTransport) {}

    /** `ignore*Events` flags go to the host: an unneeded event must not cross the process boundary. */
    public create(
        resolved: IResolvedGlobPattern,
        ignoreCreateEvents: boolean,
        ignoreChangeEvents: boolean,
        ignoreDeleteEvents: boolean,
    ): vscode.FileSystemWatcher {
        const id = this.nextId++;
        const emitters = {
            onDidCreate: new EventEmitter<vscode.Uri>(),
            onDidChange: new EventEmitter<vscode.Uri>(),
            onDidDelete: new EventEmitter<vscode.Uri>(),
        };
        this.emitters.set(id, emitters);
        this.transport.create({
            id,
            base: resolved.base,
            pattern: resolved.pattern,
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents,
        });

        const watcher = {
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents,
            onDidCreate: emitters.onDidCreate.event,
            onDidChange: emitters.onDidChange.event,
            onDidDelete: emitters.onDidDelete.event,
            dispose: () => {
                if (!this.emitters.delete(id)) return; // a repeated dispose is a no-op
                emitters.onDidCreate.dispose();
                emitters.onDidChange.dispose();
                emitters.onDidDelete.dispose();
                this.transport.dispose(id);
            },
        };
        return watcher;
    }

    public createInert(
        ignoreCreateEvents: boolean,
        ignoreChangeEvents: boolean,
        ignoreDeleteEvents: boolean,
    ): vscode.FileSystemWatcher {
        const emitter = new EventEmitter<vscode.Uri>();
        return {
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents,
            onDidCreate: emitter.event,
            onDidChange: emitter.event,
            onDidDelete: emitter.event,
            dispose: () => {
                emitter.dispose();
            },
        };
    }

    public dispatch(events: IWireWatcherEvents): void {
        const emitters = this.emitters.get(events.id);
        // Race on close: the host managed to send a batch before `workspace.watcher.dispose`.
        if (emitters === undefined) return;
        for (const event of events.events) {
            const uri = Uri.parse(event.uri);
            if (event.type === "created") emitters.onDidCreate.fire(uri);
            else if (event.type === "changed") emitters.onDidChange.fire(uri);
            else emitters.onDidDelete.fire(uri);
        }
    }
}

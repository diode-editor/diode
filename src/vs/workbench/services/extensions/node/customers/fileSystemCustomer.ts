import * as path from "node:path";

import { Emitter } from "../../../../../base/common/event.ts";
import { matchGlob } from "../../../../../base/common/glob.ts";
import { Disposable, DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../../base/common/uri.ts";
import type { IStat } from "../../../../../platform/files/common/files.ts";
import type { ITreeFileChange } from "../../../../../platform/files/common/iTreeFileWatcher.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionFileWatcher } from "../../../../api/common/iExtensionFileWatcher.ts";
import type { IWireWatcherCreate, IWireWatcherEvent } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireFileStat,
    parseWireFileSystemSchemes,
    parseWireReadFileResult,
    parseWireSchemes,
    parseWireTextContentResult,
    parseWireWatcherCreate,
    parseWireWatcherDispose,
} from "../hostWireParsers.ts";

/** Events to the core live as long as the host; watchers and the channel to providers live for one spawn. */
export class FileSystemCustomer extends Disposable implements IExtensionHostCustomer {
    private live: { readonly rpc: HostRpc; textContentSchemes: readonly string[] } | null = null;
    private fileSystemSchemesValue: readonly string[] = [];
    private readonlySchemes: ReadonlySet<string> = new Set();
    private readonly onFileSystemProvidersChangedEmitter = this.register(new Emitter<void>());
    private readonly onDidChangeProvidedFileEmitter = this.register(new Emitter<readonly Uri[]>());
    private readonly onDidChangeTextContentEmitter = this.register(new Emitter<Uri>());

    public readonly onFileSystemProvidersChanged = this.onFileSystemProvidersChangedEmitter.event;
    public readonly onDidChangeProvidedFile = this.onDidChangeProvidedFileEmitter.event;
    public readonly onDidChangeTextContent = this.onDidChangeTextContentEmitter.event;

    public constructor(private readonly fileWatcher: IExtensionFileWatcher) {
        super();
    }

    public getFileSystemSchemes(): readonly string[] {
        return this.fileSystemSchemesValue;
    }

    /** The provider scheme is readonly (`isReadonly` or a provider without `writeFile`). */
    public isReadonlyFileSystem(scheme: string): boolean {
        return this.readonlySchemes.has(scheme);
    }

    /**
     * Rejects if the host isn't up or no provider is registered for the scheme —
     * the consumer must survive this (for the gutter, “no git extension” is normal).
     */
    public async readProvidedFile(uri: Uri): Promise<Uint8Array> {
        return parseWireReadFileResult(await this.rpc().request("workspace.fs.readFile", { uri: uri.toString() }));
    }

    /** `null` means the resource doesn't exist. Rejects like {@link readProvidedFile}. */
    public async statProvidedFile(uri: Uri): Promise<IStat | null> {
        return parseWireFileStat(await this.rpc().request("workspace.fs.stat", { uri: uri.toString() }));
    }

    /** Rejects like {@link readProvidedFile}. */
    public async writeProvidedFile(uri: Uri, content: Uint8Array): Promise<void> {
        await this.rpc().request("workspace.fs.writeFile", {
            uri: uri.toString(),
            content: Buffer.from(content).toString("base64"),
        });
    }

    private rpc(): HostRpc {
        const rpc = this.live?.rpc;
        if (rpc === undefined) throw new Error("extension host is not running");
        return rpc;
    }

    /**
     * Ask when the resource is opened, not once: the extension activates
     * asynchronously and registers its provider after the first file is already open.
     */
    public hasTextContentProvider(scheme: string): boolean {
        return this.live?.textContentSchemes.includes(scheme) === true;
    }

    /**
     * `null` means the provider refused to return the resource. A failure is a rejection, not `null`:
     * the core needs the reason to show it to the user.
     */
    public async provideTextDocumentContent(uri: Uri): Promise<string | null> {
        const rpc = this.live?.rpc;
        if (rpc === undefined) throw new Error("extension host is not running");
        return parseWireTextContentResult(
            await rpc.request("workspace.provideTextDocumentContent", { uri: uri.toString() }),
        );
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        // Stryker disable next-line ArrayDeclaration: there are no schemes before the subprocess first declares them; the mutant injects a placeholder scheme no extension registers
        const live = { rpc, textContentSchemes: [] as readonly string[] };
        this.live = live;
        const store = new DisposableStore();
        const watchers = store.add(new DisposableMap<number>());
        store.add(
            rpc.handleNotification("workspace.fileSystemProvidersChanged", (params) => {
                const { schemes, readonly } = parseWireFileSystemSchemes(params);
                this.fileSystemSchemesValue = schemes;
                this.readonlySchemes = new Set(readonly);
                this.onFileSystemProvidersChangedEmitter.fire();
            }),
        );
        // TextDocumentContentProviders (`jdt:` in redhat.java) are a separate registry:
        // the provider returns text rather than bytes, and is read-only.
        store.add(
            rpc.handleNotification("workspace.textDocumentContentProvidersChanged", (params) => {
                live.textContentSchemes = parseWireSchemes(params);
            }),
        );
        store.add(
            rpc.handleNotification("workspace.textDocumentContentChanged", (params) => {
                const uri: unknown = params.uri;
                if (typeof uri !== "string") return;
                this.onDidChangeTextContentEmitter.fire(Uri.parse(uri));
            }),
        );
        store.add(
            rpc.handleNotification("workspace.fs.didChangeFile", (params) => {
                const p: { uris?: unknown } = params;
                const raw = Array.isArray(p.uris) ? p.uris.filter((u): u is string => typeof u === "string") : [];
                if (raw.length === 0) return;
                this.onDidChangeProvidedFileEmitter.fire(raw.map((u) => Uri.parse(u)));
            }),
        );
        // The core watches the tree (it owns excludes and the inotify budget),
        // while pattern matching happens here: only matching events go to the subprocess.
        store.add(
            rpc.handleNotification("workspace.watcher.create", (params) => {
                const request = parseWireWatcherCreate(params);
                // Stryker disable next-line ConditionalExpression: without the null check it throws on a field before calling the watcher — RpcEndpoint swallows the notification exception, the observable result is the same “ignored”
                if (request === null) return;
                // A repeated id means re-creation: `set` drops the old subscription.
                watchers.set(
                    request.id,
                    this.fileWatcher.watch(request.base, isRecursiveWatchPattern(request.pattern), (changes) => {
                        const events = toWatcherEvents(request, changes);
                        if (events.length > 0) rpc.notify("workspace.watcher.events", { id: request.id, events });
                    }),
                );
            }),
        );
        store.add(
            rpc.handleNotification("workspace.watcher.dispose", (params) => {
                const id = parseWireWatcherDispose(params);
                // Stryker disable next-line ConditionalExpression: removal by a null key is a no-op, no such watcher exists
                if (id === null) return;
                watchers.deleteAndDispose(id);
            }),
        );
        // FS schemes are removed with an event: otherwise `git:` in the core registry would point
        // to a dead subprocess until it is revived.
        store.add({
            dispose: () => {
                this.live = null;
                if (this.fileSystemSchemesValue.length === 0) return;
                this.fileSystemSchemesValue = [];
                this.readonlySchemes = new Set();
                this.onFileSystemProvidersChangedEmitter.fire();
            },
        });
        return store;
    }
}

/**
 * VS Code rule: a single-segment pattern watches only direct children of the base,
 * `**` or a separator watches the subtree. The cheap `.git` watcher relies on this:
 * `new RelativePattern(dotGit, "*")` doesn't drag `.git/objects` along.
 */
export function isRecursiveWatchPattern(pattern: string): boolean {
    return pattern.includes("**") || pattern.includes("/");
}

/** The path is matched relative to the base in posix form — the pattern works the same on all platforms. */
export function toWatcherEvents(request: IWireWatcherCreate, changes: readonly ITreeFileChange[]): IWireWatcherEvent[] {
    const events: IWireWatcherEvent[] = [];
    for (const change of changes) {
        if (change.type === "created" && request.ignoreCreateEvents) continue;
        if (change.type === "changed" && request.ignoreChangeEvents) continue;
        if (change.type === "deleted" && request.ignoreDeleteEvents) continue;
        const relative = path.relative(request.base, change.path);
        if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
        if (!matchGlob(request.pattern, relative.split(path.sep).join("/"))) continue;
        events.push({ type: change.type, uri: Uri.file(change.path).toString() });
    }
    return events;
}

import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { flushMicrotasks } from "../../../../TestUtils/timing.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { EventEmitter, FileChangeType, RelativePattern, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

function makeWorkspace(root: string | null = "/repo", user: Record<string, unknown> = {}) {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    if (root !== null) {
        stub.fire("workspace.initialize", {
            configuration: { defaults: {}, user },
            workspaceFolders: [{ uri: Uri.file(root).toString(), name: "repo", index: 0 }],
        });
    }
    return { stub, workspace };
}

describe("workspace.createFileSystemWatcher — RPC wiring", () => {
    it("a string pattern goes to the host with the workspace folder as base", () => {
        const { stub, workspace } = makeWorkspace();

        workspace.createFileSystemWatcher("**/*.ts");

        expect(stub.notifies.filter((n) => n.method === "workspace.watcher.create")).toEqual([
            {
                method: "workspace.watcher.create",
                params: {
                    id: 1,
                    base: "/repo",
                    pattern: "**/*.ts",
                    ignoreCreateEvents: false,
                    ignoreChangeEvents: false,
                    ignoreDeleteEvents: false,
                },
            },
        ]);
    });

    it("host events reach the extension listeners", () => {
        const { stub, workspace } = makeWorkspace();
        const watcher = workspace.createFileSystemWatcher(
            new RelativePattern("/repo/.git", "*") as unknown as vscode.GlobPattern,
        );
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        stub.fire("workspace.watcher.events", {
            id: 1,
            events: [{ type: "changed", uri: Uri.file("/repo/.git/HEAD").toString() }],
        });

        expect(seen).toEqual(["/repo/.git/HEAD"]);
    });

    it("a garbage batch from the host is ignored", () => {
        const { stub, workspace } = makeWorkspace();
        const watcher = workspace.createFileSystemWatcher("**");
        const seen: string[] = [];
        watcher.onDidChange((uri) => seen.push(uri.fsPath));

        expect(() => {
            stub.fire("workspace.watcher.events", "not an object");
        }).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("dispose removes the watcher on the host", () => {
        const { stub, workspace } = makeWorkspace();

        workspace.createFileSystemWatcher("**").dispose();

        expect(stub.notifies.at(-1)).toEqual({ method: "workspace.watcher.dispose", params: { id: 1 } });
    });

    it("in an empty window a string pattern has nothing to resolve against, the host is not bothered", () => {
        const { stub, workspace } = makeWorkspace(null);

        const watcher = workspace.createFileSystemWatcher("**");

        expect(stub.notifies.filter((n) => n.method === "workspace.watcher.create")).toEqual([]);
        expect(() => {
            watcher.dispose();
        }).not.toThrow();
    });
});

interface IWatchRequest {
    readonly uri: string;
    readonly options: { readonly recursive: boolean; readonly excludes: readonly string[] };
}

/** The shape of upstream's `WatcherTestFs`: records `watch` calls; only `watch` and `onDidChangeFile` are used. */
class WatchedFs {
    public readonly requests: IWatchRequest[] = [];
    public disposedWatches = 0;
    public listeners = 0;
    private readonly changes = new EventEmitter<vscode.FileChangeEvent[]>();

    public readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = (listener) => {
        this.listeners++;
        const subscription = this.changes.event(listener);
        return {
            dispose: () => {
                this.listeners--;
                subscription.dispose();
            },
        };
    };

    public watch(uri: vscode.Uri, options: IWatchRequest["options"]): vscode.Disposable {
        this.requests.push({ uri: uri.toString(), options });
        return {
            dispose: () => {
                this.disposedWatches++;
            },
        };
    }

    public fire(...events: [FileChangeType, string][]): void {
        this.changes.fire(events.map(([type, uri]) => ({ type, uri: Uri.parse(uri) })));
    }
}

function withProvider(user: Record<string, unknown> = {}, basePath = "/somePath/folder") {
    const { stub, workspace } = makeWorkspace("/repo", user);
    const fs = new WatchedFs();
    workspace.registerFileSystemProvider("watcherTest", fs as unknown as vscode.FileSystemProvider);
    const base = Uri.from({ scheme: "watcherTest", path: basePath });
    const watch = (pattern: string, ignoreCreate = false, ignoreChange = false, ignoreDelete = false) =>
        workspace.createFileSystemWatcher(
            new RelativePattern(base, pattern) as unknown as vscode.GlobPattern,
            ignoreCreate,
            ignoreChange,
            ignoreDelete,
        );
    const hostWatchers = () => stub.notifies.filter((n) => n.method === "workspace.watcher.create");
    return { fs, watch, hostWatchers };
}

function record(watcher: vscode.FileSystemWatcher): string[] {
    const seen: string[] = [];
    watcher.onDidCreate((uri) => seen.push(`created ${uri.toString()}`));
    watcher.onDidChange((uri) => seen.push(`changed ${uri.toString()}`));
    watcher.onDidDelete((uri) => seen.push(`deleted ${uri.toString()}`));
    return seen;
}

describe("workspace.createFileSystemWatcher — on an extension FileSystemProvider", () => {
    it("[api:workspace.createFileSystemWatcher] '*.txt' asks the provider for a non-recursive watch, the host is not involved", async () => {
        const { fs, watch, hostWatchers } = withProvider({
            files: { watcherExclude: { "**/.git/objects/**": true } },
        });

        watch("*.txt");
        // As upstream's RPC round trip: the caller can still subscribe to the provider after the call returns.
        expect(fs.requests).toEqual([]);
        await flushMicrotasks();

        expect(fs.requests).toEqual([
            { uri: "watcherTest:/somePath/folder", options: { recursive: false, excludes: [] } },
        ]);
        expect(hostWatchers()).toEqual([]);
    });

    it("[api:workspace.createFileSystemWatcher] '**/*.txt' is recursive and carries files.watcherExclude as excludes", async () => {
        const { fs, watch } = withProvider({
            files: { watcherExclude: { "**/.git/objects/**": true, "**/node_modules/**": false } },
        });

        watch("**/*.txt");
        await flushMicrotasks();

        expect(fs.requests).toEqual([
            { uri: "watcherTest:/somePath/folder", options: { recursive: true, excludes: ["**/.git/objects/**"] } },
        ]);
    });

    it("[api:workspace.createFileSystemWatcher] onDidChangeFile events matching the pattern under the base reach the watcher by kind", () => {
        const { fs, watch } = withProvider();
        const seen = record(watch("*.txt"));

        fs.fire(
            [FileChangeType.Created, "watcherTest:/somePath/folder/a.txt"],
            [FileChangeType.Changed, "watcherTest:/somePath/folder/b.txt"],
            [FileChangeType.Deleted, "watcherTest:/somePath/folder/c.txt"],
            [FileChangeType.Changed, "watcherTest:/somePath/folder/a.md"],
            [FileChangeType.Changed, "watcherTest:/somePath/folder/sub/d.txt"],
            [FileChangeType.Changed, "watcherTest:/somePath/other/e.txt"],
            [FileChangeType.Changed, "watcherTest:/somePath/folder.txt"],
        );

        expect(seen).toEqual([
            "created watcherTest:/somePath/folder/a.txt",
            "changed watcherTest:/somePath/folder/b.txt",
            "deleted watcherTest:/somePath/folder/c.txt",
        ]);
    });

    it("[api:workspace.createFileSystemWatcher] a recursive pattern on the root hears the whole subtree", () => {
        const { fs, watch } = withProvider({}, "/");
        const seen = record(watch("**/*.txt"));

        fs.fire([FileChangeType.Created, "watcherTest:/deep/sub/a.txt"]);

        expect(seen).toEqual(["created watcherTest:/deep/sub/a.txt"]);
    });

    it("[api:workspace.createFileSystemWatcher] ignore flags drop their kind of event", () => {
        const { fs, watch } = withProvider();
        const seen = record(watch("*.txt", true, false, true));

        fs.fire(
            [FileChangeType.Created, "watcherTest:/somePath/folder/a.txt"],
            [FileChangeType.Changed, "watcherTest:/somePath/folder/a.txt"],
            [FileChangeType.Deleted, "watcherTest:/somePath/folder/a.txt"],
        );

        expect(seen).toEqual(["changed watcherTest:/somePath/folder/a.txt"]);

        const keepsCreateAndDelete = record(watch("*.txt", false, true, false));
        fs.fire(
            [FileChangeType.Created, "watcherTest:/somePath/folder/b.txt"],
            [FileChangeType.Changed, "watcherTest:/somePath/folder/b.txt"],
            [FileChangeType.Deleted, "watcherTest:/somePath/folder/b.txt"],
        );
        expect(keepsCreateAndDelete).toEqual([
            "created watcherTest:/somePath/folder/b.txt",
            "deleted watcherTest:/somePath/folder/b.txt",
        ]);
    });

    it("[api:workspace.createFileSystemWatcher] a watcher that ignores every kind does not ask the provider to watch", async () => {
        const { fs, watch, hostWatchers } = withProvider();

        watch("*.txt", true, true, true);
        await flushMicrotasks();

        expect(fs.requests).toEqual([]);
        expect(fs.listeners).toBe(1); // only the registry's own subscription
        expect(hostWatchers()).toEqual([]);
    });

    it("[api:workspace.createFileSystemWatcher] dispose releases the provider watch and the subscription once", async () => {
        const { fs, watch } = withProvider();
        const watcher = watch("*.txt");
        const seen = record(watcher);
        await flushMicrotasks();
        expect(fs.listeners).toBe(2);

        watcher.dispose();
        watcher.dispose();
        fs.fire([FileChangeType.Created, "watcherTest:/somePath/folder/a.txt"]);

        expect(fs.disposedWatches).toBe(1);
        expect(fs.listeners).toBe(1);
        expect(seen).toEqual([]);
    });

    it("[api:workspace.createFileSystemWatcher] a watcher disposed before the deferred watch never asks the provider", async () => {
        const { fs, watch } = withProvider();

        watch("*.txt").dispose();
        await flushMicrotasks();

        expect(fs.requests).toEqual([]);
        expect(fs.listeners).toBe(1);
    });

    it("a provider whose watch throws does not throw into the caller; its events still arrive", async () => {
        const { fs, watch } = withProvider();
        let calls = 0;
        fs.watch = () => {
            calls++;
            throw new Error("boom");
        };

        const watcher = watch("*.txt");
        const seen = record(watcher);
        await flushMicrotasks();
        expect(calls).toBe(1);
        fs.fire([FileChangeType.Created, "watcherTest:/somePath/folder/a.txt"]);

        expect(seen).toEqual(["created watcherTest:/somePath/folder/a.txt"]);
        expect(() => {
            watcher.dispose();
        }).not.toThrow();
    });

    it("a non-file base without a registered provider stays a disk watcher, as before", () => {
        const { stub, workspace } = makeWorkspace();

        workspace.createFileSystemWatcher(
            new RelativePattern(Uri.from({ scheme: "nobody", path: "/x" }), "*") as unknown as vscode.GlobPattern,
        );

        expect(stub.notifies.filter((n) => n.method === "workspace.watcher.create")).toHaveLength(1);
    });
});

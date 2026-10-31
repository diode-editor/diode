import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITreeFileChange } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import type { IExtensionFileWatcher } from "../../../api/common/iExtensionFileWatcher.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { isRecursiveWatchPattern, toWatcherEvents } from "./customers/fileSystemCustomer.ts";
import { ExtensionHost } from "./extensionHost.ts";

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    listCommandIds: () => [],
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeFakeWatcher(): IExtensionFileWatcher & {
    readonly calls: { base: string; recursive: boolean }[];
    readonly disposed: number[];
    fire(index: number, changes: readonly ITreeFileChange[]): void;
} {
    const calls: { base: string; recursive: boolean }[] = [];
    const disposed: number[] = [];
    const sinks: ((changes: readonly ITreeFileChange[]) => void)[] = [];
    return {
        calls,
        disposed,
        fire: (index, changes) => {
            sinks[index](changes);
        },
        watch: (base, recursive, onChanges): IDisposable => {
            const index = calls.length;
            calls.push({ base, recursive });
            sinks.push(onChanges);
            return { dispose: () => disposed.push(index) };
        },
    };
}

function makeHost(fileWatcher: IExtensionFileWatcher) {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, { fileWatcher });
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer };
}

describe("ExtensionHost — extension watchers (in-process)", () => {
    it("creating a watcher starts watching, and events go to the subprocess", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);
        const received: unknown[] = [];
        peer.handleNotification("workspace.watcher.events", (params) => received.push(params));

        peer.notify("workspace.watcher.create", { id: 7, base: "/repo", pattern: "**" });
        await flushMicrotasks();
        expect(watcher.calls).toEqual([{ base: "/repo", recursive: true }]);

        watcher.fire(0, [{ type: "changed", path: "/repo/src/a.ts" }]);
        await flushMicrotasks();

        expect(received).toEqual([
            { id: 7, events: [{ type: "changed", uri: Uri.file("/repo/src/a.ts").toString() }] },
        ]);
    });

    it("a batch that is empty after filtering does not cross the process boundary", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);
        const received: unknown[] = [];
        peer.handleNotification("workspace.watcher.events", (params) => received.push(params));

        peer.notify("workspace.watcher.create", { id: 1, base: "/repo", pattern: "*.ts" });
        await flushMicrotasks();
        watcher.fire(0, [{ type: "changed", path: "/repo/src/deep/a.ts" }]);
        await flushMicrotasks();

        expect(received).toEqual([]);
    });

    it("dispose stops watching", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: 3, base: "/repo", pattern: "**" });
        await flushMicrotasks();
        peer.notify("workspace.watcher.dispose", { id: 3 });
        await flushMicrotasks();

        expect(watcher.disposed).toEqual([0]);
    });

    it("a repeated id recreates the watcher without leaving a dangling subscription", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: 5, base: "/repo", pattern: "**" });
        await flushMicrotasks();
        peer.notify("workspace.watcher.create", { id: 5, base: "/other", pattern: "**" });
        await flushMicrotasks();

        expect(watcher.disposed).toEqual([0]);
        expect(watcher.calls).toHaveLength(2);
    });

    it("structurally foreign params are ignored", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: "no", base: "/repo", pattern: "**" });
        peer.notify("workspace.watcher.create", { id: 1, base: "", pattern: "**" });
        peer.notify("workspace.watcher.dispose", { id: null });
        await flushMicrotasks();

        expect(watcher.calls).toEqual([]);
        expect(watcher.disposed).toEqual([]);
    });

    it("host dispose removes all live watchers", async () => {
        const watcher = makeFakeWatcher();
        const { host, peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: 1, base: "/a", pattern: "**" });
        peer.notify("workspace.watcher.create", { id: 2, base: "/b", pattern: "**" });
        await flushMicrotasks();
        host.dispose();

        expect(watcher.disposed).toEqual([0, 1]);
    });

    it("without a supplied observer watchers are created but never fire", async () => {
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {});
        const [a, b] = createInProcessChannelPair();
        (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(new RpcEndpoint(a));
        const peer = new RpcEndpoint(b);
        const received = vi.fn();
        peer.handleNotification("workspace.watcher.events", received);

        peer.notify("workspace.watcher.create", { id: 1, base: "/repo", pattern: "**" });
        await flushMicrotasks();

        expect(received).not.toHaveBeenCalled();
    });
});

describe("isRecursiveWatchPattern", () => {
    it("a single-segment pattern matches direct children only", () => {
        expect(isRecursiveWatchPattern("*")).toBe(false);
        expect(isRecursiveWatchPattern("HEAD")).toBe(false);
    });

    it("a globstar or a separator matches the subtree", () => {
        expect(isRecursiveWatchPattern("**")).toBe(true);
        expect(isRecursiveWatchPattern("**/*.ts")).toBe(true);
        expect(isRecursiveWatchPattern("src/*.ts")).toBe(true);
    });
});

describe("toWatcherEvents", () => {
    const request = {
        id: 1,
        base: "/repo",
        pattern: "**",
        ignoreCreateEvents: false,
        ignoreChangeEvents: false,
        ignoreDeleteEvents: false,
    };

    it("the path is matched relative to the base", () => {
        expect(
            toWatcherEvents({ ...request, pattern: "src/*.ts" }, [
                { type: "changed", path: "/repo/src/a.ts" },
                { type: "changed", path: "/repo/other/a.ts" },
            ]),
        ).toEqual([{ type: "changed", uri: Uri.file("/repo/src/a.ts").toString() }]);
    });

    it("events outside the base and the base itself are dropped", () => {
        expect(
            toWatcherEvents(request, [
                { type: "changed", path: "/elsewhere/a.ts" },
                { type: "changed", path: "/repo" },
            ]),
        ).toEqual([]);
    });

    it("ignore flags drop their kind of events", () => {
        const changes: ITreeFileChange[] = [
            { type: "created", path: "/repo/a.ts" },
            { type: "changed", path: "/repo/b.ts" },
            { type: "deleted", path: "/repo/c.ts" },
        ];
        expect(toWatcherEvents({ ...request, ignoreCreateEvents: true, ignoreDeleteEvents: true }, changes)).toEqual([
            { type: "changed", uri: Uri.file("/repo/b.ts").toString() },
        ]);
    });
});

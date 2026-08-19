import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { IDisposable } from "@tuidom/core/common/disposable";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITreeFileChange } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IExtensionFileWatcher } from "../../../api/common/iExtensionFileWatcher.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost, isRecursiveWatchPattern, toWatcherEvents } from "./extensionHost.ts";

/**
 * In-process тест хендлеров `workspace.watcher.*`: вместо форка субпроцесса
 * гоняем `installHostHandlers` на in-process RPC-паре, а вместо реального
 * chokidar подставляем фейковый {@link IExtensionFileWatcher}, у которого
 * события фаерит сам тест (образец — `extensionHost.fileSystemInProcess.test.ts`).
 */

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
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

/** Фейк наблюдателя: запоминает подписки и даёт тесту выстрелить пачкой. */
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
        fire: (index, changes) => sinks[index](changes),
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

describe("ExtensionHost — watcher'ы расширений (in-process)", () => {
    it("создание watcher'а поднимает слежение, события уезжают субпроцессу", async () => {
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

    it("пустая после фильтрации пачка через границу процесса не едет", async () => {
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

    it("dispose снимает слежение", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: 3, base: "/repo", pattern: "**" });
        await flushMicrotasks();
        peer.notify("workspace.watcher.dispose", { id: 3 });
        await flushMicrotasks();

        expect(watcher.disposed).toEqual([0]);
    });

    it("повторный id пересоздаёт watcher, не оставляя висячей подписки", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: 5, base: "/repo", pattern: "**" });
        await flushMicrotasks();
        peer.notify("workspace.watcher.create", { id: 5, base: "/other", pattern: "**" });
        await flushMicrotasks();

        expect(watcher.disposed).toEqual([0]);
        expect(watcher.calls).toHaveLength(2);
    });

    it("структурно чужие параметры игнорируются", async () => {
        const watcher = makeFakeWatcher();
        const { peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: "нет", base: "/repo", pattern: "**" });
        peer.notify("workspace.watcher.create", { id: 1, base: "", pattern: "**" });
        peer.notify("workspace.watcher.dispose", { id: null });
        await flushMicrotasks();

        expect(watcher.calls).toEqual([]);
        expect(watcher.disposed).toEqual([]);
    });

    it("dispose хоста снимает все живые watcher'ы", async () => {
        const watcher = makeFakeWatcher();
        const { host, peer } = makeHost(watcher);

        peer.notify("workspace.watcher.create", { id: 1, base: "/a", pattern: "**" });
        peer.notify("workspace.watcher.create", { id: 2, base: "/b", pattern: "**" });
        await flushMicrotasks();
        host.dispose();

        expect(watcher.disposed).toEqual([0, 1]);
    });

    it("без переданного наблюдателя watcher'ы создаются, но не стреляют", async () => {
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
    it("односегментный шаблон — только прямые дети", () => {
        expect(isRecursiveWatchPattern("*")).toBe(false);
        expect(isRecursiveWatchPattern("HEAD")).toBe(false);
    });

    it("globstar или разделитель — поддерево", () => {
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

    it("путь матчится относительно базы", () => {
        expect(toWatcherEvents({ ...request, pattern: "src/*.ts" }, [
            { type: "changed", path: "/repo/src/a.ts" },
            { type: "changed", path: "/repo/other/a.ts" },
        ])).toEqual([{ type: "changed", uri: Uri.file("/repo/src/a.ts").toString() }]);
    });

    it("события вне базы и сама база отбрасываются", () => {
        expect(toWatcherEvents(request, [
            { type: "changed", path: "/elsewhere/a.ts" },
            { type: "changed", path: "/repo" },
        ])).toEqual([]);
    });

    it("ignore-флаги режут свой вид событий", () => {
        const changes: ITreeFileChange[] = [
            { type: "created", path: "/repo/a.ts" },
            { type: "changed", path: "/repo/b.ts" },
            { type: "deleted", path: "/repo/c.ts" },
        ];
        expect(
            toWatcherEvents({ ...request, ignoreCreateEvents: true, ignoreDeleteEvents: true }, changes),
        ).toEqual([{ type: "changed", uri: Uri.file("/repo/b.ts").toString() }]);
    });
});

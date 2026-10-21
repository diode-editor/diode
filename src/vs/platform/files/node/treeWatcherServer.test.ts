import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherResponse } from "./treeWatcherProtocol.ts";
import { serveTreeWatcher } from "./treeWatcherServer.ts";

class FakeWatcher implements ITreeFileWatcher {
    public readonly calls: { rootPath: string; options: ITreeFileWatchOptions }[] = [];
    public readonly disposed: number[] = [];
    private readonly sinks: ((changes: readonly ITreeFileChange[]) => void)[] = [];

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const index = this.calls.length;
        this.calls.push({ rootPath, options });
        this.sinks.push(onChanges);
        return {
            dispose: () => {
                this.disposed.push(index);
                // A real traversal is silent after dispose (chokidar closed, coalescing
                // cancelled): the fake must behave the same, otherwise the test below
                // would check a situation that can't happen.
                this.sinks[index] = () => undefined;
            },
        };
    }

    public emit(index: number, changes: readonly ITreeFileChange[]): void {
        this.sinks[index]?.(changes);
    }
}

function setup(): {
    watcher: FakeWatcher;
    sent: ITreeWatcherResponse[];
    post: (raw: unknown) => void;
    server: IDisposable;
} {
    const watcher = new FakeWatcher();
    const sent: ITreeWatcherResponse[] = [];
    let deliver: (message: unknown) => void = () => undefined;
    const server = serveTreeWatcher(
        {
            send: (message) => sent.push(message),
            onMessage: (listener) => {
                deliver = listener;
            },
        },
        watcher,
    );
    return {
        watcher,
        sent,
        post: (raw) => {
            deliver(raw);
        },
        server,
    };
}

const CHANGES: readonly ITreeFileChange[] = [{ type: "changed", path: "/repo/a.ts" }];

describe("serveTreeWatcher", () => {
    it("watch starts a walker with the options received over the wire", () => {
        const { watcher, post } = setup();

        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/out"] } });

        expect(watcher.calls).toEqual([{ rootPath: "/repo", options: { recursive: true, excludes: ["**/out"] } }]);
    });

    it("a walker batch goes back under its request id", () => {
        const { watcher, sent, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "watch", id: 2, rootPath: "/other", options: { recursive: true, excludes: [] } });

        watcher.emit(1, CHANGES);

        expect(sent).toEqual([{ t: "changes", id: 2, changes: CHANGES }]);
    });

    it("unwatch stops its own walker and only it", () => {
        const { watcher, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "watch", id: 2, rootPath: "/other", options: { recursive: true, excludes: [] } });

        post({ t: "unwatch", id: 1 });

        expect(watcher.disposed).toEqual([0]);
    });

    it("after unwatch the batch is no longer sent", () => {
        const { watcher, sent, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "unwatch", id: 1 });

        watcher.emit(0, CHANGES);

        expect(sent).toEqual([]);
    });

    it("a repeated unwatch of an unknown id does not fail", () => {
        const { watcher, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "unwatch", id: 1 });

        expect(() => {
            post({ t: "unwatch", id: 1 });
        }).not.toThrow();
        expect(watcher.disposed).toEqual([0]);
    });

    it("garbage in the channel is ignored instead of starting a walker", () => {
        const { watcher, post } = setup();

        post({ hello: "there" });

        expect(watcher.calls).toEqual([]);
    });

    it("dispose stops all live walkers", () => {
        const { watcher, post, server } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "watch", id: 2, rootPath: "/other", options: { recursive: false, excludes: [] } });

        server.dispose();

        expect(watcher.disposed).toEqual([0, 1]);
    });

    it("a repeated dispose stops nothing a second time", () => {
        const { watcher, post, server } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });

        server.dispose();
        server.dispose();

        expect(watcher.disposed).toEqual([0]);
    });
});

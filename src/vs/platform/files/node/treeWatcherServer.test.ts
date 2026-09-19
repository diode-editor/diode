import type { IDisposable } from "@tuidom/core/common/disposable";
import { describe, expect, it } from "vitest";

import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import type { ITreeWatcherResponse } from "./treeWatcherProtocol.ts";
import { serveTreeWatcher } from "./treeWatcherServer.ts";

/** Watcher, у которого поток событий каждого запроса дёргается тестом руками. */
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
                // Настоящий обход после dispose молчит (chokidar закрыт, коалесинг
                // погашен) — фейк обязан вести себя так же, иначе тест ниже
                // проверял бы несуществующую ситуацию.
                this.sinks[index] = () => undefined;
            },
        };
    }

    /** Отдать пачку подписчику `index`-го обхода. */
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
    it("watch поднимает обход с теми опциями, что пришли по проводу", () => {
        const { watcher, post } = setup();

        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/out"] } });

        expect(watcher.calls).toEqual([{ rootPath: "/repo", options: { recursive: true, excludes: ["**/out"] } }]);
    });

    it("пачка обхода уезжает обратно под id своего запроса", () => {
        const { watcher, sent, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "watch", id: 2, rootPath: "/other", options: { recursive: true, excludes: [] } });

        watcher.emit(1, CHANGES);

        expect(sent).toEqual([{ t: "changes", id: 2, changes: CHANGES }]);
    });

    it("unwatch снимает свой обход и только его", () => {
        const { watcher, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "watch", id: 2, rootPath: "/other", options: { recursive: true, excludes: [] } });

        post({ t: "unwatch", id: 1 });

        expect(watcher.disposed).toEqual([0]);
    });

    it("после unwatch пачка уже не уезжает", () => {
        const { watcher, sent, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "unwatch", id: 1 });

        watcher.emit(0, CHANGES);

        expect(sent).toEqual([]);
    });

    it("повторный unwatch неизвестного id — не падение", () => {
        const { watcher, post } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "unwatch", id: 1 });

        expect(() => {
            post({ t: "unwatch", id: 1 });
        }).not.toThrow();
        expect(watcher.disposed).toEqual([0]);
    });

    it("мусор в канале игнорируется, а не поднимает обход", () => {
        const { watcher, post } = setup();

        post({ hello: "there" });

        expect(watcher.calls).toEqual([]);
    });

    it("dispose снимает все живые обходы", () => {
        const { watcher, post, server } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });
        post({ t: "watch", id: 2, rootPath: "/other", options: { recursive: false, excludes: [] } });

        server.dispose();

        expect(watcher.disposed).toEqual([0, 1]);
    });

    it("повторный dispose ничего не снимает второй раз", () => {
        const { watcher, post, server } = setup();
        post({ t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: [] } });

        server.dispose();
        server.dispose();

        expect(watcher.disposed).toEqual([0]);
    });
});

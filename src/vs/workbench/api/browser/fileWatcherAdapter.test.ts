import { describe, expect, it } from "vitest";

import type { ITreeFileWatcher, ITreeFileWatchOptions } from "../../../platform/files/common/iTreeFileWatcher.ts";

import { FileWatcherAdapter } from "./fileWatcherAdapter.ts";

interface IFakeWatcher extends ITreeFileWatcher {
    readonly calls: { root: string; options: ITreeFileWatchOptions }[];
    disposed: number;
}

function makeWatcher(): IFakeWatcher {
    const fake: IFakeWatcher = {
        calls: [],
        disposed: 0,
        watchTree: (root, options) => {
            fake.calls.push({ root, options });
            return { dispose: () => fake.disposed++ };
        },
    };
    return fake;
}

describe("FileWatcherAdapter", () => {
    it("подмешивает excludes и прокидывает рекурсивность", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(watcher, () => ["**/node_modules/**"]);

        adapter.watch("/repo", true, () => undefined);

        expect(watcher.calls).toEqual([
            { root: "/repo", options: { recursive: true, excludes: ["**/node_modules/**"] } },
        ]);
    });

    it("excludes читаются на каждый watch — настройка живая", () => {
        const watcher = makeWatcher();
        let excludes: string[] = ["a/**"];
        const adapter = new FileWatcherAdapter(watcher, () => excludes);

        adapter.watch("/repo", false, () => undefined);
        excludes = ["b/**"];
        adapter.watch("/repo", false, () => undefined);

        expect(watcher.calls.map((c) => c.options.excludes)).toEqual([["a/**"], ["b/**"]]);
    });

    it("рекурсивный watcher следит и за include-путями под базой, с теми же excludes и колбэком", () => {
        const watcher = makeWatcher();
        const bases: string[] = [];
        const adapter = new FileWatcherAdapter(
            watcher,
            () => ["**/x"],
            (base) => {
                bases.push(base);
                return ["/repo/bazel-out", "/repo/bazel-bin"];
            },
        );
        const onChanges = (): void => undefined;

        const subscription = adapter.watch("/repo", true, onChanges);

        expect(bases).toEqual(["/repo"]);
        expect(watcher.calls).toEqual([
            { root: "/repo", options: { recursive: true, excludes: ["**/x"] } },
            { root: "/repo/bazel-out", options: { recursive: true, excludes: ["**/x"] } },
            { root: "/repo/bazel-bin", options: { recursive: true, excludes: ["**/x"] } },
        ]);
        subscription.dispose();
        expect(watcher.disposed).toBe(3);
    });

    it("нерекурсивному watcher'у include не нужен", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(
            watcher,
            () => [],
            () => ["/repo/bazel-out"],
        );

        adapter.watch("/repo", false, () => undefined);

        expect(watcher.calls.map((c) => c.root)).toEqual(["/repo"]);
    });

    it("disposable отдаётся наружу как есть", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(watcher, () => []);

        adapter.watch("/repo", true, () => undefined).dispose();

        expect(watcher.disposed).toBe(1);
    });
});

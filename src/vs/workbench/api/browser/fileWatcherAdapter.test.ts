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
    it("mixes in excludes and passes recursiveness through", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(watcher, () => ["**/node_modules/**"]);

        adapter.watch("/repo", true, () => undefined);

        expect(watcher.calls).toEqual([
            { root: "/repo", options: { recursive: true, excludes: ["**/node_modules/**"] } },
        ]);
    });

    it("excludes are read on every watch: the setting is live", () => {
        const watcher = makeWatcher();
        let excludes: string[] = ["a/**"];
        const adapter = new FileWatcherAdapter(watcher, () => excludes);

        adapter.watch("/repo", false, () => undefined);
        excludes = ["b/**"];
        adapter.watch("/repo", false, () => undefined);

        expect(watcher.calls.map((c) => c.options.excludes)).toEqual([["a/**"], ["b/**"]]);
    });

    it("recursive watcher also watches include paths under the base, with the same excludes and callback", () => {
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

    it("non-recursive watcher does not need include", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(
            watcher,
            () => [],
            () => ["/repo/bazel-out"],
        );

        adapter.watch("/repo", false, () => undefined);

        expect(watcher.calls.map((c) => c.root)).toEqual(["/repo"]);
    });

    it("disposable is returned as is", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(watcher, () => []);

        adapter.watch("/repo", true, () => undefined).dispose();

        expect(watcher.disposed).toBe(1);
    });
});

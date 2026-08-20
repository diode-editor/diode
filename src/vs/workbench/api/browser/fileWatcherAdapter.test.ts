import { describe, expect, it } from "vitest";

import type { ITreeFileWatchOptions, ITreeFileWatcher } from "../../../platform/files/common/iTreeFileWatcher.ts";

import { FileWatcherAdapter, parseWatcherExclude } from "./fileWatcherAdapter.ts";

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

    it("disposable отдаётся наружу как есть", () => {
        const watcher = makeWatcher();
        const adapter = new FileWatcherAdapter(watcher, () => []);

        adapter.watch("/repo", true, () => undefined).dispose();

        expect(watcher.disposed).toBe(1);
    });
});

describe("parseWatcherExclude", () => {
    it("берёт только включённые шаблоны", () => {
        expect(parseWatcherExclude({ "a/**": true, "b/**": false, "c/**": true })).toEqual(["a/**", "c/**"]);
    });

    it("не-карта даёт пустой набор", () => {
        expect(parseWatcherExclude(undefined)).toEqual([]);
        expect(parseWatcherExclude(null)).toEqual([]);
        expect(parseWatcherExclude(["a/**"])).toEqual([]);
        expect(parseWatcherExclude("a/**")).toEqual([]);
    });

    it("значения кроме true не включают шаблон", () => {
        expect(parseWatcherExclude({ "a/**": 1, "b/**": "yes" })).toEqual([]);
    });
});

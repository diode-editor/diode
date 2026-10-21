import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";
import type { ITreeFileChange, ITreeFileWatcher, ITreeFileWatchOptions } from "../common/iTreeFileWatcher.ts";

import { ChokidarTreeWatcher } from "./chokidarTreeWatcher.ts";
import { SharedTreeWatcher } from "./sharedTreeWatcher.ts";

/** Each delegate `watchTree` is a full traversal and a set of inotify fds in production: tests count exactly these. */
class FakeTreeWatcher implements ITreeFileWatcher {
    public readonly traversals: {
        readonly root: string;
        readonly options: ITreeFileWatchOptions;
        /** Emits the batch as the **same** array: shows whether the layer copied it. */
        readonly emit: (batch: readonly ITreeFileChange[]) => void;
        /** A counter, not a flag: an extra `close()` is a bug and must be visible. */
        disposeCount: number;
    }[] = [];

    public get liveCount(): number {
        return this.traversals.filter((t) => t.disposeCount === 0).length;
    }

    public watchTree(
        rootPath: string,
        options: ITreeFileWatchOptions,
        onChanges: (changes: readonly ITreeFileChange[]) => void,
    ): IDisposable {
        const traversal = {
            root: rootPath,
            options,
            emit: onChanges,
            disposeCount: 0,
        };
        this.traversals.push(traversal);
        return {
            dispose: () => {
                traversal.disposeCount++;
            },
        };
    }
}

function created(...paths: string[]): ITreeFileChange[] {
    return paths.map((path) => ({ type: "created", path }));
}

describe("SharedTreeWatcher — how many walkers are started", () => {
    it("two requests on one root with the same excludes share one walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("a nested request rides on the ancestor's recursive walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src/deep", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/.git", { recursive: false, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("the root is normalized: `/repo/` and `/repo/src/..` share the walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src/..", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("the order of patterns in excludes does not prevent sharing a walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: ["**/a", "**/b"] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: ["**/b", "**/a"] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("different excludes mean different walkers: subscribing to someone else's loses events", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("a recursive request does not ride on a non-recursive walker of the same root", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("two non-recursive requests on one root share one walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("a nested request does not ride on the ancestor's non-recursive walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: false, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: false, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("a sibling subtree gets its own walker, it is not an ancestor", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/srcx", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("a directory with leading dots is inside, not outside", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        // `..foo` starts with `..` but doesn't go up: the prefix is checked at a
        // segment boundary, not by the first two characters.
        shared.watchTree("/repo/..foo", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("a walker on the file system root is shared too", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        // The root is the only path that itself ends with a separator
        // (on Windows it's `C:\`, a far more common case).
        shared.watchTree(path.sep, { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree(path.join(path.sep, "repo"), { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("an ancestor walker started later does not take over existing subscribers", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        // No retroactive subscription moves: the descendant traversal is already live, and
        // tearing it down to save resources would lose events in the gap.
        expect(delegate.traversals).toHaveLength(2);
    });
});

describe("SharedTreeWatcher — excludes and re-anchoring", () => {
    it("a multi-segment pattern forbids sharing a walker with a nested base", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/.git/objects/**"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        // At the root the pattern excludes `/repo/.git/objects`, at `.git` itself it doesn't:
        // subscribing `.git` to the root traversal would silently swallow its events.
        shared.watchTree("/repo/.git", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("the same multi-segment pattern does not prevent sharing when the root matches", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/.git/objects/**"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });

    it("a pattern without `**/` is anchored to the root and forbids sharing too", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["node_modules"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("a base excluded by the ancestor gets its own walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/.git"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        // The root traversal never enters `.git`, so there are simply no events from there.
        shared.watchTree("/repo/.git", { recursive: false, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    it("an excluded directory on the path to the base cancels sharing too", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/vendor"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo/vendor/lib/src", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
    });

    /** `<tmp>/repo` with an `outside` dir next to it; `junction` is a link that needs no admin rights on Windows. */
    function withRepo(run: (repo: string, outside: string) => void): void {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), "diode-shared-link-"));
        const repo = path.join(base, "repo");
        const outside = path.join(base, "outside");
        fs.mkdirSync(path.join(repo, "src"), { recursive: true });
        fs.mkdirSync(path.join(outside, "lib"), { recursive: true });
        try {
            run(repo, outside);
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    }

    it("a symlink base gets its own walker: the ancestor walker does not follow links", () => {
        withRepo((repo, outside) => {
            fs.symlinkSync(outside, path.join(repo, "bazel-out"), "junction");
            const delegate = new FakeTreeWatcher();
            const shared = new SharedTreeWatcher(delegate);

            shared.watchTree(repo, { recursive: true, excludes: [] }, () => undefined);
            shared.watchTree(path.join(repo, "bazel-out"), { recursive: true, excludes: [] }, () => undefined);
            shared.watchTree(path.join(repo, "src"), { recursive: true, excludes: [] }, () => undefined);

            expect(delegate.traversals.map((t) => t.root)).toEqual([repo, path.join(repo, "bazel-out")]);
        });
    });

    it("a symlink on the path to the base cancels sharing too", () => {
        withRepo((repo, outside) => {
            fs.symlinkSync(outside, path.join(repo, "bazel-out"), "junction");
            const delegate = new FakeTreeWatcher();
            const shared = new SharedTreeWatcher(delegate);

            shared.watchTree(repo, { recursive: true, excludes: [] }, () => undefined);
            shared.watchTree(path.join(repo, "bazel-out", "lib"), { recursive: false, excludes: [] }, () => undefined);

            expect(delegate.traversals).toHaveLength(2);
        });
    });

    it("a nested path untouched by excludes shares the walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const excludes = ["**/node_modules", "**/dist"];

        shared.watchTree("/repo", { recursive: true, excludes }, () => undefined);
        shared.watchTree("/repo/packages/core/src", { recursive: true, excludes }, () => undefined);

        expect(delegate.traversals).toHaveLength(1);
    });
});

describe("SharedTreeWatcher — what reaches subscribers", () => {
    it("each subscriber of a shared walker gets its own batch", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const root: ITreeFileChange[][] = [];
        const nested: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, (c) => root.push([...c]));
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => nested.push([...c]));
        delegate.traversals[0].emit(created("/repo/a.ts", "/repo/src/b.ts", "/repo/src/deep/c.ts"));

        expect(root).toEqual([created("/repo/a.ts", "/repo/src/b.ts", "/repo/src/deep/c.ts")]);
        expect(nested).toEqual([created("/repo/src/b.ts", "/repo/src/deep/c.ts")]);
    });

    it("a non-recursive subscriber gets only direct children of the base", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/.git", { recursive: false, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/.git/HEAD", "/repo/.git/refs/heads/main", "/repo/a.ts"));

        expect(batches).toEqual([created("/repo/.git/HEAD")]);
    });

    it("the base itself does not reach the subscriber as an event", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/src", "/repo/src/a.ts"));

        expect(batches).toEqual([created("/repo/src/a.ts")]);
    });

    it("a path above the base does not reach the subscriber", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo", "/repo/srcx/a.ts", "/repo/src/a.ts"));

        expect(batches).toEqual([created("/repo/src/a.ts")]);
    });

    it("a non-recursive request on the walker root also sees only direct children", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo", { recursive: false, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/a.ts", "/repo/src/b.ts"));

        expect(batches).toEqual([created("/repo/a.ts")]);
    });

    it("a batch with nothing for the subscriber does not wake it", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/a.ts"));

        expect(batches).toEqual([]);
    });

    it("the only subscriber of its walker gets the batch without a copy", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: (readonly ITreeFileChange[])[] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, (c) => batches.push(c));
        const batch = created("/repo/a.ts");
        delegate.traversals[0].emit(batch);

        // The same array, not an equal one: the typical case (a traversal for exactly one
        // request) must not pay for filtering.
        expect(batches[0]).toBe(batch);
    });

    it("recursiveness and excludes go to the delegate as requested", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo/.git", { recursive: false, excludes: ["**/x"] }, () => undefined);

        expect(delegate.traversals[0].root).toBe("/repo/.git");
        expect(delegate.traversals[0].options).toEqual({ recursive: false, excludes: ["**/x"] });
    });
});

describe("SharedTreeWatcher — shared walker lifecycle", () => {
    it("one subscriber leaving does not close the walker for the rest", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        first.dispose();
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(delegate.liveCount).toBe(1);
        expect(batches).toEqual([created("/repo/src/a.ts")]);
    });

    it("the last subscriber leaving closes the walker", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        const second = shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        first.dispose();
        second.dispose();

        expect(delegate.liveCount).toBe(0);
    });

    it("an unsubscribed listener gets no more events", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        const second = shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        second.dispose();
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(batches).toEqual([]);
    });

    it("a repeated dispose does not close the walker a second time", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        const subscription = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        subscription.dispose();
        subscription.dispose();

        expect(delegate.traversals[0].disposeCount).toBe(1);
    });

    it("a repeated dispose does not remove another subscription", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        first.dispose();
        const second = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        first.dispose();

        expect(delegate.liveCount).toBe(1);
        second.dispose();
        expect(delegate.liveCount).toBe(0);
    });

    it("a closed walker is not reused; the next request starts a new one", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined).dispose();
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);

        expect(delegate.traversals).toHaveLength(2);
        expect(delegate.traversals[1].root).toBe("/repo/src");
    });

    it("dispose from a callback does not break delivery to the rest", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        const first = shared.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            first.dispose();
        });
        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(batches).toEqual([created("/repo/src/a.ts")]);
        expect(delegate.liveCount).toBe(1);
    });

    it("a subscriber disposed by a sibling no longer gets the batch", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const batches: ITreeFileChange[][] = [];

        // The first in the dispatch queue removes the second: the batch must not reach the
        // second, even though the subscriber list snapshot still holds it.
        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            second.dispose();
        });
        const second = shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => batches.push([...c]));
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(batches).toEqual([]);
    });

    it("a subscription from a callback does not get the batch already being delivered", () => {
        const delegate = new FakeTreeWatcher();
        const shared = new SharedTreeWatcher(delegate);
        const late: ITreeFileChange[][] = [];

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => {
            shared.watchTree("/repo/src", { recursive: true, excludes: [] }, (c) => late.push([...c]));
        });
        delegate.traversals[0].emit(created("/repo/src/a.ts"));

        expect(delegate.traversals).toHaveLength(1);
        expect(late).toEqual([]);
    });
});

describe("SharedTreeWatcher — log", () => {
    it("walker reuse shows in the files.watcher channel", () => {
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({
            append: (entry) => entries.push(entry),
            dispose: () => undefined,
        });
        const shared = new SharedTreeWatcher(new FakeTreeWatcher(), logService.createLogger("files.watcher"));

        shared.watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        expect(entries).toEqual([]);

        shared.watchTree("/repo/src", { recursive: true, excludes: [] }, () => undefined);
        expect(entries.at(-1)?.message).toContain("reusing");
        // Without the "whose traversal" / "who was subscribed" pair the line diagnoses nothing.
        expect(entries.at(-1)?.args).toEqual([{ root: "/repo", base: "/repo/src" }]);
    });
});

describe("SharedTreeWatcher — real chokidar", () => {
    it("a shared walker delivers events to both a nested and a non-recursive request", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-shared-watch-"));
        fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
        const shared = new SharedTreeWatcher(new ChokidarTreeWatcher());
        const all: string[] = [];
        const nested: string[] = [];
        const subscriptions = [
            shared.watchTree(root, { recursive: true, excludes: [] }, (c) => all.push(...c.map((x) => x.path))),
            shared.watchTree(path.join(root, "src"), { recursive: false, excludes: [] }, (c) =>
                nested.push(...c.map((x) => x.path)),
            ),
        ];
        try {
            // Before `ready` chokidar treats what it finds as initial state and, with
            // `ignoreInitial`, swallows it, so wait.
            await new Promise((resolve) => setTimeout(resolve, 400));

            fs.writeFileSync(path.join(root, "top.ts"), "x");
            fs.writeFileSync(path.join(root, "src", "a.ts"), "y");
            fs.writeFileSync(path.join(root, "src", "deep", "b.ts"), "z");
            await new Promise((resolve) => setTimeout(resolve, 800));

            expect(all).toEqual(
                expect.arrayContaining([
                    path.join(root, "top.ts"),
                    path.join(root, "src", "a.ts"),
                    path.join(root, "src", "deep", "b.ts"),
                ]),
            );
            expect(nested).toContain(path.join(root, "src", "a.ts"));
            expect(nested).not.toContain(path.join(root, "top.ts"));
            expect(nested).not.toContain(path.join(root, "src", "deep", "b.ts"));
        } finally {
            for (const subscription of subscriptions) subscription.dispose();
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 20000);

    it("an explicit request on a directory symlink sees its events, the root walker does not", async () => {
        const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-shared-link-")));
        const root = path.join(base, "repo");
        const outside = path.join(base, "outside");
        fs.mkdirSync(path.join(root, "src"), { recursive: true });
        fs.mkdirSync(outside);
        const link = path.join(root, "bazel-out");
        fs.symlinkSync(outside, link, "junction");
        const shared = new SharedTreeWatcher(new ChokidarTreeWatcher());
        const all: string[] = [];
        const linked: string[] = [];
        const subscriptions = [
            shared.watchTree(root, { recursive: true, excludes: [] }, (c) => all.push(...c.map((x) => x.path))),
            shared.watchTree(link, { recursive: true, excludes: [] }, (c) => linked.push(...c.map((x) => x.path))),
        ];
        try {
            await new Promise((resolve) => setTimeout(resolve, 400));

            fs.writeFileSync(path.join(outside, "BUILD.bazel"), "x");
            fs.writeFileSync(path.join(root, "src", "a.ts"), "y");
            await new Promise((resolve) => setTimeout(resolve, 800));

            expect(linked).toEqual([path.join(link, "BUILD.bazel")]);
            expect(all).toEqual([path.join(root, "src", "a.ts")]);
        } finally {
            for (const subscription of subscriptions) subscription.dispose();
            fs.rmSync(base, { recursive: true, force: true });
        }
    }, 20000);
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { watcherIncludesUnder } from "./watcherIncludes.ts";

/** `junction` is a link that needs no admin rights on Windows. */
let base: string;
let ws: string;

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-watcher-include-")));
    ws = path.join(base, "ws");
    const cache = path.join(base, "cache");
    fs.mkdirSync(path.join(ws, "src"), { recursive: true });
    fs.mkdirSync(path.join(cache, "lib"), { recursive: true });
    fs.symlinkSync(cache, path.join(ws, "bazel-out"), "junction");
    fs.symlinkSync(cache, path.join(ws, "src", "gen"), "junction");
});

afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
});

describe("watcherIncludesUnder", () => {
    it("a relative path is joined to the workspace folder", () => {
        expect(watcherIncludesUnder(ws, ["bazel-out"], [ws])).toEqual([path.join(ws, "bazel-out")]);
    });

    it("an absolute path is accepted inside the workspace folder", () => {
        const link = path.join(ws, "bazel-out");
        expect(watcherIncludesUnder(ws, [link], [ws])).toEqual([link]);
    });

    it("an absolute path outside the workspace is dropped, as upstream", () => {
        const outsideLink = path.join(base, "outside-link");
        fs.symlinkSync(path.join(base, "cache"), outsideLink, "junction");
        expect(watcherIncludesUnder(base, [outsideLink], [ws])).toEqual([]);
    });

    it("an absolute path only needs to be in one of the workspace folders", () => {
        const other = path.join(base, "other");
        fs.mkdirSync(other);
        const link = path.join(ws, "bazel-out");
        expect(watcherIncludesUnder(ws, [link], [other, ws])).toEqual([link]);
    });

    it("an ancestor of a workspace folder is not inside it", () => {
        const folder = path.join(ws, "bazel-out", "lib");
        expect(watcherIncludesUnder(ws, [path.join(ws, "bazel-out")], [folder])).toEqual([]);
    });

    it("a path behind a link deeper than the first segment is taken too", () => {
        expect(watcherIncludesUnder(ws, ["src/gen/lib"], [ws])).toEqual([path.join(ws, "src", "gen", "lib")]);
    });

    it("a regular directory is not taken: the base walk already sees it, a second watch would duplicate events", () => {
        expect(watcherIncludesUnder(ws, ["src"], [ws])).toEqual([]);
    });

    it("a path outside the watcher base is not its concern", () => {
        expect(watcherIncludesUnder(path.join(ws, "src"), ["bazel-out"], [ws])).toEqual([]);
    });

    it("a path equal to the base is not added — the base is already watched", () => {
        const link = path.join(ws, "bazel-out");
        expect(watcherIncludesUnder(link, ["bazel-out"], [ws])).toEqual([]);
    });

    it("inside a link base the path is measured from the base itself", () => {
        // The base is the link itself, the watcher resolves its root; `lib` behind it is a plain directory.
        expect(watcherIncludesUnder(path.join(ws, "bazel-out"), ["bazel-out/lib"], [ws])).toEqual([]);
    });

    it("the same path written twice gives one watch", () => {
        expect(watcherIncludesUnder(ws, ["bazel-out", path.join(ws, "bazel-out")], [ws])).toEqual([
            path.join(ws, "bazel-out"),
        ]);
    });

    it("a broken setting and empty/non-string items give no include", () => {
        expect(watcherIncludesUnder(ws, "bazel-out", [ws])).toEqual([]);
        expect(watcherIncludesUnder(ws, 42, [ws])).toEqual([]);
        expect(watcherIncludesUnder(ws, undefined, [ws])).toEqual([]);
        expect(watcherIncludesUnder(ws, ["", 42, null], [ws])).toEqual([]);
    });

    it("without workspace folders a relative path has nothing to join to", () => {
        expect(watcherIncludesUnder(ws, ["bazel-out"], [])).toEqual([]);
    });

    it("a nonexistent path is not a link and is not added", () => {
        expect(watcherIncludesUnder(ws, ["missing/deeper"], [ws])).toEqual([]);
    });

    it("a directory with leading dots lies inside, not outside", () => {
        fs.symlinkSync(path.join(base, "cache"), path.join(ws, "..gen"), "junction");
        expect(watcherIncludesUnder(ws, [path.join(ws, "..gen")], [ws])).toEqual([path.join(ws, "..gen")]);
    });
});

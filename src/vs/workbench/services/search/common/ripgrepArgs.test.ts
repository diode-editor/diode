import { describe, expect, it } from "vitest";

import { anchorRgGlob, buildRgFilesArgs, rgExcludeArgs, rgIgnoreFilesArgs } from "./ripgrepArgs.ts";

const DEFAULTS = { local: true, parent: false, global: false } as const;

describe("anchorRgGlob", () => {
    it("a pattern without `**` and `/` is anchored to the root, like `isExcludedPath`, not at any depth", () => {
        expect(anchorRgGlob("out")).toBe("/out");
        expect(anchorRgGlob("src/*.js")).toBe("/src/*.js");
    });

    it("leaves a `**` pattern and an already anchored one alone", () => {
        expect(anchorRgGlob("**/node_modules")).toBe("**/node_modules");
        expect(anchorRgGlob("/dist")).toBe("/dist");
    });
});

describe("rgExcludeArgs", () => {
    it("each pattern becomes `--glob !<anchored>`", () => {
        expect(rgExcludeArgs(["**/.git", "out"])).toEqual(["--glob", "!**/.git", "--glob", "!/out"]);
    });

    it("a trailing `/` is stripped, empty patterns are skipped", () => {
        expect(rgExcludeArgs(["build/", "", "/"])).toEqual(["--glob", "!/build"]);
    });

    it("a tail of several `/` is stripped entirely", () => {
        expect(rgExcludeArgs(["out//", "//"])).toEqual(["--glob", "!/out"]);
    });
});

describe("rgIgnoreFilesArgs", () => {
    it("upstream defaults: own ignore files yes, parent and global no", () => {
        expect(rgIgnoreFilesArgs(DEFAULTS)).toEqual([
            "--no-require-git",
            "--no-config",
            "--no-ignore-parent",
            "--no-ignore-global",
        ]);
    });

    it("parent and global are enabled separately", () => {
        expect(rgIgnoreFilesArgs({ local: true, parent: true, global: false })).toEqual([
            "--no-require-git",
            "--no-config",
            "--no-ignore-global",
        ]);
        expect(rgIgnoreFilesArgs({ local: true, parent: false, global: true })).toEqual([
            "--no-require-git",
            "--no-config",
            "--no-ignore-parent",
        ]);
    });

    it("local: false gives `--no-ignore`, and parent/global no longer mean anything", () => {
        expect(rgIgnoreFilesArgs({ local: false, parent: true, global: true })).toEqual([
            "--no-require-git",
            "--no-config",
            "--no-ignore",
        ]);
    });
});

describe("buildRgFilesArgs", () => {
    it("`--files --hidden`, excludes and ignore-file flags", () => {
        expect(buildRgFilesArgs(["**/node_modules"], DEFAULTS)).toEqual([
            "--files",
            "--hidden",
            "--glob",
            "!**/node_modules",
            "--no-require-git",
            "--no-config",
            "--no-ignore-parent",
            "--no-ignore-global",
        ]);
    });
});

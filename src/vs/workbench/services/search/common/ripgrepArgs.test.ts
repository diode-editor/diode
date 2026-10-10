import { describe, expect, it } from "vitest";

import { anchorRgGlob, buildRgFilesArgs, rgExcludeArgs, rgIgnoreFilesArgs } from "./ripgrepArgs.ts";

const DEFAULTS = { local: true, parent: false, global: false } as const;

describe("anchorRgGlob", () => {
    it("шаблон без `**` и `/` якорится к корню — как `isExcludedPath`, а не на любой глубине", () => {
        expect(anchorRgGlob("out")).toBe("/out");
        expect(anchorRgGlob("src/*.js")).toBe("/src/*.js");
    });

    it("`**`-шаблон и уже якорёный не трогает", () => {
        expect(anchorRgGlob("**/node_modules")).toBe("**/node_modules");
        expect(anchorRgGlob("/dist")).toBe("/dist");
    });
});

describe("rgExcludeArgs", () => {
    it("каждый шаблон — `--glob !<якорёный>`", () => {
        expect(rgExcludeArgs(["**/.git", "out"])).toEqual(["--glob", "!**/.git", "--glob", "!/out"]);
    });

    it("хвостовой `/` срезается, пустые шаблоны пропускаются", () => {
        expect(rgExcludeArgs(["build/", "", "/"])).toEqual(["--glob", "!/build"]);
    });

    it("хвост из нескольких `/` срезается целиком", () => {
        expect(rgExcludeArgs(["out//", "//"])).toEqual(["--glob", "!/out"]);
    });
});

describe("rgIgnoreFilesArgs", () => {
    it("дефолты эталона: свои ignore-файлы — да, родительские и глобальный — нет", () => {
        expect(rgIgnoreFilesArgs(DEFAULTS)).toEqual([
            "--no-require-git",
            "--no-config",
            "--no-ignore-parent",
            "--no-ignore-global",
        ]);
    });

    it("parent и global включаются по отдельности", () => {
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

    it("local: false — `--no-ignore`, и parent/global уже ничего не значат", () => {
        expect(rgIgnoreFilesArgs({ local: false, parent: true, global: true })).toEqual([
            "--no-require-git",
            "--no-config",
            "--no-ignore",
        ]);
    });
});

describe("buildRgFilesArgs", () => {
    it("`--files --hidden`, исключения и флаги ignore-файлов", () => {
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

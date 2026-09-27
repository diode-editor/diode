import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { CliArgsError, parseCliArgs } from "./cliArgs.ts";
import { resolveStartupTargets } from "./startupTargets.ts";

/** Порт к FS: перечисленные пути — папки, всё остальное — файлы. */
function dirsAre(...dirs: string[]): (p: string) => boolean {
    const set = new Set(dirs.map((d) => path.resolve(d)));
    return (p) => set.has(p);
}

const noDirs = dirsAre();
const abs = (p: string): string => path.resolve(p);

describe("resolveStartupTargets", () => {
    it("gives an empty window when there are no positionals", () => {
        expect(resolveStartupTargets(parseCliArgs([]), noDirs)).toEqual({
            folder: undefined,
            files: [],
            diff: undefined,
        });
    });

    it("opens the first positional as the workspace folder", () => {
        const targets = resolveStartupTargets(parseCliArgs(["src", "a.ts"]), dirsAre("src"));
        expect(targets.folder).toBe(abs("src"));
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("leaves the window folderless when the first positional is a file", () => {
        // `diode a.ts src` — как в VS Code: папкой становится только ПЕРВЫЙ
        // аргумент, остальные директории просто не открываются.
        const targets = resolveStartupTargets(parseCliArgs(["a.ts", "src"]), dirsAre("src"));
        expect(targets.folder).toBeUndefined();
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("resolves relative paths to absolute", () => {
        const targets = resolveStartupTargets(parseCliArgs(["./a.ts"]), noDirs);
        expect(targets.files).toEqual([{ path: path.resolve("./a.ts") }]);
    });

    it("keeps a colon in the path when --goto was not given", () => {
        const targets = resolveStartupTargets(parseCliArgs(["weird:10"]), noDirs);
        expect(targets.files).toEqual([{ path: abs("weird:10") }]);
    });
});

describe("resolveStartupTargets — --goto", () => {
    it("splits file:line", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "a.ts:42"]), noDirs);
        expect(targets.files).toEqual([{ path: abs("a.ts"), line: 42 }]);
    });

    it("splits file:line:column", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "a.ts:42:7"]), noDirs);
        expect(targets.files).toEqual([{ path: abs("a.ts"), line: 42, column: 7 }]);
    });

    it("accepts a plain path without a suffix", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "a.ts"]), noDirs);
        expect(targets.files).toEqual([{ path: abs("a.ts") }]);
    });

    it("still honours a leading directory", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-g", "src", "a.ts:3"]), dirsAre("src"));
        expect(targets.folder).toBe(abs("src"));
        expect(targets.files).toEqual([{ path: abs("a.ts"), line: 3 }]);
    });

    it("throws when the suffix eats the whole argument", () => {
        expect(() => resolveStartupTargets(parseCliArgs(["-g", ":10"]), noDirs)).toThrow(CliArgsError);
        expect(() => resolveStartupTargets(parseCliArgs(["-g", ":10"]), noDirs)).toThrow(
            /file\[:line\[:column\]\], got: :10/,
        );
    });
});

describe("resolveStartupTargets — --diff", () => {
    it("returns both sides and opens no folder", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-d", "a.ts", "b.ts"]), noDirs);
        expect(targets.diff).toEqual({ original: abs("a.ts"), modified: abs("b.ts") });
        expect(targets.folder).toBeUndefined();
        expect(targets.files).toEqual([]);
    });

    it("does not turn a directory side into a workspace folder", () => {
        const targets = resolveStartupTargets(parseCliArgs(["-d", "src", "b.ts"]), dirsAre("src"));
        expect(targets.folder).toBeUndefined();
        expect(targets.diff).toEqual({ original: abs("src"), modified: abs("b.ts") });
    });
});

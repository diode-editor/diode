import { symlinkSync } from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";
import { parseSearchFieldGlobs } from "../common/textSearch.ts";

import { TextSearchService } from "./textSearchService.ts";

/**
 * `buildRgArgs` unit tests check the arguments, not how rg interprets them: the bug
 * "`"common": true` in `files.exclude` hides `nci/common/**`" passed them green. The query
 * is built as in the Search view: setting globs are root-relative, fields go through {@link parseSearchFieldGlobs}.
 */

const NEEDLE = "needle";

/** Fixture files containing {@link NEEDLE}. `ignored/` is covered by `.gitignore`, `linked` is a symlink to `nci`. */
const FILES = [
    ".hidden/h.txt",
    "build.log",
    "common/a.txt",
    "ignored/i.txt",
    "nci/build.log",
    "nci/common/ydb/T.java",
    "nci/tsunami/S.java",
    "src/app.css",
    "src/app.js",
    "src/app.ts",
    "src/common/x.ts",
];

/** What a search without globs finds: everything except `.gitignore`d files (and the symlink). */
const VISIBLE = FILES.filter((f) => !f.startsWith("ignored/"));

function without(...excluded: string[]): string[] {
    return VISIBLE.filter((f) => !excluded.includes(f));
}

interface ISearchSpec {
    /** `files.exclude` + `search.exclude`: root-relative globs. */
    settings?: string[];
    include?: string;
    exclude?: string;
    useIgnoreFiles?: IUseIgnoreFiles;
}

// A root with a space and `+`, like a `users+name+TICKET` worktree: the `/x` anchor
// is relative to the search root, and special characters in its path must not interfere.
describe("TextSearchService: какие файлы находит поиск (настоящий rg, корень `diode glob+root`)", () => {
    let ws: ITempWorkspace;
    let service: TextSearchService;

    beforeAll(() => {
        ws = createTempWorkspace({ prefix: "diode glob+root+" });
        for (const file of FILES) ws.writeFile(file, `${NEEDLE}\n`);
        ws.writeFile(".gitignore", "ignored/\n");
        // Like `bazel-<worktree name>` in a monorepo: a symlink to a directory inside the root.
        if (process.platform !== "win32") symlinkSync(ws.path("nci"), ws.path("linked"), "dir");
        service = new TextSearchService();
    });

    afterAll(() => {
        service.dispose();
        ws.dispose();
    });

    async function found(spec: ISearchSpec): Promise<string[]> {
        const files: string[] = [];
        const complete = await service.search(
            {
                pattern: NEEDLE,
                isRegExp: false,
                isCaseSensitive: false,
                isWholeWord: false,
                includes: parseSearchFieldGlobs(spec.include ?? ""),
                excludes: [...(spec.settings ?? []), ...parseSearchFieldGlobs(spec.exclude ?? "")],
                useIgnoreFiles: spec.useIgnoreFiles ?? { local: true, parent: false, global: false },
            },
            ws.dir,
            (match) => files.push(path.relative(ws.dir, match.absolutePath).replace(/\\/gu, "/")),
        ).complete;
        expect(complete.error).toBeUndefined();
        return files.sort();
    }

    it("без шаблонов — все файлы, включая скрытые; `.gitignore` уважается", async () => {
        expect(await found({})).toEqual(VISIBLE);
    });

    it("`search.useIgnoreFiles: false` — находит и `.gitignore`-нутое", async () => {
        expect(await found({ useIgnoreFiles: { local: false, parent: false, global: false } })).toEqual(FILES);
    });

    it.skipIf(process.platform === "win32")("в симлинк на каталог не заходит (как `bazel-*` в монорепе)", async () => {
        expect((await found({})).filter((f) => f.startsWith("linked/"))).toEqual([]);
    });

    describe("шаблоны настроек — от корня", () => {
        it.each<[string[], string[]]>([
            // Regression: a monorepo hides the root `/common`, and `nci/common/**` vanished with it.
            [["common"], without("common/a.txt")],
            [["common/"], without("common/a.txt")],
            [["common/**"], without("common/a.txt")],
            [["/common"], without("common/a.txt")],
            [["**/common"], without("common/a.txt", "nci/common/ydb/T.java", "src/common/x.ts")],
            [["nci/common"], without("nci/common/ydb/T.java")],
            [["*.log"], without("build.log")],
            [["**/*.log"], without("build.log", "nci/build.log")],
            [["common", "nci/tsunami"], without("common/a.txt", "nci/tsunami/S.java")],
        ])("%j", async (settings, expected) => {
            expect(await found({ settings })).toEqual(expected);
        });
    });

    describe("поле «files to exclude» — на любой глубине", () => {
        it.each<[string, string[]]>([
            ["common", without("common/a.txt", "nci/common/ydb/T.java", "src/common/x.ts")],
            ["common/", without("common/a.txt", "nci/common/ydb/T.java", "src/common/x.ts")],
            ["nci/common", without("nci/common/ydb/T.java")],
            [".log", without("build.log", "nci/build.log")],
            ["*.{ts,js}", without("src/app.js", "src/app.ts", "src/common/x.ts")],
            ["./common", without("common/a.txt")],
            [
                "common, .log",
                without("build.log", "common/a.txt", "nci/build.log", "nci/common/ydb/T.java", "src/common/x.ts"),
            ],
        ])("%j", async (exclude, expected) => {
            expect(await found({ exclude })).toEqual(expected);
        });
    });

    describe("поле «files to include» — на любой глубине", () => {
        it.each<[string, string[]]>([
            ["common", ["common/a.txt", "nci/common/ydb/T.java", "src/common/x.ts"]],
            ["nci/common", ["nci/common/ydb/T.java"]],
            ["*.ts", ["src/app.ts", "src/common/x.ts"]],
            [".java", ["nci/common/ydb/T.java", "nci/tsunami/S.java"]],
            ["*.{ts,js}", ["src/app.js", "src/app.ts", "src/common/x.ts"]],
            ["./nci", ["nci/build.log", "nci/common/ydb/T.java", "nci/tsunami/S.java"]],
            [
                "./src, *.log",
                ["build.log", "nci/build.log", "src/app.css", "src/app.js", "src/app.ts", "src/common/x.ts"],
            ],
            // `.` is the whole root, and `.gitignore` is still honored
            [".", VISIBLE],
        ])("%j", async (include, expected) => {
            expect(await found({ include })).toEqual(expected);
        });
    });

    describe("наборы вместе", () => {
        it("include и exclude из полей: `./src` без `common`", async () => {
            expect(await found({ include: "./src", exclude: "common" })).toEqual([
                "src/app.css",
                "src/app.js",
                "src/app.ts",
            ]);
        });

        it("настройка режет и то, что подходит под include", async () => {
            expect(await found({ settings: ["src/common"], include: "*.ts" })).toEqual(["src/app.ts"]);
        });

        it("настройка от корня + поле на любой глубине", async () => {
            expect(await found({ settings: ["common"], exclude: ".log" })).toEqual(
                without("build.log", "common/a.txt", "nci/build.log"),
            );
        });
    });
});

import { symlinkSync } from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";
import { parseSearchFieldGlobs } from "../common/textSearch.ts";

import { TextSearchService } from "./textSearchService.ts";

/**
 * Какие файлы находит поиск по содержимому — на настоящем ripgrep и настоящем
 * дереве. Юнит-тесты на `buildRgArgs` проверяют аргументы, а не то, как их
 * понимает rg: баг «`"common": true` в `files.exclude` прячет `nci/common/**`»
 * был зелёным по ним. Здесь каждая строка — «шаблоны → набор найденных файлов».
 *
 * Запрос собирается так же, как его собирает Search view: шаблоны настроек как
 * есть, поля — через {@link parseSearchFieldGlobs}. Семантика — эталона:
 * шаблон настройки от корня, набранное в поле — на любой глубине.
 */

const NEEDLE = "needle";

/** Файлы фикстуры с {@link NEEDLE}. `ignored/` закрыт `.gitignore`, `linked` — симлинк на `nci`. */
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

/** Что находит поиск без шаблонов: всё, кроме `.gitignore`-нутого (и симлинка). */
const VISIBLE = FILES.filter((f) => !f.startsWith("ignored/"));

function without(...excluded: string[]): string[] {
    return VISIBLE.filter((f) => !excluded.includes(f));
}

interface ISearchSpec {
    /** `files.exclude` + `search.exclude` — шаблоны от корня. */
    settings?: string[];
    /** Текст поля «files to include». */
    include?: string;
    /** Текст поля «files to exclude». */
    exclude?: string;
    useIgnoreFiles?: IUseIgnoreFiles;
}

// Корень с пробелом и `+`, как у worktree `users+name+TICKET`: якорь `/x`
// отсчитывается от корня поиска, и спецсимволы в его пути не должны мешать.
describe("TextSearchService: какие файлы находит поиск (настоящий rg, корень `diode glob+root`)", () => {
    let ws: ITempWorkspace;
    let service: TextSearchService;

    beforeAll(() => {
        ws = createTempWorkspace({ prefix: "diode glob+root+" });
        for (const file of FILES) ws.writeFile(file, `${NEEDLE}\n`);
        ws.writeFile(".gitignore", "ignored/\n");
        // Как `bazel-<имя worktree>` в монорепе: симлинк на каталог внутри корня.
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
            // Регрессия: монорепа прячет корневой `/common`, а с ним пропадал `nci/common/**`.
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
            // `.` — весь корень, и `.gitignore` по-прежнему уважается
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

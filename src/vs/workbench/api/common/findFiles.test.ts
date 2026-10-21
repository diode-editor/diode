import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { findFiles, type IFindFilesEntry, type IFindFilesScanner } from "./findFiles.ts";

/** The directory isn't in the map: an empty list, like the real scanner on a directory without permissions. */
function scannerFromTree(tree: Record<string, readonly string[]>): IFindFilesScanner & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        readDirectory: (absolutePath: string): Promise<readonly IFindFilesEntry[]> => {
            reads.push(absolutePath);
            const names = tree[absolutePath] ?? [];
            // Map convention: a name ending in `/` is a directory.
            return Promise.resolve(
                names.map((name) => ({ name: name.replace(/\/$/u, ""), isDirectory: name.endsWith("/") })),
            );
        },
    };
}

const ROOT = path.join(path.sep, "ws");
const at = (...segments: string[]): string => path.join(ROOT, ...segments);

/** A maven multi-module tree: what `redhat.java` actually searches for. */
const MAVEN_TREE: Record<string, readonly string[]> = {
    [ROOT]: ["pom.xml", "README.md", "core/", "web/", ".git/", "node_modules/"],
    [at("core")]: ["pom.xml", "src/"],
    [at("core", "src")]: ["App.java", "Util.java"],
    [at("web")]: ["pom.xml", "target/"],
    [at("web", "target")]: ["classes/"],
    [at("web", "target", "classes")]: ["App.class"],
    [at(".git")]: ["config"],
    [at("node_modules")]: ["pom.xml"],
};

describe("findFiles — матчинг шаблона", () => {
    it("рекурсивный шаблон собирает все совпадения по дереву", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            excludes: [],
        });
        expect(found.toSorted()).toEqual(["core/pom.xml", "node_modules/pom.xml", "pom.xml", "web/pom.xml"]);
    });

    it("шаблон без `**` якорится по числу сегментов", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "*/pom.xml",
            excludes: [],
        });
        // The root `pom.xml` doesn't match: it has no leading segment.
        expect(found.toSorted()).toEqual(["core/pom.xml", "node_modules/pom.xml", "web/pom.xml"]);
    });

    it("альтернативы `{a,b}` — как у сборочных файлов redhat.java", async () => {
        const found = await findFiles(
            scannerFromTree({
                [ROOT]: ["build.gradle", "settings.gradle.kts", "pom.xml", "notes.txt"],
            }),
            { base: ROOT, include: "**/{pom.xml,build.gradle,settings.gradle.kts}", excludes: [] },
        );
        expect(found.toSorted()).toEqual(["build.gradle", "pom.xml", "settings.gradle.kts"]);
    });

    it("каталог под шаблон не попадает — ищем файлы", async () => {
        const found = await findFiles(scannerFromTree({ [ROOT]: ["target/", "targetFile"], [at("target")]: [] }), {
            base: ROOT,
            include: "**/target*",
            excludes: [],
        });
        expect(found).toEqual(["targetFile"]);
    });

    it("пустое дерево — пустой результат", async () => {
        const found = await findFiles(scannerFromTree({}), { base: ROOT, include: "**/pom.xml", excludes: [] });
        expect(found).toEqual([]);
    });
});

describe("findFiles — глубина обхода", () => {
    it("шаблон без `**` не читает каталоги глубже своего числа сегментов", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        await findFiles(scanner, { base: ROOT, include: "*.java", excludes: [] });
        // `*.java` lives only at the root, so there's no need to descend.
        expect(scanner.reads).toEqual([ROOT]);
    });

    it("шаблон с `**` спускается до дна", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, { base: ROOT, include: "**/*.class", excludes: [] });
        expect(found).toEqual(["web/target/classes/App.class"]);
        expect(scanner.reads).toContain(at("web", "target", "classes"));
    });
});

describe("findFiles — исключения", () => {
    it("набор шаблонов срезает каждый свой каталог целиком", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            excludes: ["**/.git", "**/node_modules"],
        });
        expect(found.toSorted()).toEqual(["core/pom.xml", "pom.xml", "web/pom.xml"]);
        // Not just filtered out of the result: the walk never entered the excluded directory.
        expect(scanner.reads).not.toContain(at("node_modules"));
        expect(scanner.reads).not.toContain(at(".git"));
    });

    it("шаблоны набора независимы: совпал любой — вход отброшен", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            excludes: ["**/node_modules", "**/web"],
        });
        expect(found.toSorted()).toEqual(["core/pom.xml", "pom.xml"]);
    });

    it("явный шаблон `**/<каталог>/**` даёт тот же результат через отсев файлов", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            excludes: ["**/node_modules/**"],
        });
        expect(found).not.toContain("node_modules/pom.xml");
        // This form doesn't match the directory itself, so the walk enters it.
        expect(scanner.reads).toContain(at("node_modules"));
    });

    it("пустой набор не исключает ничего", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            excludes: [],
        });
        expect(found).toContain("node_modules/pom.xml");
    });

    it("пустая строка исключения не совпадает ни с чем (её шлёт redhat.java)", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            excludes: [""],
        });
        expect(found).toContain("node_modules/pom.xml");
    });
});

describe("findFiles — границы результата", () => {
    it("maxResults обрывает поиск ровно на границе", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            excludes: [],
            maxResults: 1,
        });
        // Breadth-first walk: the match closest to the root is found first.
        expect(found).toEqual(["pom.xml"]);
    });

    it("maxResults: 0 — пустой ответ без единого чтения каталога", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            excludes: [],
            maxResults: 0,
        });
        expect(found).toEqual([]);
        expect(scanner.reads).toEqual([]);
    });

    it("бюджет каталогов обрывает обход гигантского дерева", async () => {
        // A chain of directories 50 deep; the match is at the very bottom.
        const deep: Record<string, string[]> = {};
        let dir = ROOT;
        for (let i = 0; i < 50; i++) {
            const child = `d${i}`;
            deep[dir] = [`${child}/`];
            dir = path.join(dir, child);
        }
        deep[dir] = ["pom.xml"];

        const scanner = scannerFromTree(deep);
        const found = await findFiles(
            scanner,
            { base: ROOT, include: "**/pom.xml", excludes: [] },
            { maxDirectories: 10 },
        );
        expect(found).toEqual([]);
        expect(scanner.reads.length).toBe(10);
    });

    it("отмена обрывает обход и отдаёт уже найденное", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        let cancelled = false;
        const found = await findFiles(
            scanner,
            { base: ROOT, include: "**/pom.xml", excludes: [] },
            {
                isCancelled: () => {
                    // Read the root, then cancel.
                    const now = cancelled;
                    cancelled = true;
                    return now;
                },
            },
        );
        expect(found).toEqual(["pom.xml"]);
        expect(scanner.reads).toEqual([ROOT]);
    });
});

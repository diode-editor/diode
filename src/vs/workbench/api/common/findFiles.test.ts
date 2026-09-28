import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
    createNodeFindFilesScanner,
    DEFAULT_FIND_FILES_EXCLUDE,
    findFiles,
    type IFindFilesEntry,
    type IFindFilesScanner,
} from "./findFiles.ts";

/**
 * Обход по карте каталогов в памяти: ключ — абсолютный путь, значение — записи.
 * Каталог, которого в карте нет, отвечает пустым списком — так же ведёт себя
 * настоящий сканер на каталоге без прав доступа.
 */
function scannerFromTree(tree: Record<string, readonly string[]>): IFindFilesScanner & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        readDirectory: (absolutePath: string): Promise<readonly IFindFilesEntry[]> => {
            reads.push(absolutePath);
            const names = tree[absolutePath] ?? [];
            // Соглашение карты: имя с `/` на конце — каталог.
            return Promise.resolve(
                names.map((name) => ({ name: name.replace(/\/$/u, ""), isDirectory: name.endsWith("/") })),
            );
        },
    };
}

const ROOT = path.join(path.sep, "ws");
const at = (...segments: string[]): string => path.join(ROOT, ...segments);

/** Дерево maven-мультимодуля: то, что реально ищет `redhat.java`. */
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
            exclude: null,
        });
        expect(found.toSorted()).toEqual(["core/pom.xml", "node_modules/pom.xml", "pom.xml", "web/pom.xml"]);
    });

    it("шаблон без `**` якорится по числу сегментов", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "*/pom.xml",
            exclude: null,
        });
        // Корневой `pom.xml` не подходит: у него нет ведущего сегмента.
        expect(found.toSorted()).toEqual(["core/pom.xml", "node_modules/pom.xml", "web/pom.xml"]);
    });

    it("альтернативы `{a,b}` — как у сборочных файлов redhat.java", async () => {
        const found = await findFiles(
            scannerFromTree({
                [ROOT]: ["build.gradle", "settings.gradle.kts", "pom.xml", "notes.txt"],
            }),
            { base: ROOT, include: "**/{pom.xml,build.gradle,settings.gradle.kts}", exclude: null },
        );
        expect(found.toSorted()).toEqual(["build.gradle", "pom.xml", "settings.gradle.kts"]);
    });

    it("каталог под шаблон не попадает — ищем файлы", async () => {
        const found = await findFiles(scannerFromTree({ [ROOT]: ["target/", "targetFile"], [at("target")]: [] }), {
            base: ROOT,
            include: "**/target*",
            exclude: null,
        });
        expect(found).toEqual(["targetFile"]);
    });

    it("пустое дерево — пустой результат", async () => {
        const found = await findFiles(scannerFromTree({}), { base: ROOT, include: "**/pom.xml", exclude: null });
        expect(found).toEqual([]);
    });
});

describe("findFiles — глубина обхода", () => {
    it("шаблон без `**` не читает каталоги глубже своего числа сегментов", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        await findFiles(scanner, { base: ROOT, include: "*.java", exclude: null });
        // `*.java` живёт только в корне — спускаться незачем.
        expect(scanner.reads).toEqual([ROOT]);
    });

    it("шаблон с `**` спускается до дна", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, { base: ROOT, include: "**/*.class", exclude: null });
        expect(found).toEqual(["web/target/classes/App.class"]);
        expect(scanner.reads).toContain(at("web", "target", "classes"));
    });
});

describe("findFiles — исключения", () => {
    it("дефолтное исключение срезает .git и node_modules целиком", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            exclude: DEFAULT_FIND_FILES_EXCLUDE,
        });
        expect(found.toSorted()).toEqual(["core/pom.xml", "pom.xml", "web/pom.xml"]);
        // Не просто отфильтровали результат — внутрь исключённого каталога не зашли.
        expect(scanner.reads).not.toContain(at("node_modules"));
        expect(scanner.reads).not.toContain(at(".git"));
    });

    it("явный шаблон `**/<каталог>/**` даёт тот же результат через отсев файлов", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            exclude: "**/node_modules/**",
        });
        expect(found).not.toContain("node_modules/pom.xml");
        // Эта форма с самим каталогом не совпадает — внутрь обход заходит.
        expect(scanner.reads).toContain(at("node_modules"));
    });

    it("`null` не исключает ничего", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            exclude: null,
        });
        expect(found).toContain("node_modules/pom.xml");
    });

    it("пустая строка исключения значит то же, что `null` (её шлёт redhat.java)", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            exclude: "",
        });
        expect(found).toContain("node_modules/pom.xml");
    });
});

describe("findFiles — границы результата", () => {
    it("maxResults обрывает поиск ровно на границе", async () => {
        const found = await findFiles(scannerFromTree(MAVEN_TREE), {
            base: ROOT,
            include: "**/pom.xml",
            exclude: null,
            maxResults: 1,
        });
        // Обход в ширину: первым находится ближайший к корню.
        expect(found).toEqual(["pom.xml"]);
    });

    it("maxResults: 0 — пустой ответ без единого чтения каталога", async () => {
        const scanner = scannerFromTree(MAVEN_TREE);
        const found = await findFiles(scanner, {
            base: ROOT,
            include: "**/pom.xml",
            exclude: null,
            maxResults: 0,
        });
        expect(found).toEqual([]);
        expect(scanner.reads).toEqual([]);
    });

    it("бюджет каталогов обрывает обход гигантского дерева", async () => {
        // Цепочка каталогов глубиной 50; совпадение — на самом дне.
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
            { base: ROOT, include: "**/pom.xml", exclude: null },
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
            { base: ROOT, include: "**/pom.xml", exclude: null },
            {
                isCancelled: () => {
                    // Корень читаем, дальше — отмена.
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

describe("createNodeFindFilesScanner", () => {
    it("читает настоящий каталог и различает файлы и папки", async () => {
        const scanner = createNodeFindFilesScanner();
        const entries = await scanner.readDirectory(path.resolve(import.meta.dirname));
        const self = entries.find((e) => e.name === "findFiles.test.ts");
        expect(self).toEqual({ name: "findFiles.test.ts", isDirectory: false });
    });

    it("недоступный каталог — пустой список, а не исключение", async () => {
        const scanner = createNodeFindFilesScanner();
        await expect(scanner.readDirectory(path.join(ROOT, "нет-такого-каталога"))).resolves.toEqual([]);
    });
});

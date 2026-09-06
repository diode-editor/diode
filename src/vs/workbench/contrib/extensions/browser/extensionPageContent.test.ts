import { describe, expect, it } from "vitest";

import { REGISTRY_SCHEMA_VERSION, type IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import { buildExtensionPageLines, statusLine, wrapText } from "./extensionPageContent.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        latestVersion: "1.0.0",
        installedVersion: null,
        availability: "available",
        ...overrides,
    };
}

function meta(overrides: Partial<IRegistryExtensionMeta> = {}): IRegistryExtensionMeta {
    return {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        versions: [
            {
                version: "1.0.0",
                engines: { vscode: "^1.90.0" },
                artifact: { type: "url", url: "https://example.test/a.vsix" },
                sha256: "a".repeat(64),
            },
        ],
        ...overrides,
    };
}

/** Тексты строк — то, что видит пользователь; тон проверяем там, где он несёт смысл. */
function texts(lines: readonly { text: string }[]): string[] {
    return lines.map((l) => l.text);
}

describe("wrapText", () => {
    it("режет по словам, не разрывая их", () => {
        expect(wrapText("alpha beta gamma delta", 12)).toEqual(["alpha beta", "gamma delta"]);
    });

    it("сохраняет пустые строки — в markdown это границы абзацев", () => {
        expect(wrapText("one\n\ntwo", 20)).toEqual(["one", "", "two"]);
    });

    it("слово длиннее ширины режет жёстко", () => {
        expect(wrapText("aaaaaaaaaaaa", 8)).toEqual(["aaaaaaaa", "aaaa"]);
    });

    it("длинное слово в середине абзаца не съедает соседей", () => {
        expect(wrapText("hi aaaaaaaaaaaa bye", 8)).toEqual(["hi", "aaaaaaaa", "aaaa bye"]);
    });

    it("схлопывает двойные пробелы и обрезает хвостовые", () => {
        expect(wrapText("alpha  beta   ", 20)).toEqual(["alpha beta"]);
    });

    it("хвостовые пробелы не считаются в ширину — строка не рвётся из-за них", () => {
        // Ровно по лимиту плюс два пробела: срез хвоста обязан снять оба.
        expect(wrapText("alpha beta  ", 10)).toEqual(["alpha beta"]);
    });

    it("абзац из одних пробелов даёт пустую строку, а не пробелы", () => {
        expect(wrapText("one\n   \ntwo", 20)).toEqual(["one", "", "two"]);
    });

    it("нулевая ширина не зацикливается — режет по минимальной", () => {
        expect(wrapText("abcdefghijkl", 0)).toEqual(["abcdefgh", "ijkl"]);
    });

    it("строка ровно по ширине не переносится", () => {
        expect(wrapText("alpha beta", 10)).toEqual(["alpha beta"]);
    });
});

describe("statusLine", () => {
    it("available", () => {
        expect(statusLine(entry())).toBe("Not installed");
    });

    it("installed — с версией", () => {
        expect(statusLine(entry({ availability: "installed", installedVersion: "1.0.0" }))).toBe("Installed 1.0.0");
    });

    it("outdated — обе версии", () => {
        expect(statusLine(entry({ availability: "outdated", installedVersion: "0.9.0" }))).toBe(
            "Installed 0.9.0 · update available: 1.0.0",
        );
    });

    it("incompatible", () => {
        expect(statusLine(entry({ availability: "incompatible" }))).toBe("Incompatible with this build of Diode");
    });
});

describe("buildExtensionPageLines", () => {
    it("шапка несёт идентичность, статус, версию, требования и вид записи", () => {
        const lines = buildExtensionPageLines({ entry: entry(), meta: meta(), metaError: null }, 60);
        // Сравниваем строки целиком, вместе с тоном: цвет здесь — часть смысла
        // (что имя, что справочная строка, что предупреждение), и ассерт на один
        // текст пропустил бы перекрашивание половины страницы.
        expect(lines.slice(0, 9)).toEqual([
            { text: "Acme Tools", tone: "normal" },
            { text: "acme.tools", tone: "dim" },
            { text: "Tools for acme", tone: "normal" },
            { text: "", tone: "normal" },
            { text: "Not installed", tone: "dim" },
            { text: "Latest version: 1.0.0", tone: "dim" },
            { text: "Requires: vscode ^1.90.0", tone: "dim" },
            { text: "Kind: native", tone: "dim" },
            { text: "", tone: "normal" },
        ]);
    });

    it("требования обоих каналов идут одной строкой", () => {
        const lines = buildExtensionPageLines(
            {
                entry: entry(),
                meta: meta({
                    versions: [
                        {
                            version: "1.0.0",
                            engines: { diode: "^1.2.0", vscode: "^1.90.0" },
                            artifact: { type: "url", url: "https://example.test/a.vsix" },
                            sha256: "a".repeat(64),
                        },
                    ],
                }),
                metaError: null,
            },
            60,
        );
        expect(texts(lines)).toContain("Requires: diode ^1.2.0, vscode ^1.90.0");
    });

    it("требование только к diode — без хвоста про vscode", () => {
        const lines = buildExtensionPageLines(
            {
                entry: entry(),
                meta: meta({
                    versions: [
                        {
                            version: "1.0.0",
                            engines: { diode: "^0.3.0" },
                            artifact: { type: "url", url: "https://example.test/a.vsix" },
                            sha256: "a".repeat(64),
                        },
                    ],
                }),
                metaError: null,
            },
            60,
        );
        expect(texts(lines)).toContain("Requires: diode ^0.3.0");
    });

    it("версии в мете нет — строки требований тоже нет", () => {
        const lines = buildExtensionPageLines(
            { entry: entry({ latestVersion: "9.9.9" }), meta: meta(), metaError: null },
            60,
        );
        expect(texts(lines).some((t) => t.startsWith("Requires:"))).toBe(false);
    });

    it("ссылки и лицензия показываются, когда они есть в мете", () => {
        const lines = buildExtensionPageLines(
            {
                entry: entry(),
                meta: meta({
                    license: "MIT",
                    repository: "https://github.com/acme/tools",
                    homepage: "https://acme.test",
                }),
                metaError: null,
            },
            60,
        );
        expect(lines).toEqual(
            expect.arrayContaining([
                { text: "License: MIT", tone: "dim" },
                { text: "Repository: https://github.com/acme/tools", tone: "dim" },
                { text: "Homepage: https://acme.test", tone: "dim" },
            ]),
        );
    });

    it("readme идёт после шапки, с переносом по ширине", () => {
        const lines = buildExtensionPageLines(
            { entry: entry(), meta: meta({ readme: "# Acme\n\nalpha beta gamma delta" }), metaError: null },
            12,
        );
        expect(texts(lines).slice(-4)).toEqual(["# Acme", "", "alpha beta", "gamma delta"]);
    });

    it("нет readme — так и написано, приглушённой строкой", () => {
        const lines = buildExtensionPageLines({ entry: entry(), meta: meta(), metaError: null }, 60);
        expect(lines.at(-1)).toEqual({ text: "No readme published for this extension.", tone: "dim" });
    });

    it("readme идёт обычным тоном — это содержимое, а не служебная строка", () => {
        const lines = buildExtensionPageLines(
            { entry: entry(), meta: meta({ readme: "Readme body" }), metaError: null },
            60,
        );
        expect(lines.at(-1)).toEqual({ text: "Readme body", tone: "normal" });
    });

    it("нет записи в реестре — страница честно говорит откуда расширение", () => {
        const lines = buildExtensionPageLines(
            {
                entry: entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed", kind: undefined }),
                meta: undefined,
                metaError: null,
            },
            100,
        );
        // Ни вида записи, ни «последней версии» у такого расширения нет —
        // строк не должно быть вовсе, а не со словом undefined/null внутри.
        expect(texts(lines).some((t) => t.startsWith("Kind:"))).toBe(false);
        expect(texts(lines).some((t) => t.startsWith("Latest version:"))).toBe(false);
        expect(texts(lines)).toContain("Installed 0.1.0");
        expect(lines.at(-1)).toEqual({
            text: "This extension is not in the marketplace — it was installed from a file.",
            tone: "dim",
        });
    });

    it("сетевой сбой меты вытесняет readme и красится предупреждением", () => {
        const lines = buildExtensionPageLines(
            { entry: entry(), meta: undefined, metaError: "fetch failed (ENOTFOUND)" },
            100,
        );
        expect(lines.at(-1)).toEqual({
            text: "Cannot read this extension from the registry: fetch failed (ENOTFOUND)",
            tone: "warning",
        });
    });

    it("несовместимость подсвечена, а не спрятана в приглушённой строке", () => {
        const lines = buildExtensionPageLines(
            { entry: entry({ availability: "incompatible" }), meta: meta(), metaError: null },
            60,
        );
        expect(lines.find((l) => l.text.startsWith("Incompatible"))?.tone).toBe("warning");
    });

    it("пустое описание не даёт пустой строки в шапке", () => {
        const lines = buildExtensionPageLines({ entry: entry({ description: "" }), meta: meta(), metaError: null }, 60);
        // Ровно одна пустая строка между идентичностью и статусом: лишняя
        // означала бы, что описание всё-таки вывели — пустым.
        expect(texts(lines).slice(0, 4)).toEqual(["Acme Tools", "acme.tools", "", "Not installed"]);
    });
});

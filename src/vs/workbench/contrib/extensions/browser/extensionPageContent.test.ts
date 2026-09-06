import { describe, expect, it } from "vitest";

import { REGISTRY_SCHEMA_VERSION, type IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import { buildExtensionBodyLines, buildExtensionHeaderLines, statusLine, wrapText } from "./extensionPageContent.ts";

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
        needsReload: false,
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

    it("пробел между словами считается в ширину — на колонку длиннее уже перенос", () => {
        // 6 + 1 + 4 = 11 > 10: без учёта пробела строка вылезла бы за край.
        expect(wrapText("alphas beta", 10)).toEqual(["alphas", "beta"]);
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

describe("buildExtensionHeaderLines", () => {
    it("шапка несёт идентичность, статус, версию, требования и вид записи", () => {
        const lines = buildExtensionHeaderLines({ entry: entry(), meta: meta(), metaError: null, operationError: null }, 60);
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
        const lines = buildExtensionHeaderLines(
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
                operationError: null,
            },
            60,
        );
        expect(texts(lines)).toContain("Requires: diode ^1.2.0, vscode ^1.90.0");
    });

    it("требование только к diode — без хвоста про vscode", () => {
        const lines = buildExtensionHeaderLines(
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
                operationError: null,
            },
            60,
        );
        expect(texts(lines)).toContain("Requires: diode ^0.3.0");
    });

    it("версии в мете нет — строки требований тоже нет", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry({ latestVersion: "9.9.9" }), meta: meta(), metaError: null, operationError: null },
            60,
        );
        expect(texts(lines).some((t) => t.startsWith("Requires:"))).toBe(false);
    });

    it("ссылки и лицензия показываются, когда они есть в мете", () => {
        const lines = buildExtensionHeaderLines(
            {
                entry: entry(),
                meta: meta({
                    license: "MIT",
                    repository: "https://github.com/acme/tools",
                    homepage: "https://acme.test",
                }),
                metaError: null,
                operationError: null,
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

    it("нет записи в реестре — ни лицензии, ни ссылок: их брать неоткуда", () => {
        const lines = buildExtensionHeaderLines(
            {
                entry: entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed", kind: undefined }),
                meta: undefined,
                metaError: null,
                operationError: null,
            },
            60,
        );
        expect(texts(lines)).toEqual(["Acme Tools", "acme.tools", "Tools for acme", "", "Installed 0.1.0", ""]);
    });

    it("ошибка операции стоит в шапке предупреждением — рядом с кнопками, которые её вызвали", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry(), meta: meta(), metaError: null, operationError: "sha256 mismatch" },
            60,
        );
        expect(lines.at(-2)).toEqual({ text: "sha256 mismatch", tone: "warning" });
        // Шапка кончается пустой строкой-зазором перед рядом кнопок.
        expect(lines.at(-1)).toEqual({ text: "", tone: "normal" });
    });

    it("несовместимость подсвечена, а не спрятана в приглушённой строке", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry({ availability: "incompatible" }), meta: meta(), metaError: null, operationError: null },
            60,
        );
        expect(lines.find((l) => l.text.startsWith("Incompatible"))?.tone).toBe("warning");
    });

    it("пустое описание не даёт пустой строки в шапке", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry({ description: "" }), meta: meta(), metaError: null, operationError: null },
            60,
        );
        // Ровно одна пустая строка между идентичностью и статусом: лишняя
        // означала бы, что описание всё-таки вывели — пустым.
        expect(texts(lines).slice(0, 4)).toEqual(["Acme Tools", "acme.tools", "", "Not installed"]);
    });

    it("readme в шапку не попадает — он живёт в прокручиваемом теле", () => {
        const lines = buildExtensionHeaderLines(
            { entry: entry(), meta: meta({ readme: "Readme body" }), metaError: null, operationError: null },
            60,
        );
        expect(texts(lines)).not.toContain("Readme body");
    });
});

describe("buildExtensionBodyLines", () => {
    it("readme переносится по ширине и идёт обычным тоном — это содержимое", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: meta({ readme: "# Acme\n\nalpha beta gamma delta" }), metaError: null, operationError: null },
            12,
        );
        expect(lines).toEqual([
            { text: "# Acme", tone: "normal" },
            { text: "", tone: "normal" },
            { text: "alpha beta", tone: "normal" },
            { text: "gamma delta", tone: "normal" },
        ]);
    });

    it("нет readme — так и написано, приглушённой строкой", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: meta(), metaError: null, operationError: null },
            60,
        );
        expect(lines).toEqual([{ text: "No readme published for this extension.", tone: "dim" }]);
    });

    it("нет записи в реестре — тело честно говорит, откуда расширение", () => {
        const lines = buildExtensionBodyLines(
            {
                entry: entry({ latestVersion: null, installedVersion: "0.1.0", availability: "installed" }),
                meta: undefined,
                metaError: null,
                operationError: null,
            },
            100,
        );
        expect(lines).toEqual([
            {
                text: "This extension is not in the marketplace — it was installed from a file.",
                tone: "dim",
            },
        ]);
    });

    it("сетевой сбой меты вытесняет readme и красится предупреждением", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: undefined, metaError: "fetch failed (ENOTFOUND)", operationError: null },
            100,
        );
        expect(lines).toEqual([
            {
                text: "Cannot read this extension from the registry: fetch failed (ENOTFOUND)",
                tone: "warning",
            },
        ]);
    });

    it("сбой меты перебивает даже пришедшую мету — показывать полуправду хуже, чем причину", () => {
        const lines = buildExtensionBodyLines(
            { entry: entry(), meta: meta({ readme: "Readme body" }), metaError: "boom", operationError: null },
            100,
        );
        expect(texts(lines)).not.toContain("Readme body");
    });
});

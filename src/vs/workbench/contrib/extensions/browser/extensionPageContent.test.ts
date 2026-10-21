import { describe, expect, it } from "vitest";

import {
    type IRegistryExtensionMeta,
    REGISTRY_SCHEMA_VERSION,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IExtensionListEntry } from "../common/extensionsWorkbench.ts";

import type { IExtensionPageContent } from "./extensionPageContent.ts";
import {
    buildExtensionBodyLines,
    buildExtensionHeaderLines,
    PARTIAL_SUPPORT_HEADLINE,
    statusLine,
    wrapText,
} from "./extensionPageContent.ts";

function entry(overrides: Partial<IExtensionListEntry> = {}): IExtensionListEntry {
    return {
        id: "acme.tools",
        publisher: "acme",
        name: "tools",
        displayName: "Acme Tools",
        description: "Tools for acme",
        kind: "native",
        support: undefined,
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
        support: undefined,
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
        // Exactly at the limit plus two spaces: trimming the tail must remove both.
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
        // 6 + 1 + 4 = 11 > 10: without counting the space the line would overflow.
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
        const lines = buildExtensionHeaderLines(
            { entry: entry(), meta: meta(), metaError: null, operationError: null },
            60,
        );
        // Whole, with tone: color is part of the meaning, and a text-only assert would miss a recolor.
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
                entry: entry({
                    latestVersion: null,
                    installedVersion: "0.1.0",
                    availability: "installed",
                    kind: undefined,
                    support: undefined,
                }),
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
        // The header ends with a blank spacer line before the button row.
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
        // Exactly one blank line between identity and status: an extra one
        // would mean the description was printed after all, empty.
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
            {
                entry: entry(),
                meta: meta({ readme: "# Acme\n\nalpha beta gamma delta" }),
                metaError: null,
                operationError: null,
            },
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

describe("страница расширения с частичной поддержкой", () => {
    const content = (o: Partial<IExtensionPageContent> = {}): IExtensionPageContent => ({
        entry: entry(),
        meta: meta(),
        metaError: null,
        operationError: null,
        ...o,
    });

    const support = {
        level: "partial",
        works: ["Inline completions", "Commands"],
        limits: ["Chat panel needs a webview", "Sign-in opens a browser"],
    } as const;

    it("шапка предупреждает одной строкой", () => {
        const lines = buildExtensionHeaderLines(content({ entry: entry({ support }) }), 80);
        // Text as a literal, not via the constant: otherwise the assert moves together
        // with it, and a changed string goes unnoticed.
        const warning = lines.find((l) => l.text === "Partial support: some features do not work in Diode");
        expect(warning?.tone).toBe("warning");
        expect(PARTIAL_SUPPORT_HEADLINE).toBe("Partial support: some features do not work in Diode");
    });

    it("тело не повторяет заголовок из шапки", () => {
        const lines = buildExtensionBodyLines(content({ entry: entry({ support }) }), 80);
        expect(lines.map((l) => l.text)).not.toContain(PARTIAL_SUPPORT_HEADLINE);
    });

    it("тело перечисляет что работает и что нет — до readme", () => {
        const lines = buildExtensionBodyLines(
            content({ entry: entry({ support }), meta: meta({ readme: "# Readme body" }) }),
            80,
        );
        const texts = lines.map((l) => l.text);
        expect(texts).toContain("Works in Diode:");
        expect(texts).toContain("- Inline completions");
        expect(texts).toContain("Does not work:");
        expect(texts).toContain("- Chat panel needs a webview");
        expect(texts.indexOf("- Chat panel needs a webview")).toBeLessThan(texts.indexOf("# Readme body"));
    });

    it("ограничения видны даже когда мету не прочитать", () => {
        const lines = buildExtensionBodyLines(
            content({ entry: entry({ support }), meta: undefined, metaError: "network is down" }),
            80,
        );
        const texts = lines.map((l) => l.text);
        expect(texts).toContain("- Chat panel needs a webview");
        expect(texts.some((t) => t.includes("network is down"))).toBe(true);
    });

    it("блок целиком: тон каждой строки и зазор перед readme", () => {
        const lines = buildExtensionBodyLines(
            content({
                entry: entry({ support: { level: "partial", works: ["Ghost text"], limits: ["Chat panel"] } }),
                meta: meta({ readme: "# Readme body" }),
            }),
            80,
        );
        // Whole, with tone: the title is a reference line, "does not work" is a warning, the last
        // line is blank, otherwise the readme sticks to the list.
        expect(lines.slice(0, 5)).toEqual([
            { text: "Works in Diode:", tone: "dim" },
            { text: "- Ghost text", tone: "dim" },
            { text: "Does not work:", tone: "dim" },
            { text: "- Chat panel", tone: "warning" },
            { text: "", tone: "normal" },
        ]);
        expect(lines[5]?.text).toBe("# Readme body");
    });

    it("нет списка — нет и его заголовка", () => {
        const onlyLimits = buildExtensionBodyLines(
            content({ entry: entry({ support: { level: "partial", limits: ["Chat panel"] } }) }),
            80,
        );
        expect(onlyLimits.map((l) => l.text)).not.toContain("Works in Diode:");
        expect(onlyLimits.map((l) => l.text)).toContain("Does not work:");
    });

    it("пустой список не даёт заголовка без пунктов", () => {
        // The registry won't publish this, but the type allows it: a
        // "Works in Diode:" title with nothing under it would read as "nothing".
        const lines = buildExtensionBodyLines(
            content({ entry: entry({ support: { level: "partial", works: [], limits: ["Chat panel"] } }) }),
            80,
        );
        const texts = lines.map((l) => l.text);
        expect(texts).not.toContain("Works in Diode:");
        expect(texts).toContain("Does not work:");
    });

    it("у полной поддержки блока нет", () => {
        const full = buildExtensionBodyLines(
            content({ entry: entry({ support: { level: "full" } }), meta: undefined, metaError: null }),
            80,
        );
        // The block is absent ENTIRELY, no titles and no blank spacer line: otherwise
        // the page of a fully supported extension would start with a gap.
        expect(full.map((l) => l.text)).not.toContain("Does not work:");
        expect(full.map((l) => l.text)).not.toContain("Works in Diode:");
        expect(full.every((l) => l.text !== "")).toBe(true);
        expect(
            buildExtensionHeaderLines(content({ entry: entry({ support: { level: "full" } }) }), 80).map((l) => l.text),
        ).not.toContain(PARTIAL_SUPPORT_HEADLINE);
    });
});

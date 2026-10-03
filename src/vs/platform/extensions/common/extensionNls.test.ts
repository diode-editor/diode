import { describe, expect, it } from "vitest";

import {
    type INlsBundle,
    localizeManifest,
    NLS_BASE_FILE,
    nlsFileCandidates,
    nlsKeyOf,
    parseNlsBundle,
} from "./extensionNls.ts";

describe("nlsKeyOf", () => {
    it("распознаёт ключ в обрамлении процентов", () => {
        expect(nlsKeyOf("%java.server.mode.switch%")).toBe("java.server.mode.switch");
    });

    it("обычный текст ключом не считает", () => {
        expect(nlsKeyOf("Switch to Standard Mode")).toBeUndefined();
        expect(nlsKeyOf("")).toBeUndefined();
    });

    it("процент только с одной стороны — не ключ", () => {
        expect(nlsKeyOf("%java.clean")).toBeUndefined();
        expect(nlsKeyOf("java.clean%")).toBeUndefined();
        expect(nlsKeyOf("100% coverage")).toBeUndefined();
    });

    it("пустой ключ не ключ: `%` и `%%` остаются текстом", () => {
        expect(nlsKeyOf("%")).toBeUndefined();
        expect(nlsKeyOf("%%")).toBeUndefined();
    });

    it("ключ в один символ распознаётся", () => {
        expect(nlsKeyOf("%a%")).toBe("a");
    });
});

describe("nlsFileCandidates", () => {
    it("для `en` единственный кандидат — базовый бандл", () => {
        expect(nlsFileCandidates("en")).toEqual(["package.nls.json"]);
    });

    it("пустая локаль ведёт себя как `en`", () => {
        expect(nlsFileCandidates("")).toEqual(["package.nls.json"]);
        expect(nlsFileCandidates("  ")).toEqual(["package.nls.json"]);
    });

    it("локаль без региона: файл локали, затем база", () => {
        expect(nlsFileCandidates("ko")).toEqual(["package.nls.ko.json", "package.nls.json"]);
    });

    it("локаль с регионом спускается к базовому языку, потом к базе", () => {
        expect(nlsFileCandidates("pt-BR")).toEqual([
            "package.nls.pt-br.json",
            "package.nls.pt.json",
            "package.nls.json",
        ]);
    });

    it("региональный английский не ищет `package.nls.en.json`", () => {
        expect(nlsFileCandidates("en-GB")).toEqual(["package.nls.en-gb.json", "package.nls.json"]);
    });

    it("базовый файл всегда последний кандидат", () => {
        for (const locale of ["en", "ko", "zh-cn", "en-gb"]) {
            expect(nlsFileCandidates(locale).at(-1)).toBe(NLS_BASE_FILE);
        }
    });
});

describe("parseNlsBundle", () => {
    it("читает плоский словарь строк", () => {
        expect(parseNlsBundle('{"a":"A","b":"B"}')).toEqual({ a: "A", b: "B" });
    });

    it("нестроковые значения отбрасывает — ключ останется ненайденным", () => {
        expect(parseNlsBundle('{"a":"A","n":1,"o":{"message":"M"},"arr":["x"],"nil":null}')).toEqual({ a: "A" });
    });

    it("бросает на невалидном JSON", () => {
        expect(() => parseNlsBundle("{not json")).toThrow();
    });

    it("бросает, когда верхний уровень не объект", () => {
        expect(() => parseNlsBundle('["a"]')).toThrow(/must be a JSON object/);
        expect(() => parseNlsBundle("null")).toThrow(/must be a JSON object/);
        expect(() => parseNlsBundle("42")).toThrow(/must be a JSON object/);
    });
});

describe("localizeManifest", () => {
    it("резолвит ключи во всём дереве: displayName, команды, темы, настройки", () => {
        const manifest = {
            name: "java",
            displayName: "%displayName%",
            description: "%description%",
            contributes: {
                commands: [{ command: "java.clean", title: "%java.clean%", category: "Java" }],
                themes: [{ label: "%theme.label%", path: "./themes/dark.json" }],
                configuration: {
                    properties: { "java.home": { type: "string", description: "%java.home.desc%" } },
                },
            },
        };
        const bundle: INlsBundle = {
            displayName: "Language Support for Java(TM)",
            description: "Java linting and more",
            "java.clean": "Clean Workspace",
            "theme.label": "Java Dark",
            "java.home.desc": "Path to the JDK",
        };

        const { value, unresolved } = localizeManifest(manifest, bundle);

        expect(unresolved).toEqual([]);
        expect(value.displayName).toBe("Language Support for Java(TM)");
        expect(value.description).toBe("Java linting and more");
        expect(value.contributes.commands[0].title).toBe("Clean Workspace");
        expect(value.contributes.themes[0].label).toBe("Java Dark");
        expect(value.contributes.configuration.properties["java.home"].description).toBe("Path to the JDK");
    });

    it("не трогает значения, которые не строки", () => {
        const manifest = {
            version: 2,
            enabled: true,
            missing: null,
            list: [1, false, null],
            nested: { n: 0 },
        };

        const { value } = localizeManifest(manifest, { a: "A" });

        expect(value).toEqual(manifest);
    });

    it("сохраняет массивы массивами, а не объектами", () => {
        const { value } = localizeManifest({ aliases: ["%alias%", "java"] }, { alias: "Java" });
        expect(Array.isArray(value.aliases)).toBe(true);
        expect(value.aliases).toEqual(["Java", "java"]);
    });

    it("ненайденный ключ оставляет строку как есть и попадает в unresolved", () => {
        const { value, unresolved } = localizeManifest({ title: "%known%", other: "%unknown%" }, { known: "Known" });

        expect(value).toEqual({ title: "Known", other: "%unknown%" });
        expect(unresolved).toEqual(["unknown"]);
    });

    it("без бандла все ключи попадают в unresolved без дублей", () => {
        const { value, unresolved } = localizeManifest({ a: "%k%", b: "%k%", c: "%other%", d: "plain" }, undefined);

        expect(value).toEqual({ a: "%k%", b: "%k%", c: "%other%", d: "plain" });
        expect(unresolved).toEqual(["k", "other"]);
    });

    it("исходный манифест не мутируется", () => {
        const manifest = { displayName: "%displayName%", contributes: { commands: [{ title: "%t%" }] } };
        const snapshot = structuredClone(manifest);

        const { value } = localizeManifest(manifest, { displayName: "Java", t: "Clean" });

        expect(manifest).toEqual(snapshot);
        expect(value).not.toBe(manifest);
        expect(value.contributes.commands[0].title).toBe("Clean");
    });
});

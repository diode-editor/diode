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
    it("recognizes a key wrapped in percent signs", () => {
        expect(nlsKeyOf("%java.server.mode.switch%")).toBe("java.server.mode.switch");
    });

    it("plain text is not a key", () => {
        expect(nlsKeyOf("Switch to Standard Mode")).toBeUndefined();
        expect(nlsKeyOf("")).toBeUndefined();
    });

    it("a percent sign on one side only is not a key", () => {
        expect(nlsKeyOf("%java.clean")).toBeUndefined();
        expect(nlsKeyOf("java.clean%")).toBeUndefined();
        expect(nlsKeyOf("100% coverage")).toBeUndefined();
    });

    it("an empty key is not a key: `%` and `%%` stay text", () => {
        expect(nlsKeyOf("%")).toBeUndefined();
        expect(nlsKeyOf("%%")).toBeUndefined();
    });

    it("a one-character key is recognized", () => {
        expect(nlsKeyOf("%a%")).toBe("a");
    });
});

describe("nlsFileCandidates", () => {
    it("for `en` the only candidate is the base bundle", () => {
        expect(nlsFileCandidates("en")).toEqual(["package.nls.json"]);
    });

    it("an empty locale behaves like `en`", () => {
        expect(nlsFileCandidates("")).toEqual(["package.nls.json"]);
        expect(nlsFileCandidates("  ")).toEqual(["package.nls.json"]);
    });

    it("locale without a region: the locale file, then the base", () => {
        expect(nlsFileCandidates("ko")).toEqual(["package.nls.ko.json", "package.nls.json"]);
    });

    it("a locale with a region falls back to the base language, then to the base", () => {
        expect(nlsFileCandidates("pt-BR")).toEqual([
            "package.nls.pt-br.json",
            "package.nls.pt.json",
            "package.nls.json",
        ]);
    });

    it("regional English does not look for `package.nls.en.json`", () => {
        expect(nlsFileCandidates("en-GB")).toEqual(["package.nls.en-gb.json", "package.nls.json"]);
    });

    it("the base file is always the last candidate", () => {
        for (const locale of ["en", "ko", "zh-cn", "en-gb"]) {
            expect(nlsFileCandidates(locale).at(-1)).toBe(NLS_BASE_FILE);
        }
    });
});

describe("parseNlsBundle", () => {
    it("reads a flat string dictionary", () => {
        expect(parseNlsBundle('{"a":"A","b":"B"}')).toEqual({ a: "A", b: "B" });
    });

    it("drops non-string values, so the key stays unresolved", () => {
        expect(parseNlsBundle('{"a":"A","n":1,"o":{"message":"M"},"arr":["x"],"nil":null}')).toEqual({ a: "A" });
    });

    it("throws on invalid JSON", () => {
        expect(() => parseNlsBundle("{not json")).toThrow();
    });

    it("throws when the top level is not an object", () => {
        expect(() => parseNlsBundle('["a"]')).toThrow(/must be a JSON object/);
        expect(() => parseNlsBundle("null")).toThrow(/must be a JSON object/);
        expect(() => parseNlsBundle("42")).toThrow(/must be a JSON object/);
    });
});

describe("localizeManifest", () => {
    it("resolves keys across the whole tree: displayName, commands, themes, settings", () => {
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

    it("leaves non-string values alone", () => {
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

    it("keeps arrays as arrays, not objects", () => {
        const { value } = localizeManifest({ aliases: ["%alias%", "java"] }, { alias: "Java" });
        expect(Array.isArray(value.aliases)).toBe(true);
        expect(value.aliases).toEqual(["Java", "java"]);
    });

    it("an unresolved key leaves the string as is and goes into unresolved", () => {
        const { value, unresolved } = localizeManifest({ title: "%known%", other: "%unknown%" }, { known: "Known" });

        expect(value).toEqual({ title: "Known", other: "%unknown%" });
        expect(unresolved).toEqual(["unknown"]);
    });

    it("without a bundle all keys go into unresolved without duplicates", () => {
        const { value, unresolved } = localizeManifest({ a: "%k%", b: "%k%", c: "%other%", d: "plain" }, undefined);

        expect(value).toEqual({ a: "%k%", b: "%k%", c: "%other%", d: "plain" });
        expect(unresolved).toEqual(["k", "other"]);
    });

    it("the source manifest is not mutated", () => {
        const manifest = { displayName: "%displayName%", contributes: { commands: [{ title: "%t%" }] } };
        const snapshot = structuredClone(manifest);

        const { value } = localizeManifest(manifest, { displayName: "Java", t: "Clean" });

        expect(manifest).toEqual(snapshot);
        expect(value).not.toBe(manifest);
        expect(value.contributes.commands[0].title).toBe("Clean");
    });
});

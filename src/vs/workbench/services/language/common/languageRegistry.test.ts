import { describe, expect, it } from "vitest";

import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";

import { LanguageRegistry } from "./languageRegistry.ts";

function makeExt(id: string, languages: object[], location = "Extensions/builtin/test/"): IExtension {
    return {
        id,
        location,
        isBuiltin: true,
        manifest: {
            name: id,
            publisher: "vscode",
            version: "1.0.0",
            engines: { vscode: "*" },
            contributes: { languages: languages as never },
        },
    };
}

describe("LanguageRegistry", () => {
    it("registers a language and returns it by id", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts"], aliases: ["TypeScript"] }]));

        const lang = registry.getLanguage("typescript");
        expect(lang?.id).toBe("typescript");
        expect(lang?.extensions).toEqual([".ts"]);
        expect(lang?.aliases).toEqual(["TypeScript"]);
    });

    it("matches by exact filename", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("docker", [{ id: "dockerfile", filenames: ["Dockerfile"] }]));

        expect(registry.getLanguageIdForResource("/some/path/Dockerfile")).toBe("dockerfile");
        expect(registry.getLanguageIdForResource("/some/path/dockerfile")).toBeUndefined();
    });

    it("matches by filenamePatterns (glob)", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts", [{ id: "jsonc", filenamePatterns: ["tsconfig.*.json"] }]));

        expect(registry.getLanguageIdForResource("/p/tsconfig.build.json")).toBe("jsonc");
        expect(registry.getLanguageIdForResource("/p/tsconfig.json")).toBeUndefined();
    });

    it("escapes regex-special characters in filenamePatterns (literal '+' match)", () => {
        const registry = new LanguageRegistry();
        // '+' is a regex quantifier; it must be matched literally, not as "one or more".
        registry.register(makeExt("p", [{ id: "plusfile", filenamePatterns: ["c++.*"] }]));

        expect(registry.getLanguageIdForResource("/p/c++.zzz")).toBe("plusfile");
        expect(registry.getLanguageIdForResource("/p/cc.zzz")).toBeUndefined();
    });

    it("records firstLine from a language contribution", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("sh", [{ id: "shellscript", extensions: [".sh"], firstLine: "^#!.*\\bsh\\b" }]));

        expect(registry.getLanguage("shellscript")?.firstLine).toBe("^#!.*\\bsh\\b");
    });

    it("register() with empty languages list returns a no-op disposable", () => {
        const registry = new LanguageRegistry();
        const disposable = registry.register(makeExt("nolang", []));

        expect(registry.allLanguages().map((l) => l.id)).toEqual(["plaintext"]);
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
    });

    it("matches by extension case-insensitively", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts"] }]));

        expect(registry.getLanguageIdForResource("file.ts")).toBe("typescript");
        expect(registry.getLanguageIdForResource("file.TS")).toBe("typescript");
    });

    it("matches dotfile whose whole name equals a registered extension (.editorconfig)", () => {
        const registry = new LanguageRegistry();
        // The stock editorconfig-vscode declares `extensions: [".editorconfig"]`,
        // while the file is named `.editorconfig` in full, so its `path.extname` is empty.
        registry.register(makeExt("ec", [{ id: "editorconfig", extensions: [".editorconfig"] }]));

        expect(registry.getLanguageIdForResource("/proj/.editorconfig")).toBe("editorconfig");
        expect(registry.getLanguageIdForResource("/proj/.EditorConfig")).toBe("editorconfig");
        expect(registry.getLanguageIdForResource("/proj/sub.editorconfig")).toBe("editorconfig");
        expect(registry.getLanguageIdForResource("/proj/.gitignore")).toBeUndefined();
    });

    it("priority filenames > filenamePatterns > extensions", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("a", [{ id: "byext", extensions: [".json"] }]));
        registry.register(makeExt("b", [{ id: "bypattern", filenamePatterns: ["*.json"] }]));
        registry.register(makeExt("c", [{ id: "byname", filenames: ["package.json"] }]));

        expect(registry.getLanguageIdForResource("/p/package.json")).toBe("byname");
        expect(registry.getLanguageIdForResource("/p/foo.json")).toBe("bypattern");
    });

    it("returns undefined for an unknown file", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts"] }]));

        expect(registry.getLanguageIdForResource("foo.unknown")).toBeUndefined();
        expect(registry.getLanguageIdForResource("Makefile")).toBeUndefined();
    });

    it("merges the data of several contributions of one language", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts-base", [{ id: "typescript", extensions: [".ts"] }]));
        registry.register(makeExt("ts-extra", [{ id: "typescript", extensions: [".cts", ".mts"] }]));

        const lang = registry.getLanguage("typescript");
        expect(lang?.extensions).toEqual([".ts", ".cts", ".mts"]);
    });

    it("dispose() removes the extension's contributions", () => {
        const registry = new LanguageRegistry();
        const d = registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts"] }]));
        expect(registry.getLanguage("typescript")).toBeDefined();

        d.dispose();
        expect(registry.getLanguage("typescript")).toBeUndefined();
    });

    it("dispose() of one of two contributions keeps the language, but without the first one's input", () => {
        const registry = new LanguageRegistry();
        const d1 = registry.register(makeExt("ts-base", [{ id: "typescript", extensions: [".ts"] }]));
        registry.register(makeExt("ts-extra", [{ id: "typescript", extensions: [".cts"] }]));

        d1.dispose();
        const lang = registry.getLanguage("typescript");
        expect(lang?.extensions).toEqual([".cts"]);
    });

    it("resolves configurationPath relative to extension.location", () => {
        const registry = new LanguageRegistry();
        registry.register(
            makeExt(
                "ts",
                [{ id: "typescript", extensions: [".ts"], configuration: "./language-configuration.json" }],
                "Extensions/builtin/typescript-basics/",
            ),
        );

        const lang = registry.getLanguage("typescript");
        expect(lang?.configurationPath).toBe("Extensions/builtin/typescript-basics/language-configuration.json");
    });

    it("matches filenamePatterns with a single wildcard '?'", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("q", [{ id: "qlang", filenamePatterns: ["file?.zzz"] }]));

        expect(registry.getLanguageIdForResource("/p/fileA.zzz")).toBe("qlang");
        expect(registry.getLanguageIdForResource("/p/file1.zzz")).toBe("qlang");
        expect(registry.getLanguageIdForResource("/p/file.zzz")).toBeUndefined();
        expect(registry.getLanguageIdForResource("/p/fileAB.zzz")).toBeUndefined();
    });

    it("a repeated dispose of a contribution is a no-op (the entry is already removed)", () => {
        const registry = new LanguageRegistry();
        const d = registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts"] }]));

        d.dispose();
        expect(registry.getLanguage("typescript")).toBeUndefined();
        // Second dispose: the language entry is already removed (delta<0, entry===undefined).
        expect(() => {
            d.dispose();
        }).not.toThrow();
        expect(registry.getLanguage("typescript")).toBeUndefined();
    });

    it("a repeated dispose does not remove strings no longer in the entry", () => {
        const registry = new LanguageRegistry();
        const d1 = registry.register(makeExt("a", [{ id: "typescript", extensions: [".ts"] }]));
        registry.register(makeExt("b", [{ id: "typescript", extensions: [".js"] }]));

        d1.dispose(); // removes ".ts", [".js"] remains
        expect(registry.getLanguage("typescript")?.extensions).toEqual([".js"]);

        // A repeated dispose tries to remove the already absent ".ts": indexOf returns -1, splice is not called.
        d1.dispose();
        expect(registry.getLanguage("typescript")?.extensions).toEqual([".js"]);
    });

    it("allLanguages() returns all registered ones", () => {
        const registry = new LanguageRegistry();
        registry.register(
            makeExt("a", [
                { id: "typescript", extensions: [".ts"] },
                { id: "javascript", extensions: [".js"] },
            ]),
        );

        const ids = registry
            .allLanguages()
            .map((l) => l.id)
            .sort();
        expect(ids).toEqual(["javascript", "plaintext", "typescript"]);
    });

    it("seeds plaintext as a core language", () => {
        const registry = new LanguageRegistry();

        expect(registry.getLanguage("plaintext")?.aliases).toEqual(["Plain Text"]);
        expect(registry.getLanguageIdForResource("notes.txt")).toBe("plaintext");
    });

    it("getLanguageDisplayName returns the first alias", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts"], aliases: ["TypeScript", "ts"] }]));

        expect(registry.getLanguageDisplayName("typescript")).toBe("TypeScript");
        expect(registry.getLanguageDisplayName("plaintext")).toBe("Plain Text");
    });

    it("getLanguageDisplayName: undefined for an unknown language and a language without aliases", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("x", [{ id: "aliasless", extensions: [".x"] }]));

        expect(registry.getLanguageDisplayName("unknown")).toBeUndefined();
        expect(registry.getLanguageDisplayName("aliasless")).toBeUndefined();
    });

    it("getExtensionForLanguage returns the first extension, the inverse of resolving by path", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("ts", [{ id: "typescript", extensions: [".ts", ".tsx"], aliases: ["TypeScript"] }]));

        expect(registry.getExtensionForLanguage("typescript")).toBe(".ts");
        // plaintext is a core language: it is what gives an untitled buffer ".txt" in Save As.
        expect(registry.getExtensionForLanguage("plaintext")).toBe(".txt");
    });

    it("getExtensionForLanguage: undefined for an unknown language and a language without extensions", () => {
        const registry = new LanguageRegistry();
        registry.register(makeExt("x", [{ id: "extensionless", aliases: ["No Ext"] }]));

        expect(registry.getExtensionForLanguage("unknown")).toBeUndefined();
        expect(registry.getExtensionForLanguage("extensionless")).toBeUndefined();
    });

    // The stock editorconfig-vscode contributes the language via `extensions: [".editorconfig"]` with empty
    // `filenames`: resolution relies on a dotfile match of the name against the "extension".
    it("resolves .editorconfig to 'editorconfig' via the stock extension's .extensions", () => {
        const registry = new LanguageRegistry();
        expect(registry.getLanguageIdForResource("/p/.editorconfig")).toBeUndefined();

        registry.register(
            makeExt(
                "editorconfig",
                [{ id: "editorconfig", extensions: [".editorconfig"], filenames: [], aliases: ["EditorConfig"] }],
                "UserExtensions/EditorConfig.EditorConfig-0.18.2/",
            ),
        );
        expect(registry.getLanguageIdForResource("/p/.editorconfig")).toBe("editorconfig");
        expect(registry.getLanguageIdForResource(".editorconfig")).toBe("editorconfig");
    });

    it("on an extension conflict the later registration wins (user > builtin)", () => {
        const registry = new LanguageRegistry();
        // The builtin ini pack (as in microsoft/vscode) registers first.
        registry.register(makeExt("ini", [{ id: "properties", extensions: [".ini", ".editorconfig"] }]));
        expect(registry.getLanguageIdForResource("/p/.editorconfig")).toBe("properties");

        // Otherwise the completion selector {language:'editorconfig'} does not match.
        registry.register(
            makeExt(
                "editorconfig",
                [{ id: "editorconfig", extensions: [".editorconfig"], filenames: [] }],
                "UserExtensions/ec/",
            ),
        );
        expect(registry.getLanguageIdForResource("/p/.editorconfig")).toBe("editorconfig");
        expect(registry.getLanguageIdForResource("/p/app.ini")).toBe("properties");
    });
});

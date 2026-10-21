import { describe, expect, it } from "vitest";

import { createLoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import {
    createDefaultTokenClassificationRegistry,
    TokenClassificationRegistry,
} from "../../../../platform/theme/common/tokenClassificationRegistry.ts";

import { registerExtensionSemanticTokens } from "./extensionSemanticTokensContributor.ts";

function ext(contributes: IExtensionContributions | undefined, id = "test.sem"): IExtension {
    return {
        id,
        manifest: { name: "sem", publisher: "test", version: "0.0.1", engines: { vscode: "*" }, contributes },
        location: "UserExtensions/test.sem-0.0.1/",
        isBuiltin: false,
    };
}

/** `contributes` of redhat.java 1.57 (semantic part), verbatim. */
const REDHAT_JAVA: IExtensionContributions = {
    semanticTokenTypes: [
        { id: "annotation", superType: "type", description: "Style for annotations." },
        { id: "annotationMember", superType: "method", description: "Style for annotation members." },
        { id: "modifier", superType: "keyword", description: "Style for modifier keywords." },
        { id: "record", superType: "class", description: "Style for records." },
        { id: "recordComponent", superType: "parameter", description: "Style for record components." },
    ],
    semanticTokenModifiers: [
        { id: "public", description: "Style for symbols with the public access modifier." },
        { id: "constructor", description: "Style for symbols that are constructors." },
    ],
    semanticTokenScopes: [
        {
            language: "java",
            scopes: {
                annotation: ["storage.type.annotation.java"],
                annotationMember: ["entity.name.annotationMember.java", "constant.other.key.java"],
                modifier: ["storage.modifier.java"],
                "*.constructor": ["entity.name.function.java"],
            },
        },
    ],
};

describe("registerExtensionSemanticTokens", () => {
    it("types with superType, modifiers and probe scopes land in the registry (redhat.java)", () => {
        const registry = createDefaultTokenClassificationRegistry();
        const before = registry.getTokenStylingDefaultRules().length;
        const logger = createLoggerSpy();
        registerExtensionSemanticTokens([ext(REDHAT_JAVA)], registry, logger);

        expect(registry.getTokenTypes().find((t) => t.id === "annotation")).toEqual({
            id: "annotation",
            superType: "type",
            description: "Style for annotations.",
            deprecationMessage: undefined,
        });
        expect(registry.getTokenModifiers().map((m) => m.id)).toContain("constructor");
        expect(
            registry
                .getTokenStylingDefaultRules()
                .slice(before)
                .map((rule) => [rule.selector.id, rule.defaults.scopesToProbe]),
        ).toEqual([
            ["annotation:java", [["storage.type.annotation.java"]]],
            ["annotationMember:java", [["entity.name.annotationMember.java"], ["constant.other.key.java"]]],
            ["modifier:java", [["storage.modifier.java"]]],
            ["*.constructor:java", [["entity.name.function.java"]]],
        ]);
        // Selector language and hierarchy: annotation is a subtype of type, score 100 + 10 for java.
        const annotation = registry.getTokenStylingDefaultRules()[before].selector;
        expect(annotation.match("annotation", [], "java")).toBe(110);
        expect(annotation.match("annotation", [], "kotlin")).toBe(-1);
        expect(registry.parseTokenSelector("type").match("annotation", [], "java")).toBe(99);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it("space in a scope means a scope path; without language — a selector for all languages", () => {
        const registry = new TokenClassificationRegistry();
        registerExtensionSemanticTokens(
            [ext({ semanticTokenScopes: [{ scopes: { decorator: ["meta.decorator entity.name.function"] } }] })],
            registry,
        );
        const [rule] = registry.getTokenStylingDefaultRules();
        expect(rule.defaults.scopesToProbe).toEqual([["meta.decorator", "entity.name.function"]]);
        expect(rule.selector.match("decorator", [], "python")).toBe(100);
    });

    it("extensions without contributes or semantics leave the registry alone and log no errors", () => {
        const registry = new TokenClassificationRegistry();
        const logger = createLoggerSpy();
        registerExtensionSemanticTokens([ext(undefined), ext({ themes: [] })], registry, logger);
        expect(logger.error).not.toHaveBeenCalled();
        expect(registry.getTokenTypes()).toEqual([]);
        expect(registry.getTokenModifiers()).toEqual([]);
        expect(registry.getTokenStylingDefaultRules()).toEqual([]);
    });

    it("invalid entries — a logged error with the extension id (upstream texts) and skip", () => {
        const registry = new TokenClassificationRegistry();
        const logger = createLoggerSpy();
        registerExtensionSemanticTokens(
            [
                ext(
                    {
                        semanticTokenTypes: [
                            "nope",
                            { id: "", description: "d" },
                            { id: "bad id", description: "d" },
                            { id: "t", superType: "bad id", description: "d" },
                            { id: "t", superType: 1, description: "d" },
                            { id: "t" },
                            { id: "ok", description: "d" },
                        ],
                        semanticTokenModifiers: [{ id: "m" }, { id: "mod", description: "d" }],
                        semanticTokenScopes: [
                            { language: 1, scopes: { a: ["x"] } },
                            { scopes: "x" },
                            "x",
                            { scopes: { a: "x", b: [1], c: ["y"] } },
                        ],
                    },
                    "pub.bad",
                ),
                ext({ semanticTokenTypes: {}, semanticTokenModifiers: "x", semanticTokenScopes: 1 }, "pub.worse"),
            ],
            registry,
            logger,
        );
        expect(registry.getTokenTypes().map((t) => t.id)).toEqual(["ok"]);
        expect(registry.getTokenModifiers().map((m) => m.id)).toEqual(["mod"]);
        expect(registry.getTokenStylingDefaultRules().map((r) => r.selector.id)).toEqual(["c"]);
        expect(logger.error.mock.calls.map((c) => c[0] as string)).toEqual([
            "pub.bad: 'configuration.semanticTokenType.id' must be defined and can not be empty",
            "pub.bad: 'configuration.semanticTokenType.id' must be defined and can not be empty",
            "pub.bad: 'configuration.semanticTokenType.id' must follow the pattern letterOrDigit[-_letterOrDigit]*",
            "pub.bad: 'configuration.semanticTokenType.superType' must follow the pattern letterOrDigit[-_letterOrDigit]*",
            "pub.bad: 'configuration.semanticTokenType.superType' must follow the pattern letterOrDigit[-_letterOrDigit]*",
            "pub.bad: 'configuration.semanticTokenType.description' must be defined and can not be empty",
            "pub.bad: 'configuration.semanticTokenModifier.description' must be defined and can not be empty",
            "pub.bad: 'configuration.semanticTokenScopes.language' must be a string",
            "pub.bad: 'configuration.semanticTokenScopes.scopes' must be defined as an object",
            "pub.bad: 'configuration.semanticTokenScopes.scopes' must be defined as an object",
            "pub.bad: 'configuration.semanticTokenScopes.scopes' values must be an array of strings",
            "pub.bad: 'configuration.semanticTokenScopes.scopes' values must be an array of strings",
            "pub.worse: 'configuration.semanticTokenType' must be an array",
            "pub.worse: 'configuration.semanticTokenModifier' must be an array",
            "pub.worse: 'configuration.semanticTokenScopes' must be an array",
        ]);
    });

    it("null entries and a non-string id are an error, not a crash; a mixed scope array is rejected", () => {
        const registry = new TokenClassificationRegistry();
        const logger = createLoggerSpy();
        registerExtensionSemanticTokens(
            [
                ext({
                    semanticTokenTypes: [null, { id: 5, description: "d" }],
                    semanticTokenModifiers: [null],
                    semanticTokenScopes: [null, { scopes: { a: ["x", 1], b: ["y"] } }],
                }),
            ],
            registry,
            logger,
        );
        expect(registry.getTokenTypes()).toEqual([]);
        expect(registry.getTokenModifiers()).toEqual([]);
        expect(registry.getTokenStylingDefaultRules().map((r) => r.selector.id)).toEqual(["b"]);
        expect(logger.error.mock.calls.map((c) => c[0] as string)).toEqual([
            "test.sem: 'configuration.semanticTokenType.id' must be defined and can not be empty",
            "test.sem: 'configuration.semanticTokenType.id' must be defined and can not be empty",
            "test.sem: 'configuration.semanticTokenModifier.id' must be defined and can not be empty",
            "test.sem: 'configuration.semanticTokenScopes.scopes' must be defined as an object",
            "test.sem: 'configuration.semanticTokenScopes.scopes' values must be an array of strings",
        ]);
    });

    it("without a logger errors do not break registration", () => {
        const registry = new TokenClassificationRegistry();
        expect(() => {
            registerExtensionSemanticTokens([ext({ semanticTokenTypes: [{ id: "" }] })], registry);
        }).not.toThrow();
    });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type ReadSetting, serverSettings } from "./serverSettings.ts";

function readerOver(values: Readonly<Record<string, unknown>>): ReadSetting {
    return <T>(key: string, fallback: T): T => (key in values ? (values[key] as T) : fallback);
}

const DEFAULT_INLAY_HINTS = {
    includeInlayParameterNameHints: "none",
    includeInlayParameterNameHintsWhenArgumentMatchesName: false,
    includeInlayFunctionParameterTypeHints: false,
    includeInlayVariableTypeHints: false,
    includeInlayVariableTypeHintsWhenTypeMatchesName: false,
    includeInlayPropertyDeclarationTypeHints: false,
    includeInlayFunctionLikeReturnTypeHints: false,
    includeInlayEnumMemberValueHints: false,
};
const DEFAULT_REFERENCES = { enabled: false, showOnAllFunctions: false };

describe("serverSettings", () => {
    it("the defaults ask the server for nothing", () => {
        expect(serverSettings(readerOver({}))).toEqual({
            typescript: {
                inlayHints: DEFAULT_INLAY_HINTS,
                referencesCodeLens: DEFAULT_REFERENCES,
                implementationsCodeLens: { enabled: false, showOnInterfaceMethods: false },
            },
            javascript: { inlayHints: DEFAULT_INLAY_HINTS, referencesCodeLens: DEFAULT_REFERENCES },
        });
    });

    it("every upstream key of a language lands on its own server preference", () => {
        const settings = serverSettings(
            readerOver({
                "typescript.inlayHints.parameterNames.enabled": "all",
                "typescript.inlayHints.parameterNames.suppressWhenArgumentMatchesName": false,
                "typescript.inlayHints.parameterTypes.enabled": true,
                "typescript.inlayHints.variableTypes.enabled": true,
                "typescript.inlayHints.variableTypes.suppressWhenTypeMatchesName": false,
                "typescript.inlayHints.propertyDeclarationTypes.enabled": true,
                "typescript.inlayHints.functionLikeReturnTypes.enabled": true,
                "typescript.inlayHints.enumMemberValues.enabled": true,
                "typescript.referencesCodeLens.enabled": true,
                "typescript.referencesCodeLens.showOnAllFunctions": true,
                "typescript.implementationsCodeLens.enabled": true,
                "typescript.implementationsCodeLens.showOnInterfaceMethods": true,
            }),
        );
        expect(settings.typescript).toEqual({
            inlayHints: {
                includeInlayParameterNameHints: "all",
                includeInlayParameterNameHintsWhenArgumentMatchesName: true,
                includeInlayFunctionParameterTypeHints: true,
                includeInlayVariableTypeHints: true,
                includeInlayVariableTypeHintsWhenTypeMatchesName: true,
                includeInlayPropertyDeclarationTypeHints: true,
                includeInlayFunctionLikeReturnTypeHints: true,
                includeInlayEnumMemberValueHints: true,
            },
            referencesCodeLens: { enabled: true, showOnAllFunctions: true },
            implementationsCodeLens: { enabled: true, showOnInterfaceMethods: true },
        });
        // The other language stays apart.
        expect(settings.javascript).toEqual({
            inlayHints: DEFAULT_INLAY_HINTS,
            referencesCodeLens: DEFAULT_REFERENCES,
        });
    });

    it("javascript reads its own keys", () => {
        const settings = serverSettings(
            readerOver({
                "javascript.inlayHints.variableTypes.enabled": true,
                "javascript.referencesCodeLens.enabled": true,
            }),
        );
        expect(settings.javascript).toEqual({
            inlayHints: { ...DEFAULT_INLAY_HINTS, includeInlayVariableTypeHints: true },
            referencesCodeLens: { enabled: true, showOnAllFunctions: false },
        });
    });

    it("the manifest declares upstream's defaults: the fallbacks here are the same values", () => {
        const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
            contributes: { configuration: { properties: Record<string, { default: unknown }> } };
        };
        const { properties } = manifest.contributes.configuration;
        const fallbackOf = new Map<string, unknown>();
        serverSettings(<T>(key: string, fallback: T): T => {
            fallbackOf.set(key, fallback);
            return fallback;
        });
        // Upstream has no enum members in JavaScript: the key is read, as for TypeScript, but is not declared.
        fallbackOf.delete("javascript.inlayHints.enumMemberValues.enabled");
        for (const [key, fallback] of fallbackOf) {
            expect(properties[key].default, key).toEqual(fallback);
        }
    });
});

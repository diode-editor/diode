import { describe, expect, it, vi } from "vitest";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import { LanguageId } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { ITokenizationSupport } from "../../../../editor/common/languages.ts";
import { NULL_STATE } from "../../../../editor/common/languages/iState.ts";
import { nullTokenizeEncoded } from "../../../../editor/common/languages/nullTokenize.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { TextMateGrammarLoader } from "../../textMate/common/textMateGrammarLoader.ts";

import { ExtensionTokenizationContributor } from "./extensionTokenizationContributor.ts";

vi.mock("../../textMate/common/textMateGrammarLoader.ts", () => {
    return {
        TextMateGrammarLoader: vi.fn().mockImplementation(function () {
            return { loadSupport: vi.fn(), dispose: vi.fn() };
        }),
    };
});

const MockedLoader = vi.mocked(TextMateGrammarLoader);

function makeStubSupport(): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeEncoded: () => nullTokenizeEncoded(LanguageId.Null, NULL_STATE),
    };
}

function makeExtWithGrammar(): IExtension {
    return {
        id: "vscode.typescript",
        location: "Extensions/builtin/ts/",
        isBuiltin: true,
        manifest: {
            name: "typescript",
            publisher: "vscode",
            version: "1.0.0",
            engines: { vscode: "*" },
            contributes: {
                grammars: [{ language: "typescript", scopeName: "source.ts", path: "./syntaxes/ts.tmLanguage.json" }],
            },
        },
    } as IExtension;
}

function makeExtWithoutGrammar(): IExtension {
    return {
        id: "vscode.theme-only",
        location: "Extensions/builtin/theme/",
        isBuiltin: true,
        manifest: {
            name: "theme-only",
            publisher: "vscode",
            version: "1.0.0",
            engines: { vscode: "*" },
            contributes: {},
        },
    } as IExtension;
}

const dummyAssets = {} as IAssetAccess;

describe("ExtensionTokenizationContributor — grammar collection", () => {
    it("returns early and never creates a loader when no extension contributes grammars", async () => {
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(
            dummyAssets,
            [makeExtWithoutGrammar(), makeExtWithoutGrammar()],
            registry,
        );

        contributor.apply();

        expect(MockedLoader).not.toHaveBeenCalled();
        expect(() => {
            contributor.dispose();
        }).not.toThrow();
    });

    it("skips extensions without grammars and registers only the contributing ones", async () => {
        const support = makeStubSupport();
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport: vi.fn().mockResolvedValue(support), dispose: vi.fn() } as never;
        });

        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(
            dummyAssets,
            [makeExtWithoutGrammar(), makeExtWithGrammar()],
            registry,
        );

        contributor.apply();

        expect(MockedLoader).toHaveBeenCalledTimes(1);
        const records = MockedLoader.mock.calls[0][1];
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ scopeName: "source.ts" });

        expect(await registry.load("typescript")).toBe(support);

        contributor.dispose();
    });
});

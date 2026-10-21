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

function makeExtWithTwoGrammars(): IExtension {
    return {
        id: "vscode.pack",
        location: "Extensions/builtin/pack/",
        isBuiltin: true,
        manifest: {
            name: "pack",
            publisher: "vscode",
            version: "1.0.0",
            engines: { vscode: "*" },
            contributes: {
                grammars: [
                    { language: "typescript", scopeName: "source.ts", path: "./ts.json" },
                    { language: "css", scopeName: "source.css", path: "./css.json" },
                ],
            },
        },
    } as IExtension;
}

const dummyAssets = {} as IAssetAccess;

describe("ExtensionTokenizationContributor — background preload", () => {
    it("preloadAll() загружает все зарегистрированные языки", async () => {
        const loadSupport = vi.fn().mockResolvedValue(makeStubSupport());
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport, dispose: vi.fn() } as never;
        });

        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(dummyAssets, [makeExtWithTwoGrammars()], registry);
        contributor.apply();

        expect(loadSupport).not.toHaveBeenCalled();

        await contributor.preloadAll();

        expect(loadSupport).toHaveBeenCalledTimes(2);
        expect(registry.get("typescript")).toBeDefined();
        expect(registry.get("css")).toBeDefined();

        contributor.dispose();
    });

    it("preloadAll() не перезагружает язык, который уже подтянул редактор", async () => {
        const loadSupport = vi.fn().mockResolvedValue(makeStubSupport());
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport, dispose: vi.fn() } as never;
        });

        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(dummyAssets, [makeExtWithTwoGrammars()], registry);
        contributor.apply();

        await registry.load("typescript");
        await contributor.preloadAll();

        // ts + css, not ts twice: load() is idempotent.
        expect(loadSupport).toHaveBeenCalledTimes(2);
    });

    it("preloadAll() прекращает работу, если contributor задиспозили на лету", async () => {
        let resolveFirst!: (support: ITokenizationSupport) => void;
        const first = new Promise<ITokenizationSupport>((r) => (resolveFirst = r));
        const loadSupport = vi.fn().mockReturnValueOnce(first).mockResolvedValue(makeStubSupport());
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport, dispose: vi.fn() } as never;
        });

        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(dummyAssets, [makeExtWithTwoGrammars()], registry);
        contributor.apply();

        const preloading = contributor.preloadAll();
        // The first language is still in flight; dispose the contributor under it.
        contributor.dispose();
        resolveFirst(makeStubSupport());
        await preloading;

        expect(loadSupport).toHaveBeenCalledTimes(1);
        expect(registry.get("typescript")).toBeUndefined();
        expect(registry.get("css")).toBeUndefined();
    });
});

import { describe, expect, it, vi } from "vitest";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
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

function createLoggerSpy(): ILogger & { error: ReturnType<typeof vi.fn> } {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    } as unknown as ILogger & { error: ReturnType<typeof vi.fn> };
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

const dummyAssets = {} as IAssetAccess;

function deferred<T>(): { promise: Promise<T>; reject: (err: unknown) => void } {
    let reject!: (err: unknown) => void;
    const promise = new Promise<T>((_, r) => (reject = r));
    return { promise, reject };
}

describe("ExtensionTokenizationContributor — error handling", () => {
    it("logs an error and registers nothing when loadSupport() returns null", async () => {
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport: vi.fn().mockResolvedValue(null), dispose: vi.fn() } as never;
        });

        const logger = createLoggerSpy();
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(dummyAssets, [makeExtWithGrammar()], registry, logger);

        contributor.apply();
        await registry.load("typescript");

        expect(registry.get("typescript")).toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Failed to load grammar "source.ts" for language "typescript"'),
        );
    });

    it("logs an error when loadSupport() throws", async () => {
        const boom = new Error("grammar parse error");
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport: vi.fn().mockRejectedValue(boom), dispose: vi.fn() } as never;
        });

        const logger = createLoggerSpy();
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(dummyAssets, [makeExtWithGrammar()], registry, logger);

        contributor.apply();
        // load() swallows the factory throw and resolves to undefined, otherwise
        // `void load(...)` in EditorComponent would cause an unhandled rejection.
        await expect(registry.load("typescript")).resolves.toBeUndefined();

        expect(registry.get("typescript")).toBeUndefined();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining('Error loading grammar "source.ts" (typescript)'),
            boom,
        );
    });

    it("stays silent when dispose() tears the loader down under an in-flight load", async () => {
        const gate = deferred<never>();
        MockedLoader.mockImplementationOnce(function () {
            return { loadSupport: vi.fn().mockReturnValue(gate.promise), dispose: vi.fn() } as never;
        });

        const logger = createLoggerSpy();
        const registry = new TokenizationRegistry();
        const contributor = new ExtensionTokenizationContributor(dummyAssets, [makeExtWithGrammar()], registry, logger);

        contributor.apply();
        const loading = registry.load("typescript");
        contributor.dispose();
        gate.reject(new Error("Registry has been disposed"));

        await expect(loading).resolves.toBeUndefined();
        expect(logger.error).not.toHaveBeenCalled();
        expect(registry.get("typescript")).toBeUndefined();
    });
});

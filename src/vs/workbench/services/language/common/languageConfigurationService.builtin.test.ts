import { describe, expect, it } from "vitest";

import { createDevAssetAccess } from "../../../../base/node/assets/createDefaultAssetAccess.ts";
import { EMPTY_LANGUAGE_CONFIGURATION } from "../../../../editor/common/languages/languageConfiguration.ts";
import { scanExtensions } from "../../../../platform/extensions/common/extensionScanner.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { LanguageConfigurationService } from "./languageConfigurationService.ts";
import { LanguageRegistry } from "./languageRegistry.ts";

const SILENT_LOGGER: ILogger = {
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    isEnabled: () => false,
};

/**
 * Интеграция по конвенции «фича поверх стокового расширения»: та же цепочка,
 * что в production bootstrap (`main.ts`) — scanExtensions → LanguageRegistry
 * (даёт `configurationPath`) → LanguageConfigurationService — на НАСТОЯЩИХ
 * файлах builtin-паков из `extensions/`. Ловит то, чего не видят юниты на
 * синтетике: реальный JSONC с комментариями/висячими запятыми и склейку
 * виртуального пути из манифеста.
 */
async function createBuiltinService(): Promise<LanguageConfigurationService> {
    const assets = createDevAssetAccess();
    const registry = new LanguageRegistry();
    for (const ext of await scanExtensions(assets, "Extensions/builtin/", {}, SILENT_LOGGER)) {
        registry.register(ext);
    }
    return new LanguageConfigurationService(assets, registry, SILENT_LOGGER);
}

describe("LanguageConfigurationService over builtin language packs", () => {
    it("loads the stock typescript configuration (JSONC with comments and trailing commas)", async () => {
        const service = await createBuiltinService();

        const config = await service.ensureLoaded("typescript");
        expect(config.comments).toEqual({ lineComment: "//", blockComment: ["/*", "*/"] });
        expect(config.brackets).toContainEqual(["{", "}"]);
        expect(config.autoClosingPairs).toContainEqual({ open: "{", close: "}", notIn: [] });
        expect(config.surroundingPairs).toContainEqual(["'", "'"]);
    });

    it("css has only block comment tokens — the fallback language for commentLine", async () => {
        const service = await createBuiltinService();

        const config = await service.ensureLoaded("css");
        expect(config.comments).toEqual({ lineComment: undefined, blockComment: ["/*", "*/"] });
    });

    it("typescript and typescriptreact share one configuration file and both resolve", async () => {
        const service = await createBuiltinService();

        const ts = await service.ensureLoaded("typescript");
        const tsx = await service.ensureLoaded("typescriptreact");
        expect(tsx.comments).toEqual(ts.comments);
        expect(tsx.autoClosingPairs).toEqual(ts.autoClosingPairs);
    });

    it("plaintext has no configuration file and resolves to the empty configuration", async () => {
        const service = await createBuiltinService();
        expect(await service.ensureLoaded("plaintext")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
    });
});

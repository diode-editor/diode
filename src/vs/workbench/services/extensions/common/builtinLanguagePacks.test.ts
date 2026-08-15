import { describe, expect, it } from "vitest";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import { createDevAssetAccess } from "../../../../base/node/assets/createDefaultAssetAccess.ts";
import { scanBuiltinExtensions } from "../../../../platform/extensions/common/extensionScanner.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { LanguageRegistry } from "../../language/common/languageRegistry.ts";

const ROOT_PREFIX = "Extensions/builtin/";

/**
 * Smoke-тест реального содержимого `src/Extensions/builtin/` —
 * ловит ошибки импорта паков из microsoft/vscode
 * (см. scripts/import-vscode-extensions.mjs): битые манифесты,
 * потерянные при strip'е файлы грамматик/конфигураций.
 */
describe("builtin language packs", () => {
    const assets = createDevAssetAccess();

    async function scanAll(): Promise<IExtension[]> {
        return scanBuiltinExtensions(assets, ROOT_PREFIX);
    }

    it("сканирует все паки без потерь", async () => {
        const extensions = await scanAll();
        // Языковые паки импортированы из microsoft/vscode (publisher "vscode").
        // Помимо них в builtin/ живут first-party Vexx-расширения (напр. git,
        // publisher "diode") — не языковые паки, поэтому исключаются из счётчика.
        const languagePacks = extensions.filter((e) => e.manifest.publisher === "vscode");
        expect(languagePacks.length).toBeGreaterThanOrEqual(48);
        for (const ext of extensions) {
            expect(["vscode", "diode"]).toContain(ext.manifest.publisher);
        }
    });

    it("резолвит language id для типичных файлов", async () => {
        const registry = new LanguageRegistry();
        for (const ext of await scanAll()) registry.register(ext);

        expect(registry.getLanguageIdForResource("main.py")).toBe("python");
        expect(registry.getLanguageIdForResource("Makefile")).toBe("makefile");
        expect(registry.getLanguageIdForResource("lib.rs")).toBe("rust");
        expect(registry.getLanguageIdForResource("Dockerfile")).toBe("dockerfile");
        expect(registry.getLanguageIdForResource("README.md")).toBe("markdown");
        expect(registry.getLanguageIdForResource("app.tsx")).toBe("typescriptreact");
        expect(registry.getLanguageIdForResource("config.yaml")).toBe("yaml");
        expect(registry.getLanguageIdForResource("script.sh")).toBe("shellscript");
    });

    it("все файлы грамматик и language-configuration существуют", async () => {
        const extensions = await scanAll();
        const missing: string[] = [];

        for (const ext of extensions) {
            for (const grammar of ext.manifest.contributes?.grammars ?? []) {
                const virtualPath = joinVirtualPath(ext.location, grammar.path);
                if (!(await assets.exists(virtualPath))) missing.push(virtualPath);
            }
            for (const lang of ext.manifest.contributes?.languages ?? []) {
                if (lang.configuration === undefined) continue;
                const virtualPath = joinVirtualPath(ext.location, lang.configuration);
                if (!(await assets.exists(virtualPath))) missing.push(virtualPath);
            }
        }

        expect(missing).toEqual([]);
    });
});

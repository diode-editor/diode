import { describe, expect, it } from "vitest";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import { EMPTY_LANGUAGE_CONFIGURATION } from "../../../../editor/common/languages/languageConfiguration.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { LanguageConfigurationService } from "./languageConfigurationService.ts";

// `languages.setLanguageConfiguration` layers over language-configuration.json,
// as upstream `ComposedLanguageConfiguration`: a layer field replaces the file field,
// a later layer wins over an earlier one, and the merged result is what gets expanded.

const GO_CONFIG_PATH = "ext/go/language-configuration.json";
const GO_FILE = JSON.stringify({
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [
        ["{", "}"],
        ["(", ")"],
    ],
    autoCloseBefore: ";",
});

function createService(
    paths: Record<string, string | undefined> = { go: GO_CONFIG_PATH },
): LanguageConfigurationService {
    const assets = {
        readText: (path: string) =>
            path === GO_CONFIG_PATH ? Promise.resolve(GO_FILE) : Promise.reject(new Error(`no asset: ${path}`)),
    } as unknown as IAssetAccess;
    return new LanguageConfigurationService(
        assets,
        { getLanguage: (languageId) => (languageId in paths ? { configurationPath: paths[languageId] } : undefined) },
        NULL_LOGGER,
    );
}

describe("LanguageConfigurationService: extension layers", () => {
    it("a layer section replaces the file section entirely, the rest come from the file", async () => {
        const service = createService();
        service.register("go", { comments: { lineComment: "#" } });
        const resolved = await service.ensureLoaded("go");
        expect(resolved.comments).toEqual({ lineComment: "#", blockComment: undefined });
        expect(resolved.brackets).toEqual([
            ["{", "}"],
            ["(", ")"],
        ]);
        expect(resolved.autoCloseBefore).toBe(";");
    });

    it("a layer that arrives before loading does not make the language ready before the file", async () => {
        const service = createService();
        service.register("go", { brackets: [["[", "]"]] });
        expect(service.get("go")).toBeUndefined();
        await service.ensureLoaded("go");
        expect(service.get("go")?.brackets).toEqual([["[", "]"]]);
    });

    it("a layer after loading is visible immediately; auto-closing pairs derive from the layer's brackets", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        service.register("go", { brackets: [["<", ">"]] });
        expect(service.get("go")?.autoClosingPairs).toEqual([{ open: "<", close: ">", notIn: [] }]);
        expect(service.get("go")?.surroundingPairs).toEqual([["<", ">"]]);
    });

    it("a later layer beats an earlier one; a removed layer brings back the previous one", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        const first = service.register("go", { comments: { lineComment: "#" } });
        const second = service.register("go", { comments: { lineComment: "--" } });
        expect(service.get("go")?.comments?.lineComment).toBe("--");
        second.dispose();
        expect(service.get("go")?.comments?.lineComment).toBe("#");
        // A repeated dispose is harmless and does not remove someone else's layer.
        second.dispose();
        expect(service.get("go")?.comments?.lineComment).toBe("#");
        first.dispose();
        expect(service.get("go")?.comments?.lineComment).toBe("//");
    });

    it("an undefined layer field does not erase the file section", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        service.register("go", { comments: undefined, brackets: [["{", "}"]] });
        expect(service.get("go")?.comments?.lineComment).toBe("//");
        expect(service.get("go")?.brackets).toEqual([["{", "}"]]);
    });

    it("a language without a file: with a layer, the layer's configuration; without, empty", async () => {
        const service = createService({ gofixture: undefined });
        expect(await service.ensureLoaded("gofixture")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        const layer = service.register("gofixture", { comments: { lineComment: "//" } });
        expect(service.get("gofixture")?.comments).toEqual({ lineComment: "//", blockComment: undefined });
        layer.dispose();
        expect(service.get("gofixture")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
    });

    it("a layer of one language does not touch another", async () => {
        const service = createService({ go: GO_CONFIG_PATH, other: undefined });
        await service.ensureLoaded("go");
        await service.ensureLoaded("other");
        service.register("other", { comments: { lineComment: ";" } });
        expect(service.get("go")?.comments?.lineComment).toBe("//");
        expect(service.get("other")?.comments?.lineComment).toBe(";");
    });

    it("the expanded configuration is cached until the layers change", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        const before = service.get("go");
        expect(service.get("go")).toBe(before);
        service.register("go", {}).dispose();
        expect(service.get("go")).not.toBe(before);
        expect(service.get("go")).toEqual(before);
    });
});

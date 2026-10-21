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

describe("LanguageConfigurationService — слои расширений", () => {
    it("секция слоя заменяет секцию файла целиком, остальные — из файла", async () => {
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

    it("слой, пришедший до загрузки, не делает язык готовым раньше файла", async () => {
        const service = createService();
        service.register("go", { brackets: [["[", "]"]] });
        expect(service.get("go")).toBeUndefined();
        await service.ensureLoaded("go");
        expect(service.get("go")?.brackets).toEqual([["[", "]"]]);
    });

    it("слой после загрузки виден сразу; пары авто-закрытия выводятся из скобок слоя", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        service.register("go", { brackets: [["<", ">"]] });
        expect(service.get("go")?.autoClosingPairs).toEqual([{ open: "<", close: ">", notIn: [] }]);
        expect(service.get("go")?.surroundingPairs).toEqual([["<", ">"]]);
    });

    it("поздний слой побеждает ранний; снятый слой возвращает предыдущий", async () => {
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

    it("undefined-поле слоя не затирает секцию файла", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        service.register("go", { comments: undefined, brackets: [["{", "}"]] });
        expect(service.get("go")?.comments?.lineComment).toBe("//");
        expect(service.get("go")?.brackets).toEqual([["{", "}"]]);
    });

    it("язык без файла: со слоем — конфигурация слоя, без слоя — пустая", async () => {
        const service = createService({ gofixture: undefined });
        expect(await service.ensureLoaded("gofixture")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        const layer = service.register("gofixture", { comments: { lineComment: "//" } });
        expect(service.get("gofixture")?.comments).toEqual({ lineComment: "//", blockComment: undefined });
        layer.dispose();
        expect(service.get("gofixture")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
    });

    it("слой одного языка не трогает другой", async () => {
        const service = createService({ go: GO_CONFIG_PATH, other: undefined });
        await service.ensureLoaded("go");
        await service.ensureLoaded("other");
        service.register("other", { comments: { lineComment: ";" } });
        expect(service.get("go")?.comments?.lineComment).toBe("//");
        expect(service.get("other")?.comments?.lineComment).toBe(";");
    });

    it("развёрнутая конфигурация кэшируется до смены слоёв", async () => {
        const service = createService();
        await service.ensureLoaded("go");
        const before = service.get("go");
        expect(service.get("go")).toBe(before);
        service.register("go", {}).dispose();
        expect(service.get("go")).not.toBe(before);
        expect(service.get("go")).toEqual(before);
    });
});

import { describe, expect, it } from "vitest";

import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";

import { getDefinitions } from "./goToSymbol.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IDefinitionRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 10,
};
const target = (line: number) => ({ uri: "file:///w/defs.ts", range: createRange(line, 0, line, 1) });

describe("getDefinitions — агрегация по реестру", () => {
    it("склеивает ответы в порядке реестра; сбойный провайдер — «целей нет»", async () => {
        const registry = new LanguageFeaturesService().definitionProvider;
        registry.register("*", { provideDefinition: () => Promise.resolve([target(2)]) });
        registry.register("*", { provideDefinition: () => Promise.reject(new Error("boom")) });
        registry.register("typescript", { provideDefinition: () => Promise.resolve([target(1)]) });

        expect(await getDefinitions(registry, TS, REQUEST, new CancellationTokenSource().token)).toEqual([
            target(1),
            target(2),
        ]);
    });

    it("каждый провайдер получает токен запроса", async () => {
        const registry = new LanguageFeaturesService().definitionProvider;
        const seen: ICancellationToken[] = [];
        const provider = {
            provideDefinition: (_request: IDefinitionRequest, token: ICancellationToken) => {
                seen.push(token);
                return Promise.resolve([]);
            },
        };
        registry.register("*", provider);
        registry.register("typescript", provider);
        const token = new CancellationTokenSource().token;

        await getDefinitions(registry, TS, REQUEST, token);

        expect(seen).toEqual([token, token]);
    });
});

import { describe, expect, it } from "vitest";

import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";

import { getReferences } from "./getReferences.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IReferenceRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 10,
    includeDeclaration: true,
};
const ref = (line: number) => ({ uri: "file:///w/use.ts", range: createRange(line, 0, line, 1) });

describe("getReferences — агрегация по реестру", () => {
    it("склеивает ответы в порядке реестра; сбойный провайдер — «ссылок нет»", async () => {
        const registry = new LanguageFeaturesService().referenceProvider;
        registry.register("*", { provideReferences: () => Promise.resolve([ref(2)]) });
        registry.register("*", { provideReferences: () => Promise.reject(new Error("boom")) });
        registry.register("typescript", { provideReferences: () => Promise.resolve([ref(1)]) });

        expect(await getReferences(registry, TS, REQUEST, new CancellationTokenSource().token)).toEqual([
            ref(1),
            ref(2),
        ]);
    });

    it("каждый провайдер получает токен запроса", async () => {
        const registry = new LanguageFeaturesService().referenceProvider;
        const seen: ICancellationToken[] = [];
        const provider = {
            provideReferences: (_request: IReferenceRequest, token: ICancellationToken) => {
                seen.push(token);
                return Promise.resolve([]);
            },
        };
        registry.register("*", provider);
        registry.register("typescript", provider);
        const token = new CancellationTokenSource().token;

        await getReferences(registry, TS, REQUEST, token);

        expect(seen).toEqual([token, token]);
    });
});

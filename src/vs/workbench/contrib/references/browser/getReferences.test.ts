import { describe, expect, it } from "vitest";

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

        expect(await getReferences(registry, TS, REQUEST)).toEqual([ref(1), ref(2)]);
    });
});

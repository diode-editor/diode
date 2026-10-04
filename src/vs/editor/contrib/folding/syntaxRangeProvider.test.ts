import { describe, expect, it } from "vitest";

import type { IFoldingRequest } from "../../common/languages/iFoldingSource.ts";

import { provideFoldingRanges } from "./syntaxRangeProvider.ts";

const REQUEST: IFoldingRequest = { uri: "file:///w/a.cs", languageId: "csharp", versionId: 1 };
const region = (startLine: number) => ({ startLine, endLine: startLine + 2, isCollapsed: false });

describe("provideFoldingRanges — агрегация провайдеров", () => {
    it("склеивает области в порядке провайдеров; сбойный — «областей нет»", async () => {
        const regions = await provideFoldingRanges(
            [
                { provideFoldingRanges: () => Promise.resolve([region(1)]) },
                { provideFoldingRanges: () => Promise.reject(new Error("boom")) },
                { provideFoldingRanges: () => Promise.resolve([region(5)]) },
            ],
            REQUEST,
        );

        expect(regions).toStrictEqual([region(1), region(5)]);
    });
});

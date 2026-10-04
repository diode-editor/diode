import { describe, expect, it } from "vitest";

import { CancellationTokenSource, type ICancellationToken } from "../../../base/common/cancellation.ts";
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
            new CancellationTokenSource().token,
        );

        expect(regions).toStrictEqual([region(1), region(5)]);
    });

    it("каждый провайдер получает токен запроса", async () => {
        const seen: ICancellationToken[] = [];
        const provider = {
            provideFoldingRanges: (_request: IFoldingRequest, token: ICancellationToken) => {
                seen.push(token);
                return Promise.resolve([]);
            },
        };
        const token = new CancellationTokenSource().token;

        await provideFoldingRanges([provider, provider], REQUEST, token);

        expect(seen).toEqual([token, token]);
    });
});

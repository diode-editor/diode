import { describe, expect, it } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    EvaluatableExpressionProvider,
    IEvaluatableExpression,
} from "../../../../editor/common/languages/iEvaluatableExpressionSource.ts";

import { getEvaluatableExpressionAtPosition, type IEvaluatableExpressionModel } from "./debugUtils.ts";

const LINES = ["int x = 0;", "    total = cfg.limits.max + nums.size();"];

const model: IEvaluatableExpressionModel = {
    uri: Uri.file("/w/main.cpp"),
    languageId: "cpp",
    versionId: 7,
    getLineContent: (line) => LINES[line],
};

function provider(answer: () => Promise<IEvaluatableExpression | null>): EvaluatableExpressionProvider {
    return { provideEvaluatableExpression: answer };
}

describe("getEvaluatableExpressionAtPosition", () => {
    it("without providers: the expression around the cursor up to the end of its part", async () => {
        const registry = new LanguageFeatureRegistry<EvaluatableExpressionProvider>();
        const at = (character: number) =>
            getEvaluatableExpressionAtPosition(registry, model, createPosition(1, character), CancellationTokenNone);

        // On `limits` of `cfg.limits.max`: `cfg.limits`.
        expect(await at(LINES[1].indexOf("limits") + 2)).toEqual({
            matchingExpression: "cfg.limits",
            range: createRange(1, LINES[1].indexOf("cfg"), 1, LINES[1].indexOf("cfg") + "cfg.limits".length),
        });
        expect(await at(LINES[1].indexOf("total"))).toEqual({
            matchingExpression: "total",
            range: createRange(1, 4, 1, 9),
        });
        // Whitespace has no expression.
        expect(await at(1)).toBeNull();
    });

    it("a provider's range without an expression is the text of the range; it is asked with the document's version", async () => {
        const registry = new LanguageFeatureRegistry<EvaluatableExpressionProvider>();
        const requests: unknown[] = [];
        registry.register("cpp", {
            provideEvaluatableExpression: (request) => {
                requests.push(request);
                return Promise.resolve({ range: createRange(1, 12, 1, 22) });
            },
        });

        const result = await getEvaluatableExpressionAtPosition(
            registry,
            model,
            createPosition(1, 14),
            CancellationTokenNone,
        );

        expect(result).toEqual({ matchingExpression: "cfg.limits", range: createRange(1, 12, 1, 22) });
        expect(requests).toEqual([
            { uri: "file:///w/main.cpp", languageId: "cpp", versionId: 7, position: createPosition(1, 14) },
        ]);
    });

    it("the first answer in the providers' order wins; a failing or empty provider is skipped", async () => {
        const registry = new LanguageFeatureRegistry<EvaluatableExpressionProvider>();
        registry.register(
            "cpp",
            provider(() => Promise.resolve({ range: createRange(0, 4, 0, 5), expression: "older" })),
        );
        registry.register(
            "cpp",
            provider(() => Promise.reject(new Error("boom"))),
        );
        registry.register(
            "cpp",
            provider(() => Promise.resolve(null)),
        );

        const result = await getEvaluatableExpressionAtPosition(
            registry,
            model,
            createPosition(0, 4),
            CancellationTokenNone,
        );

        expect(result).toEqual({ matchingExpression: "older", range: createRange(0, 4, 0, 5) });
    });

    it("providers with no answer leave no expression: the text around the cursor is not tried", async () => {
        const registry = new LanguageFeatureRegistry<EvaluatableExpressionProvider>();
        registry.register(
            "cpp",
            provider(() => Promise.resolve(null)),
        );

        expect(
            await getEvaluatableExpressionAtPosition(registry, model, createPosition(0, 4), CancellationTokenNone),
        ).toBeNull();
    });
});

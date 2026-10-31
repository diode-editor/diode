import { describe, expect, it } from "vitest";

import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IDefinitionRequest } from "../../../../editor/common/languages/iDefinitionSource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";

import { createLocationModel, getDefinitions, getImplementations } from "./goToSymbol.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IDefinitionRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    line: 0,
    character: 10,
};
const target = (line: number) => ({ uri: "file:///w/defs.ts", range: createRange(line, 0, line, 1) });

describe("createLocationModel", () => {
    const at = (uri: string, line: number, from: number, to: number) => ({
        uri,
        range: createRange(line, from, line, to),
    });

    it("sorts by uri, then by range start, then by range end", () => {
        const model = createLocationModel([
            at("file:///b.ts", 0, 0, 1),
            at("file:///a.ts", 3, 0, 1),
            at("file:///a.ts", 1, 4, 5),
            at("file:///a.ts", 1, 2, 9),
            at("file:///a.ts", 1, 2, 3),
        ]);

        expect(model.references).toEqual([
            at("file:///a.ts", 1, 2, 3),
            at("file:///a.ts", 1, 2, 9),
            at("file:///a.ts", 1, 4, 5),
            at("file:///a.ts", 3, 0, 1),
            at("file:///b.ts", 0, 0, 1),
        ]);
    });

    it("drops exact duplicates only, including non-adjacent ones in the response", () => {
        const model = createLocationModel([
            at("file:///a.ts", 1, 0, 3),
            at("file:///b.ts", 1, 0, 3),
            at("file:///a.ts", 1, 0, 3),
            at("file:///a.ts", 1, 0, 4),
        ]);

        expect(model.references).toEqual([
            at("file:///a.ts", 1, 0, 3),
            at("file:///a.ts", 1, 0, 4),
            at("file:///b.ts", 1, 0, 3),
        ]);
    });

    it("first is the provider's first target, not the first after sorting", () => {
        const model = createLocationModel([at("file:///b.ts", 9, 0, 1), at("file:///a.ts", 0, 0, 1)]);

        expect(model.first).toEqual(at("file:///b.ts", 9, 0, 1));
    });

    it("an empty response has no first target", () => {
        expect(createLocationModel([])).toEqual({ references: [], first: undefined });
    });
});

describe("getImplementations — aggregation over the registry", () => {
    it("merges responses; a failing provider means 'no targets'; each provider gets the request and token", async () => {
        const registry = new LanguageFeaturesService().implementationProvider;
        const seen: unknown[] = [];
        registry.register("*", {
            provideImplementation: (request, token) => {
                seen.push(request, token);
                return Promise.resolve([target(1)]);
            },
        });
        registry.register("*", { provideImplementation: () => Promise.reject(new Error("boom")) });
        registry.register("typescript", { provideImplementation: () => Promise.resolve([target(2)]) });
        const token = new CancellationTokenSource().token;

        const model = await getImplementations(registry, TS, REQUEST, token);

        expect(model.references).toEqual([target(1), target(2)]);
        expect(model.first).toEqual(target(2));
        expect(seen).toEqual([REQUEST, token]);
    });
});

describe("getDefinitions — aggregation over the registry", () => {
    it("merges responses; a failing provider means 'no targets'; first is in registry order", async () => {
        const registry = new LanguageFeaturesService().definitionProvider;
        registry.register("*", { provideDefinition: () => Promise.resolve([target(1)]) });
        registry.register("*", { provideDefinition: () => Promise.reject(new Error("boom")) });
        registry.register("typescript", { provideDefinition: () => Promise.resolve([target(2)]) });

        const model = await getDefinitions(registry, TS, REQUEST, new CancellationTokenSource().token);

        expect(model.references).toEqual([target(1), target(2)]);
        expect(model.first).toEqual(target(2));
    });

    it("each provider gets the request token", async () => {
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

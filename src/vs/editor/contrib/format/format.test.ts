import { describe, expect, it, vi } from "vitest";

import { CancellationTokenSource, type ICancellationToken } from "../../../base/common/cancellation.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import type { IFormattingRequest } from "../../common/languages/iFormattingSource.ts";
import { LanguageFeaturesService } from "../../common/services/languageFeaturesService.ts";

import { documentRange, formatDocument, formatRange, hasDocumentFormatter } from "./format.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IFormattingRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    versionId: 1,
    tabSize: 4,
    insertSpaces: true,
};
const WHOLE = documentRange("a\nbc\n\ndef");
const TOKEN = new CancellationTokenSource().token;
const edit = (text: string): ITextEdit => ({ range: createRange(0, 0, 0, 0), text });

describe("format: formatter selection from registries", () => {
    it("no providers means no formatter: null for both kinds, has is false", async () => {
        const features = new LanguageFeaturesService();
        expect(hasDocumentFormatter(features, TS)).toBe(false);
        expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN)).toBeNull();
        expect(await formatRange(features, TS, { ...REQUEST, range: createRange(0, 0, 0, 1) }, TOKEN)).toBeNull();
    });

    it("document formatter by score: exact language beats `*`", async () => {
        const features = new LanguageFeaturesService();
        const exact = vi.fn(() => Promise.resolve([edit("exact")]));
        features.documentFormattingEditProvider.register("typescript", { provideDocumentFormattingEdits: exact });
        features.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("any")]),
        });
        expect(hasDocumentFormatter(features, TS)).toBe(true);
        expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN)).toEqual([edit("exact")]);
        expect(exact).toHaveBeenCalledWith(REQUEST, TOKEN);
    });

    it("no document formatter: range provider formats the document over the full range", async () => {
        const features = new LanguageFeaturesService();
        const provide = vi.fn((_request: IFormattingRequest, _token: ICancellationToken) =>
            Promise.resolve([edit("synthetic")]),
        );
        features.documentRangeFormattingEditProvider.register("typescript", {
            provideDocumentRangeFormattingEdits: provide,
        });

        expect(hasDocumentFormatter(features, TS)).toBe(true);
        expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN)).toEqual([edit("synthetic")]);
        expect(provide.mock.calls[0]?.[0]).toEqual({ ...REQUEST, range: createRange(0, 0, 3, 3) });
        expect(provide.mock.calls[0]?.[1]).toBe(TOKEN);
    });

    it("document formatter is preferred over the synthetic one", async () => {
        const features = new LanguageFeaturesService();
        const synthetic = vi.fn(() => Promise.resolve([edit("synthetic")]));
        features.documentRangeFormattingEditProvider.register("typescript", {
            provideDocumentRangeFormattingEdits: synthetic,
        });
        features.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("real")]),
        });

        expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN)).toEqual([edit("real")]);
        expect(synthetic).not.toHaveBeenCalled();
    });

    it("Format Selection uses only the range provider, with the requested range", async () => {
        const features = new LanguageFeaturesService();
        features.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("document")]),
        });
        expect(await formatRange(features, TS, { ...REQUEST, range: createRange(1, 0, 1, 2) }, TOKEN)).toBeNull();

        const provide = vi.fn((_request: IFormattingRequest, _token: ICancellationToken) =>
            Promise.resolve([edit("range")]),
        );
        features.documentRangeFormattingEditProvider.register("*", { provideDocumentRangeFormattingEdits: provide });
        const ranged = { ...REQUEST, range: createRange(1, 0, 1, 2) };
        expect(await formatRange(features, TS, ranged, TOKEN)).toEqual([edit("range")]);
        expect(provide.mock.calls[0]?.[0]).toBe(ranged);
        expect(provide.mock.calls[0]?.[1]).toBe(TOKEN);
    });

    it("failing formatter yields an empty result (no-op), not no formatter", async () => {
        const features = new LanguageFeaturesService();
        const fail = (): Promise<readonly ITextEdit[]> => Promise.reject(new Error("boom"));
        features.documentRangeFormattingEditProvider.register("*", { provideDocumentRangeFormattingEdits: fail });
        expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN)).toEqual([]);
        expect(await formatRange(features, TS, { ...REQUEST, range: createRange(0, 0, 0, 1) }, TOKEN)).toEqual([]);

        features.documentFormattingEditProvider.register("*", { provideDocumentFormattingEdits: fail });
        expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN)).toEqual([]);
    });

    describe("editor.defaultFormatter", () => {
        function twoFormatters(): LanguageFeaturesService {
            const features = new LanguageFeaturesService();
            for (const extensionId of ["acme.first", "Acme.Second"]) {
                features.documentFormattingEditProvider.register("*", {
                    extensionId,
                    provideDocumentFormattingEdits: () => Promise.resolve([edit(`document ${extensionId}`)]),
                });
                features.documentRangeFormattingEditProvider.register("*", {
                    extensionId,
                    provideDocumentRangeFormattingEdits: () => Promise.resolve([edit(`range ${extensionId}`)]),
                });
            }
            return features;
        }
        const ranged = { ...REQUEST, range: createRange(0, 0, 0, 1) };

        it("picks the named extension wherever it stands in the order, ignoring case", async () => {
            for (const id of ["acme.first", "acme.second"]) {
                const name = id === "acme.first" ? "acme.first" : "Acme.Second";
                const features = twoFormatters();
                expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN, id)).toEqual([
                    edit(`document ${name}`),
                ]);
                expect(await formatRange(features, TS, ranged, TOKEN, id)).toEqual([edit(`range ${name}`)]);
            }
        });

        it("nothing configured: the first provider formats, null and an empty id alike", async () => {
            const features = twoFormatters();
            const [first] = features.documentFormattingEditProvider.ordered(TS);
            const expected = await first.provideDocumentFormattingEdits(REQUEST, TOKEN);
            for (const id of [undefined, null, ""]) {
                expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN, id)).toEqual(expected);
            }
        });

        it("a configured extension that is not there means no formatter, never another one", async () => {
            const features = twoFormatters();
            expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN, "acme.gone")).toBeNull();
            expect(await formatRange(features, TS, ranged, TOKEN, "acme.gone")).toBeNull();
        });

        it("the named extension with only a range provider formats the document over the full range", async () => {
            const features = twoFormatters();
            features.documentRangeFormattingEditProvider.register("*", {
                extensionId: "acme.rangeonly",
                provideDocumentRangeFormattingEdits: () => Promise.resolve([edit("synthetic")]),
            });
            expect(await formatDocument(features, TS, REQUEST, WHOLE, TOKEN, "acme.rangeonly")).toEqual([
                edit("synthetic"),
            ]);
        });

        it("Format Selection with a named extension that has no range provider: no formatter", async () => {
            const features = new LanguageFeaturesService();
            features.documentFormattingEditProvider.register("*", {
                extensionId: "acme.wholeonly",
                provideDocumentFormattingEdits: () => Promise.resolve([edit("document")]),
            });
            features.documentRangeFormattingEditProvider.register("*", {
                extensionId: "acme.other",
                provideDocumentRangeFormattingEdits: () => Promise.resolve([edit("other")]),
            });
            expect(await formatRange(features, TS, ranged, TOKEN, "acme.wholeonly")).toBeNull();
        });
    });

    it("documentRange spans (0,0) to the end of the last line, empty text gives an empty range", () => {
        expect(documentRange("a\nbc\n\ndef")).toEqual(createRange(0, 0, 3, 3));
        expect(documentRange("x\n")).toEqual(createRange(0, 0, 1, 0));
        expect(documentRange("")).toEqual(createRange(0, 0, 0, 0));
    });
});

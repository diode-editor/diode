import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import type { IFormattingRequest } from "../../common/languages/iFormattingSource.ts";
import { LanguageFeaturesService } from "../../common/services/languageFeaturesService.ts";

import { formatDocument, formatRange, hasDocumentFormatter } from "./format.ts";

const TS = { uri: Uri.file("/w/a.ts"), languageId: "typescript" };
const REQUEST: IFormattingRequest = {
    uri: TS.uri.toString(),
    languageId: "typescript",
    text: "a\nbc\n\ndef",
    tabSize: 4,
    insertSpaces: true,
};
const edit = (text: string): ITextEdit => ({ range: createRange(0, 0, 0, 0), text });

describe("format — выбор форматтера по реестрам", () => {
    it("без провайдеров — форматтера нет: null у обоих видов, has — false", async () => {
        const features = new LanguageFeaturesService();
        expect(hasDocumentFormatter(features, TS)).toBe(false);
        expect(await formatDocument(features, TS, REQUEST)).toBeNull();
        expect(await formatRange(features, TS, { ...REQUEST, range: createRange(0, 0, 0, 1) })).toBeNull();
    });

    it("документный форматтер — по score: точный язык выше `*`", async () => {
        const features = new LanguageFeaturesService();
        features.documentFormattingEditProvider.register("typescript", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("exact")]),
        });
        features.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("any")]),
        });
        expect(hasDocumentFormatter(features, TS)).toBe(true);
        expect(await formatDocument(features, TS, REQUEST)).toEqual([edit("exact")]);
    });

    it("документного нет — range-провайдер форматирует документ на полный диапазон", async () => {
        const features = new LanguageFeaturesService();
        const provide = vi.fn((_request: IFormattingRequest) => Promise.resolve([edit("synthetic")]));
        features.documentRangeFormattingEditProvider.register("typescript", {
            provideDocumentRangeFormattingEdits: provide,
        });

        expect(hasDocumentFormatter(features, TS)).toBe(true);
        expect(await formatDocument(features, TS, REQUEST)).toEqual([edit("synthetic")]);
        // От (0,0) до конца последней строки «def».
        expect(provide.mock.calls[0]?.[0]).toEqual({ ...REQUEST, range: createRange(0, 0, 3, 3) });
    });

    it("документный форматтер предпочтительнее синтетического", async () => {
        const features = new LanguageFeaturesService();
        const synthetic = vi.fn(() => Promise.resolve([edit("synthetic")]));
        features.documentRangeFormattingEditProvider.register("typescript", {
            provideDocumentRangeFormattingEdits: synthetic,
        });
        features.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("real")]),
        });

        expect(await formatDocument(features, TS, REQUEST)).toEqual([edit("real")]);
        expect(synthetic).not.toHaveBeenCalled();
    });

    it("Format Selection — только range-провайдер, с запрошенным диапазоном", async () => {
        const features = new LanguageFeaturesService();
        features.documentFormattingEditProvider.register("*", {
            provideDocumentFormattingEdits: () => Promise.resolve([edit("document")]),
        });
        expect(await formatRange(features, TS, { ...REQUEST, range: createRange(1, 0, 1, 2) })).toBeNull();

        const provide = vi.fn((_request: IFormattingRequest) => Promise.resolve([edit("range")]));
        features.documentRangeFormattingEditProvider.register("*", { provideDocumentRangeFormattingEdits: provide });
        const ranged = { ...REQUEST, range: createRange(1, 0, 1, 2) };
        expect(await formatRange(features, TS, ranged)).toEqual([edit("range")]);
        expect(provide.mock.calls[0]?.[0]).toBe(ranged);
    });

    it("сбойный форматтер — пустой ответ (no-op), не «нет форматтера»", async () => {
        const features = new LanguageFeaturesService();
        const fail = (): Promise<readonly ITextEdit[]> => Promise.reject(new Error("boom"));
        features.documentRangeFormattingEditProvider.register("*", { provideDocumentRangeFormattingEdits: fail });
        expect(await formatDocument(features, TS, REQUEST)).toEqual([]);
        expect(await formatRange(features, TS, { ...REQUEST, range: createRange(0, 0, 0, 1) })).toEqual([]);

        features.documentFormattingEditProvider.register("*", { provideDocumentFormattingEdits: fail });
        expect(await formatDocument(features, TS, REQUEST)).toEqual([]);
    });
});

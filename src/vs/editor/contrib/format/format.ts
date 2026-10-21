import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import type { ILanguageFeatureTarget } from "../../common/languageFeatureRegistry.ts";
import type { IFormattingRequest } from "../../common/languages/iFormattingSource.ts";
import type { ILanguageFeaturesService } from "../../common/services/languageFeatures.ts";

// Upstream `editor/contrib/format/browser/format.ts`: range-провайдеры — «синтетические»
// форматтеры документа на полный диапазон. `editor.defaultFormatter` и пикер не
// поддержаны (нужна идентичность расширения в регистрации).
//
// Ответы трёхзначные: `null` — форматтера нет, пустой массив — менять нечего (или
// провайдер сбойнул — молчаливый no-op), иначе — правки.

export function hasDocumentFormatter(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
): boolean {
    return (
        languageFeatures.documentFormattingEditProvider.has(target) ||
        languageFeatures.documentRangeFormattingEditProvider.has(target)
    );
}

/** `range` — весь документ ({@link documentRange}): текста в запросе range-форматтеру нет. */
export async function formatDocument(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
    request: IFormattingRequest,
    range: IRange,
    token: ICancellationToken,
): Promise<readonly ITextEdit[] | null> {
    const real = languageFeatures.documentFormattingEditProvider.ordered(target).at(0);
    if (real !== undefined) return real.provideDocumentFormattingEdits(request, token).catch(() => []);
    const synthetic = languageFeatures.documentRangeFormattingEditProvider.ordered(target).at(0);
    if (synthetic === undefined) return null;
    return synthetic.provideDocumentRangeFormattingEdits({ ...request, range }, token).catch(() => []);
}

export async function formatRange(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
    request: IFormattingRequest & { readonly range: IRange },
    token: ICancellationToken,
): Promise<readonly ITextEdit[] | null> {
    const provider = languageFeatures.documentRangeFormattingEditProvider.ordered(target).at(0);
    if (provider === undefined) return null;
    return provider.provideDocumentRangeFormattingEdits(request, token).catch(() => []);
}

/** `text` — LF-канонический. */
export function documentRange(text: string): IRange {
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    return createRange(0, 0, lastLine, lines[lastLine].length);
}

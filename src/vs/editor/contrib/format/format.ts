import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import type { ILanguageFeatureTarget } from "../../common/languageFeatureRegistry.ts";
import type { IFormattingRequest } from "../../common/languages/iFormattingSource.ts";
import type { ILanguageFeaturesService } from "../../common/services/languageFeatures.ts";

/**
 * Выбор форматтера по реестрам (upstream
 * `editor/contrib/format/browser/format.ts`): документные провайдеры по score,
 * за ними — range-провайдеры как «синтетические» форматтеры документа (на
 * полный диапазон; пометка vscode API у registerDocumentRangeFormattingEditProvider).
 * Берётся первый; `editor.defaultFormatter` и пикер форматтеров не поддержаны
 * (нужна идентичность расширения в регистрации).
 *
 * Ответы трёхзначные: `null` — форматтера для документа нет («нет
 * форматтера» в UI), пустой массив — менять нечего (или провайдер сбойнул /
 * не ответил вовремя — молчаливый no-op), иначе — правки.
 */

/** Есть ли для документа форматтер — документный или range (для on-save). */
export function hasDocumentFormatter(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
): boolean {
    return (
        languageFeatures.documentFormattingEditProvider.has(target) ||
        languageFeatures.documentRangeFormattingEditProvider.has(target)
    );
}

/**
 * Format Document: правки лучшего форматтера документа; `null` — форматтера нет.
 * `range` — диапазон всего документа ({@link documentRange}): без форматтера
 * документа его отдают range-форматтеру (текста в запросе нет).
 */
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

/** Format Selection: правки лучшего range-форматтера; `null` — форматтера нет. */
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

/** Диапазон всего документа (LF-канонический текст). */
export function documentRange(text: string): IRange {
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    return createRange(0, 0, lastLine, lines[lastLine].length);
}

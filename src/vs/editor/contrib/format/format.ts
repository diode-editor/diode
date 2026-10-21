import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import type { ILanguageFeatureTarget } from "../../common/languageFeatureRegistry.ts";
import type { IFormattingRequest } from "../../common/languages/iFormattingSource.ts";
import type { ILanguageFeaturesService } from "../../common/services/languageFeatures.ts";

// Upstream `editor/contrib/format/browser/format.ts`: range providers act as "synthetic"
// document formatters over the full range. `editor.defaultFormatter` and the picker are not
// supported (they need the extension identity in the registration).
//
// Results are three-valued: `null` means no formatter, an empty array means nothing to change
// (or the provider failed — a silent no-op), otherwise edits.

export function hasDocumentFormatter(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
): boolean {
    return (
        languageFeatures.documentFormattingEditProvider.has(target) ||
        languageFeatures.documentRangeFormattingEditProvider.has(target)
    );
}

/** `range` is the whole document ({@link documentRange}): a range formatter's request carries no text. */
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

/** `text` is LF-normalized. */
export function documentRange(text: string): IRange {
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    return createRange(0, 0, lastLine, lines[lastLine].length);
}

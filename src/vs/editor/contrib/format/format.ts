import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { createRange, type IRange } from "../../common/core/iRange.ts";
import type { ITextEdit } from "../../common/core/iTextEdit.ts";
import type { ILanguageFeatureTarget } from "../../common/languageFeatureRegistry.ts";
import type { IFormattingRequest } from "../../common/languages/iFormattingSource.ts";
import type { ILanguageFeaturesService } from "../../common/services/languageFeatures.ts";

// Upstream `editor/contrib/format/browser/format.ts`: range providers act as "synthetic"
// document formatters over the full range. `editor.defaultFormatter` picks by extension, as upstream's
// `DefaultFormatter`: a configured formatter that cannot serve the request means no formatter, never another one.
// Deviation: with nothing configured the first provider formats, upstream asks; there is no picker.
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

/** Extension ids compare case-insensitively, as upstream's `ExtensionIdentifier.equals`. */
function selectFormatter<T extends { readonly extensionId?: string }>(
    ordered: readonly T[],
    defaultFormatterId: string | null | undefined,
): T | undefined {
    if (!defaultFormatterId) return ordered.at(0);
    const wanted = defaultFormatterId.toLowerCase();
    return ordered.find((provider) => provider.extensionId?.toLowerCase() === wanted);
}

/** `range` is the whole document ({@link documentRange}): a range formatter's request carries no text. */
export async function formatDocument(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
    request: IFormattingRequest,
    range: IRange,
    token: ICancellationToken,
    defaultFormatterId?: string | null,
): Promise<readonly ITextEdit[] | null> {
    const real = selectFormatter(languageFeatures.documentFormattingEditProvider.ordered(target), defaultFormatterId);
    if (real !== undefined) return real.provideDocumentFormattingEdits(request, token).catch(() => []);
    const synthetic = selectFormatter(
        languageFeatures.documentRangeFormattingEditProvider.ordered(target),
        defaultFormatterId,
    );
    if (synthetic === undefined) return null;
    return synthetic.provideDocumentRangeFormattingEdits({ ...request, range }, token).catch(() => []);
}

export async function formatRange(
    languageFeatures: ILanguageFeaturesService,
    target: ILanguageFeatureTarget,
    request: IFormattingRequest & { readonly range: IRange },
    token: ICancellationToken,
    defaultFormatterId?: string | null,
): Promise<readonly ITextEdit[] | null> {
    const provider = selectFormatter(
        languageFeatures.documentRangeFormattingEditProvider.ordered(target),
        defaultFormatterId,
    );
    if (provider === undefined) return null;
    return provider.provideDocumentRangeFormattingEdits(request, token).catch(() => []);
}

/** `text` is LF-normalized. */
export function documentRange(text: string): IRange {
    const lines = text.split("\n");
    const lastLine = lines.length - 1;
    return createRange(0, 0, lastLine, lines[lastLine].length);
}

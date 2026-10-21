import type * as vscode from "vscode";

import { SemanticTokens, SemanticTokensEdit, SemanticTokensEdits } from "./vscodeTypes.ts";
import type { WireSemanticTokensResult } from "./wireTypes.ts";

/**
 * Port of upstream `DocumentSemanticTokensAdapter`/`DocumentRangeSemanticTokensAdapter`;
 * the response is a JSON shape instead of the binary `SemanticTokensDto`.
 */

class SemanticTokensPreviousResult {
    public constructor(
        public readonly resultId: string | undefined,
        public readonly tokens?: Uint32Array,
    ) {}
}

interface IRelaxedSemanticTokens {
    readonly resultId?: string;
    readonly data: Uint32Array | readonly number[];
}
interface IRelaxedSemanticTokensEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly data?: Uint32Array | readonly number[];
}
interface IRelaxedSemanticTokensEdits {
    readonly resultId?: string;
    readonly edits: readonly IRelaxedSemanticTokensEdit[];
}

function isSemanticTokens(v: unknown): v is IRelaxedSemanticTokens {
    return typeof v === "object" && v !== null && Boolean((v as Partial<IRelaxedSemanticTokens>).data);
}

function isSemanticTokensEdits(v: unknown): v is IRelaxedSemanticTokensEdits {
    return typeof v === "object" && v !== null && Array.isArray((v as Partial<IRelaxedSemanticTokensEdits>).edits);
}

function fixProvidedSemanticTokens(v: unknown): SemanticTokens | SemanticTokensEdits | null {
    if (isSemanticTokens(v)) {
        return new SemanticTokens(v.data instanceof Uint32Array ? v.data : new Uint32Array(v.data), v.resultId);
    }
    if (isSemanticTokensEdits(v)) {
        return new SemanticTokensEdits(
            v.edits.map(
                (edit) =>
                    new SemanticTokensEdit(
                        edit.start,
                        edit.deleteCount,
                        edit.data === undefined ? undefined : new Uint32Array(edit.data),
                    ),
            ),
            v.resultId,
        );
    }
    return null;
}

/** The core gets a delta even if the provider cannot produce deltas. */
function convertToEdits(
    previousResult: SemanticTokensPreviousResult | undefined,
    newResult: SemanticTokens | SemanticTokensEdits,
): SemanticTokens | SemanticTokensEdits {
    if (!(newResult instanceof SemanticTokens) || previousResult?.tokens === undefined) {
        return newResult;
    }
    const oldData = previousResult.tokens;
    const oldLength = oldData.length;
    const newData = newResult.data;
    const newLength = newData.length;

    let commonPrefixLength = 0;
    const maxCommonPrefixLength = Math.min(oldLength, newLength);
    while (commonPrefixLength < maxCommonPrefixLength && oldData[commonPrefixLength] === newData[commonPrefixLength]) {
        commonPrefixLength++;
    }

    if (commonPrefixLength === oldLength && commonPrefixLength === newLength) {
        // complete overlap!
        return new SemanticTokensEdits([], newResult.resultId);
    }

    let commonSuffixLength = 0;
    const maxCommonSuffixLength = maxCommonPrefixLength - commonPrefixLength;
    while (
        commonSuffixLength < maxCommonSuffixLength &&
        oldData[oldLength - commonSuffixLength - 1] === newData[newLength - commonSuffixLength - 1]
    ) {
        commonSuffixLength++;
    }

    return new SemanticTokensEdits(
        [
            new SemanticTokensEdit(
                commonPrefixLength,
                oldLength - commonPrefixLength - commonSuffixLength,
                newData.subarray(commonPrefixLength, newLength - commonSuffixLength),
            ),
        ],
        newResult.resultId,
    );
}

/**
 * Every response gets a one-shot id: with it the next request finds the extension's
 * `resultId` and the previous data; the entry is forgotten on the next request
 * with that id and on `release`.
 */
export class DocumentSemanticTokensAdapter {
    private readonly previousResults = new Map<number, SemanticTokensPreviousResult>();
    private nextResultId = 1;

    public constructor(private readonly provider: vscode.DocumentSemanticTokensProvider) {}

    public async provideDocumentSemanticTokens(
        doc: vscode.TextDocument,
        previousResultId: number,
        token: vscode.CancellationToken,
    ): Promise<WireSemanticTokensResult | null> {
        // Response ids start at 1: "no previous" (0) is never found in the table.
        const previousResult = this.previousResults.get(previousResultId);
        const raw: unknown =
            typeof previousResult?.resultId === "string" &&
            typeof this.provider.provideDocumentSemanticTokensEdits === "function"
                ? await this.provider.provideDocumentSemanticTokensEdits(doc, previousResult.resultId, token)
                : await this.provider.provideDocumentSemanticTokens(doc, token);

        this.previousResults.delete(previousResultId);
        const value = fixProvidedSemanticTokens(raw);
        if (value === null) {
            return null;
        }
        return this.send(convertToEdits(previousResult, value), value);
    }

    public releaseDocumentSemanticColoring(resultId: number): void {
        this.previousResults.delete(resultId);
    }

    private send(
        value: SemanticTokens | SemanticTokensEdits,
        original: SemanticTokens | SemanticTokensEdits,
    ): WireSemanticTokensResult {
        const id = this.nextResultId++;
        if (value instanceof SemanticTokens) {
            this.previousResults.set(id, new SemanticTokensPreviousResult(value.resultId, value.data));
            return { id, type: "full", data: Array.from(value.data) };
        }
        // The original full response is stored (the next delta is computed from it),
        // or, if the provider sent edits itself, only its resultId.
        this.previousResults.set(
            id,
            original instanceof SemanticTokens
                ? new SemanticTokensPreviousResult(original.resultId, original.data)
                : new SemanticTokensPreviousResult(value.resultId),
        );
        return {
            id,
            type: "delta",
            deltas: value.edits.map((edit) => ({
                start: edit.start,
                deleteCount: edit.deleteCount,
                ...(edit.data === undefined ? {} : { data: Array.from(edit.data) }),
            })),
        };
    }
}

/** The response is always full, id 0: there are no deltas against it. */
export class DocumentRangeSemanticTokensAdapter {
    public constructor(private readonly provider: vscode.DocumentRangeSemanticTokensProvider) {}

    public async provideDocumentRangeSemanticTokens(
        doc: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken,
    ): Promise<WireSemanticTokensResult | null> {
        const value: unknown = await this.provider.provideDocumentRangeSemanticTokens(doc, range, token);
        if (!isSemanticTokens(value)) {
            return null;
        }
        return { id: 0, type: "full", data: Array.from(value.data) };
    }
}

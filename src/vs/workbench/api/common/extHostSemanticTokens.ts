import type * as vscode from "vscode";

import { SemanticTokens, SemanticTokensEdit, SemanticTokensEdits } from "./vscodeTypes.ts";
import type { WireSemanticTokensResult } from "./wireTypes.ts";

/**
 * Адаптеры провайдеров семантических токенов на стороне субпроцесса — перенос
 * `DocumentSemanticTokensAdapter`/`DocumentRangeSemanticTokensAdapter` из
 * `extHostLanguageFeatures.ts` эталона. Ответ уходит JSON-формой
 * {@link WireSemanticTokensResult} вместо бинарного `SemanticTokensDto`.
 */

class SemanticTokensPreviousResult {
    public constructor(
        public readonly resultId: string | undefined,
        public readonly tokens?: Uint32Array,
    ) {}
}

/** Провайдеры вправе вернуть `data` обычным массивом — эталон это терпит. */
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

/** `_fixProvidedSemanticTokens`: массивы → `Uint32Array`; чужая форма — `null`. */
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
                        edit.data === undefined || edit.data instanceof Uint32Array
                            ? edit.data
                            : new Uint32Array(edit.data),
                    ),
            ),
            v.resultId,
        );
    }
    return null;
}

/**
 * `_convertToEdits`: полный ответ при сохранённом прошлом превращается в одну
 * правку «общий префикс / общий суффикс» — ядро получает дельту, даже если
 * провайдер дельт не умеет.
 */
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
 * Провайдер токенов всего документа. Каждый ответ получает одноразовый
 * числовой id; по нему следующий запрос ядра находит `resultId` расширения
 * (для `provideDocumentSemanticTokensEdits`) и прошлые данные (для дельты).
 * Запись забывается при следующем запросе с этим id и по `release`.
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
        const previousResult = previousResultId !== 0 ? this.previousResults.get(previousResultId) : undefined;
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
        // Дельта: хранится исходный полный ответ (от него посчитают следующую),
        // а если провайдер сам прислал правки — только его resultId.
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

/** Провайдер токенов диапазона: ответ всегда полный, id 0 — дельт к нему нет. */
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

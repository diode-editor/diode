import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { Event } from "../../../base/common/event.ts";
import type { IRange } from "../core/iRange.ts";

/**
 * Форма upstream `languages.SemanticTokens*`. `data` — пятёрки
 * `deltaLine, deltaStartChar, length, tokenType, tokenModifiers`; тип — индекс
 * в `legend.tokenTypes`, модификаторы — биты по `legend.tokenModifiers`.
 */
export interface ISemanticTokensLegend {
    readonly tokenTypes: readonly string[];
    readonly tokenModifiers: readonly string[];
}

export interface ISemanticTokens {
    readonly resultId: string | undefined;
    readonly data: Uint32Array;
}

/** Правка прошлого ответа: индексы — в массиве `data`, не в токенах. */
export interface ISemanticTokensEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly data: Uint32Array | undefined;
}

export interface ISemanticTokensEdits {
    readonly resultId: string | undefined;
    readonly edits: readonly ISemanticTokensEdit[];
}

/** Текст провайдер берёт из своей синхронизированной копии этой версии. */
export interface ISemanticTokensRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
}

export interface IRangeSemanticTokensRequest extends ISemanticTokensRequest {
    /** 0-based. */
    readonly range: IRange;
}

/** `lastResultId` — прошлого ответа ЭТОГО провайдера: по нему он вправе ответить дельтой. */
export interface DocumentSemanticTokensProvider {
    readonly onDidChange?: Event<void>;
    getLegend(): ISemanticTokensLegend;
    provideDocumentSemanticTokens(
        request: ISemanticTokensRequest,
        lastResultId: string | null,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | ISemanticTokensEdits | null>;
    /** Ответ `resultId` ядру больше не нужен: провайдер забывает его данные. */
    releaseDocumentSemanticTokens(resultId: string | undefined): void;
}

/** Видимая область, пока нет полного набора документа. */
export interface DocumentRangeSemanticTokensProvider {
    readonly onDidChange?: Event<void>;
    getLegend(): ISemanticTokensLegend;
    provideDocumentRangeSemanticTokens(
        request: IRangeSemanticTokensRequest,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | null>;
}

export function isSemanticTokensEdits(v: ISemanticTokens | ISemanticTokensEdits): v is ISemanticTokensEdits {
    return "edits" in v;
}

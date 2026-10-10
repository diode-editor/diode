import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    DocumentRangeSemanticTokensProvider,
    DocumentSemanticTokensProvider,
    IRangeSemanticTokensRequest,
    ISemanticTokens,
    ISemanticTokensEdits,
    ISemanticTokensRequest,
} from "../../../common/languages/iSemanticTokensSource.ts";

/**
 * Выбор провайдеров и опрос — перенос `getSemanticTokens.ts` эталона: из
 * провайдеров документа берётся только старшая группа по score; её провайдеры
 * спрашиваются параллельно, `lastResultId` получает лишь давший прошлый ответ.
 */

export interface IDocumentSemanticTokensResult {
    readonly provider: DocumentSemanticTokensProvider;
    readonly tokens: ISemanticTokens | ISemanticTokensEdits | null;
}

export interface IRangeSemanticTokensResult {
    readonly provider: DocumentRangeSemanticTokensProvider;
    readonly tokens: ISemanticTokens | null;
}

function highestGroup<T>(registry: LanguageFeatureRegistry<T>, target: ILanguageFeatureTarget): T[] {
    return registry.orderedGroups(target).at(0) ?? [];
}

/**
 * Первый ответ с токенами; ошибка провайдера (раньше всех ответов с токенами)
 * — исключением: вызывающий оставит прежние токены. Ни у кого токенов нет —
 * ответ первого провайдера (пустой). Провайдеров нет — `null`.
 */
export async function getDocumentSemanticTokens(
    registry: LanguageFeatureRegistry<DocumentSemanticTokensProvider>,
    target: ILanguageFeatureTarget,
    request: ISemanticTokensRequest,
    lastProvider: DocumentSemanticTokensProvider | null,
    lastResultId: string | null,
    token: ICancellationToken,
): Promise<IDocumentSemanticTokensResult | null> {
    const providers = highestGroup(registry, target);
    const results = await Promise.all(
        providers.map(async (provider) => {
            try {
                const tokens = await provider.provideDocumentSemanticTokens(
                    request,
                    provider === lastProvider ? lastResultId : null,
                    token,
                );
                return { provider, tokens, error: undefined };
            } catch (error) {
                return {
                    provider,
                    tokens: null,
                    error: error instanceof Error ? error : new Error(String(error)),
                };
            }
        }),
    );
    for (const result of results) {
        if (result.error !== undefined) throw result.error;
        if (result.tokens !== null) return { provider: result.provider, tokens: result.tokens };
    }
    const first = results.at(0);
    return first === undefined ? null : { provider: first.provider, tokens: null };
}

/** Как {@link getDocumentSemanticTokens}, но ошибка провайдера — просто «нет токенов». */
export async function getDocumentRangeSemanticTokens(
    registry: LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>,
    target: ILanguageFeatureTarget,
    request: IRangeSemanticTokensRequest,
    token: ICancellationToken,
): Promise<IRangeSemanticTokensResult | null> {
    const providers = highestGroup(registry, target);
    const results = await Promise.all(
        providers.map(async (provider) => {
            let tokens: ISemanticTokens | null;
            try {
                tokens = await provider.provideDocumentRangeSemanticTokens(request, token);
            } catch {
                tokens = null;
            }
            return { provider, tokens };
        }),
    );
    return results.find((result) => result.tokens !== null) ?? results.at(0) ?? null;
}

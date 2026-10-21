import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
    InlineCompletionsProvider,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";

/**
 * upstream `provideInlineCompletions`: один объект запроса и один токен на всех — хост склеит вызовы
 * в один RPC. Сбойный провайдер = подсказок нет.
 */
export async function provideInlineCompletions(
    providers: readonly InlineCompletionsProvider[],
    request: IInlineCompletionRequest,
    token: ICancellationToken,
): Promise<ICoreInlineCompletionItem[]> {
    const results = await Promise.all(
        providers.map((provider) => provider.provideInlineCompletions(request, token).catch(() => [])),
    );
    return results.flat();
}

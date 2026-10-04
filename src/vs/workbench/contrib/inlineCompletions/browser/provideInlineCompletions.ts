import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
    InlineCompletionsProvider,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";

/**
 * Инлайн-подсказки от всех подошедших документу провайдеров (upstream
 * `editor/contrib/inlineCompletions/browser/model/provideInlineCompletions.ts`):
 * спрашиваем параллельно одним объектом запроса и одним токеном (по ним хост
 * склеит вызовы в один RPC), склеиваем в порядке `ordered`. Сбойный провайдер
 * = подсказок нет.
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

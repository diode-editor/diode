import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
    InlineCompletionsProvider,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";

/**
 * upstream `provideInlineCompletions`: one request object and one token for all — the host merges the
 * calls into a single RPC. A failing provider means no completions.
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

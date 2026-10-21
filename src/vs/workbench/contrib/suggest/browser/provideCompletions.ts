import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
} from "../../../../editor/common/languages/iCompletionSource.ts";

export interface ICompletionsFromProviders {
    readonly items: readonly ICoreCompletionItem[];
    readonly isIncomplete: boolean;
    readonly providerOf: ReadonlyMap<ICoreCompletionItem, CompletionItemProvider>;
}

/**
 * upstream `provideSuggestionItems` без групп по score. Один объект запроса на всех — по нему хост
 * склеит вызовы в один RPC; сбойный провайдер — пустой список.
 */
export async function provideCompletions(
    providers: readonly CompletionItemProvider[],
    request: ICompletionRequest,
    token: ICancellationToken,
): Promise<ICompletionsFromProviders> {
    const results = await Promise.all(
        providers.map((provider) => provider.provideCompletionItems(request, token).catch(() => null)),
    );
    const items: ICoreCompletionItem[] = [];
    const providerOf = new Map<ICoreCompletionItem, CompletionItemProvider>();
    let isIncomplete = false;
    results.forEach((result, index) => {
        if (result === null) return;
        if (result.isIncomplete) isIncomplete = true;
        for (const item of result.items) {
            items.push(item);
            providerOf.set(item, providers[index]);
        }
    });
    return { items, isIncomplete, providerOf };
}

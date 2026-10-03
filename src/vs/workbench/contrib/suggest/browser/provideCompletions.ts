import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
} from "../../../../editor/common/languages/iCompletionSource.ts";

/** Склеенный ответ провайдеров: пункты, признак неполноты и владелец каждого пункта. */
export interface ICompletionsFromProviders {
    readonly items: readonly ICoreCompletionItem[];
    /** Хоть один провайдер отдал неполный список — добор символа перезапрашивает. */
    readonly isIncomplete: boolean;
    /** Чей пункт: resolve спрашивается у того провайдера, что его отдал. */
    readonly providerOf: ReadonlyMap<ICoreCompletionItem, CompletionItemProvider>;
}

/**
 * Пункты автодополнения от всех подошедших документу провайдеров (upstream
 * `editor/contrib/suggest/browser/suggest.ts:provideSuggestionItems`, без
 * групп по score — склеиваются все подошедшие, как и раньше): спрашиваем
 * параллельно одним и тем же объектом запроса (по нему хост склеит вызовы в
 * один RPC), склеиваем в порядке `ordered`. Сбойный провайдер = пустой список.
 */
export async function provideCompletions(
    providers: readonly CompletionItemProvider[],
    request: ICompletionRequest,
): Promise<ICompletionsFromProviders> {
    const results = await Promise.all(
        providers.map((provider) => provider.provideCompletionItems(request).catch(() => null)),
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

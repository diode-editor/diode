import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { FoldingRangeProvider, IFoldingRequest } from "../../common/languages/iFoldingSource.ts";

import type { IFoldingRegion } from "./iFoldingRegion.ts";

/**
 * Области сворачивания от всех подошедших документу провайдеров (upstream
 * `editor/contrib/folding/browser/syntaxRangeProvider.ts`): спрашиваем
 * параллельно одним объектом запроса (по нему хост склеит вызовы в один RPC),
 * склеиваем в порядке `ordered`. Сбойный провайдер = областей нет; слияние с
 * indentation-фолдами — у потребителя (`EditorComponent`).
 */
export async function provideFoldingRanges(
    providers: readonly FoldingRangeProvider[],
    request: IFoldingRequest,
    token: ICancellationToken,
): Promise<IFoldingRegion[]> {
    const results = await Promise.all(
        providers.map((provider) => provider.provideFoldingRanges(request, token).catch(() => [])),
    );
    return results.flat();
}

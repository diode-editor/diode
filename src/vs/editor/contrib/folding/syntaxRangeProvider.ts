import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { FoldingRangeProvider, IFoldingRequest } from "../../common/languages/iFoldingSource.ts";

import type { IFoldingRegion } from "./iFoldingRegion.ts";

/**
 * Upstream `editor/contrib/folding/browser/syntaxRangeProvider.ts`. All providers share one
 * request object: the host uses it to batch the calls into a single RPC.
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

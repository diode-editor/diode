import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type { HoverProvider, ICoreHover, IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";

/** A failing provider doesn't take down the others: its answer is "no hover". */
export async function getHovers(
    registry: LanguageFeatureRegistry<HoverProvider>,
    target: ILanguageFeatureTarget,
    request: IHoverRequest,
    token: ICancellationToken,
): Promise<ICoreHover[]> {
    const results = await Promise.all(
        registry.ordered(target).map((provider) => provider.provideHover(request, token).catch(() => undefined)),
    );
    return results.filter((hover) => hover !== undefined);
}

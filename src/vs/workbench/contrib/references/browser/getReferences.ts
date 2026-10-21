import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    ICoreReference,
    IReferenceRequest,
    ReferenceProvider,
} from "../../../../editor/common/languages/iReferenceSource.ts";

/**
 * Like upstream `goToSymbol.ts:getReferencesAtPosition`: providers are queried in parallel, results are merged
 * in `ordered` order, and a failing provider answers "no references".
 */
export async function getReferences(
    registry: LanguageFeatureRegistry<ReferenceProvider>,
    target: ILanguageFeatureTarget,
    request: IReferenceRequest,
    token: ICancellationToken,
): Promise<ICoreReference[]> {
    const results = await Promise.all(
        registry.ordered(target).map((provider) => provider.provideReferences(request, token).catch(() => [])),
    );
    return results.flat();
}

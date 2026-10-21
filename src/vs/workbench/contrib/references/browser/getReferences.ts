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
 * Как upstream `goToSymbol.ts:getReferencesAtPosition`: провайдеры спрашиваются параллельно, склейка —
 * в порядке `ordered`, сбойный провайдер отвечает «ссылок нет».
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

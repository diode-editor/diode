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
 * Ссылки от всех подошедших документу провайдеров (upstream
 * `editor/contrib/gotoSymbol/browser/goToSymbol.ts:getReferencesAtPosition`):
 * спрашиваем параллельно, склеиваем в порядке `ordered`. Сбойный провайдер не
 * роняет остальных: его ответ — «ссылок нет».
 */
export async function getReferences(
    registry: LanguageFeatureRegistry<ReferenceProvider>,
    target: ILanguageFeatureTarget,
    request: IReferenceRequest,
): Promise<ICoreReference[]> {
    const results = await Promise.all(
        registry.ordered(target).map((provider) => provider.provideReferences(request).catch(() => [])),
    );
    return results.flat();
}

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    DefinitionProvider,
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../../editor/common/languages/iDefinitionSource.ts";

/** Сбойный провайдер не роняет остальных: его ответ — «целей нет». */
export async function getDefinitions(
    registry: LanguageFeatureRegistry<DefinitionProvider>,
    target: ILanguageFeatureTarget,
    request: IDefinitionRequest,
    token: ICancellationToken,
): Promise<ICoreDefinitionLocation[]> {
    const results = await Promise.all(
        registry.ordered(target).map((provider) => provider.provideDefinition(request, token).catch(() => [])),
    );
    return results.flat();
}

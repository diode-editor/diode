import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type {
    DefinitionProvider,
    ICoreDefinitionLocation,
    IDefinitionRequest,
    ImplementationProvider,
} from "../../../../editor/common/languages/iDefinitionSource.ts";

/** The part of upstream `ReferencesModel` that decides where a go-to command lands. */
export interface ILocationModel {
    /** Sorted by uri, then by range; exact duplicates are dropped. */
    readonly references: readonly ICoreDefinitionLocation[];
    /** Upstream `firstReference()`: the first target in provider order, not after sorting. */
    readonly first: ICoreDefinitionLocation | undefined;
}

export function createLocationModel(locations: readonly ICoreDefinitionLocation[]): ILocationModel {
    const sorted = [...locations].sort(compareLocations);
    const references = sorted.filter(
        (location, index) => index === 0 || compareLocations(sorted[index - 1], location) !== 0,
    );
    return { references, first: locations.at(0) };
}

function compareLocations(a: ICoreDefinitionLocation, b: ICoreDefinitionLocation): number {
    // Stryker disable next-line EqualityOperator: equal uris don't get here, so `<=` is the same
    if (a.uri !== b.uri) return a.uri < b.uri ? -1 : 1;
    return comparePositions(a.range.start, b.range.start) || comparePositions(a.range.end, b.range.end);
}

/** Upstream `_findLocations`. A failing provider doesn't take down the others: its answer is "no targets". */
async function findLocations<TProvider>(
    registry: LanguageFeatureRegistry<TProvider>,
    target: ILanguageFeatureTarget,
    provide: (provider: TProvider) => Promise<readonly ICoreDefinitionLocation[]>,
): Promise<ILocationModel> {
    const results = await Promise.all(registry.ordered(target).map((provider) => provide(provider).catch(() => [])));
    return createLocationModel(results.flat());
}

export function getDefinitions(
    registry: LanguageFeatureRegistry<DefinitionProvider>,
    target: ILanguageFeatureTarget,
    request: IDefinitionRequest,
    token: ICancellationToken,
): Promise<ILocationModel> {
    return findLocations(registry, target, (provider) => provider.provideDefinition(request, token));
}

export function getImplementations(
    registry: LanguageFeatureRegistry<ImplementationProvider>,
    target: ILanguageFeatureTarget,
    request: IDefinitionRequest,
    token: ICancellationToken,
): Promise<ILocationModel> {
    return findLocations(registry, target, (provider) => provider.provideImplementation(request, token));
}

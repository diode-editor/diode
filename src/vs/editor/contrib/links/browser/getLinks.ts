import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { comparePositions } from "../../../common/core/iPosition.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { ILink, ILinkRequest, LinkProvider } from "../../../common/languages/iLinkSource.ts";

/** Upstream `Range.areIntersectingOrTouching`. */
function intersectOrTouch(a: IRange, b: IRange): boolean {
    return comparePositions(a.end, b.start) >= 0 && comparePositions(b.end, a.start) >= 0;
}

/** Upstream `LinksList._union`: both lists are by position; an old link meeting a new one is dropped. */
export function unionLinks(oldLinks: readonly ILink[], newLinks: readonly ILink[]): ILink[] {
    const result: ILink[] = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLinks.length && newIndex < newLinks.length) {
        const oldLink = oldLinks[oldIndex];
        const newLink = newLinks[newIndex];
        if (intersectOrTouch(oldLink.range, newLink.range)) {
            oldIndex++;
        } else if (comparePositions(oldLink.range.start, newLink.range.start) < 0) {
            result.push(oldLink);
            oldIndex++;
        } else {
            result.push(newLink);
            newIndex++;
        }
    }
    return result.concat(oldLinks.slice(oldIndex), newLinks.slice(newIndex));
}

/**
 * Upstream `getLinks`: every provider in parallel; merged from the lowest score up, so a provider's links beat the
 * built-in detector's. A failed provider is reported, the others answer.
 */
export async function getLinks(
    registry: LanguageFeatureRegistry<LinkProvider>,
    target: ILanguageFeatureTarget,
    request: ILinkRequest,
    token: ICancellationToken,
): Promise<ILink[]> {
    const lists = await Promise.all(
        registry
            .ordered(target)
            .reverse()
            .map(async (provider) => {
                try {
                    return (await provider.provideLinks(request, token)) ?? [];
                } catch (error) {
                    onUnexpectedError(error);
                    return [];
                }
            }),
    );
    return lists.reduce<ILink[]>(unionLinks, []);
}

/** Upstream `Link.resolve`; `null` — the target is missing. */
export async function resolveLinkTarget(link: ILink, token: ICancellationToken): Promise<string | null> {
    if (link.url !== undefined && link.url !== "") return link.url;
    return (await link.resolve?.(token)) ?? null;
}

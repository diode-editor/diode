import { splitGlobAware } from "../../../../base/common/glob.ts";
import type { IWireTestItem } from "../../../api/common/testingWireTypes.ts";
import { TEST_ID_DELIMITER } from "../../../api/common/testingWireTypes.ts";

/** Upstream `TestFilterTerm`: recognized and taken out of the text; the states they filter by come with runs. */
const FILTER_TERMS: readonly string[] = ["@failed", "@executed", "@doc", "@openedFiles", "@hidden"];

const TAG_RE = /!?@([^ ,:]+)/g;

interface IGlob {
    readonly include: boolean;
    /** Lower case. */
    readonly text: string;
}

/** Upstream `TestExplorerFilterState` after `setText`. */
export interface ITestExplorerFilter {
    readonly globList: readonly IGlob[];
    /** Namespaced as {@link IWireTestItem.tags}: `<controller id>\0<tag id>`. */
    readonly includeTags: ReadonlySet<string>;
    readonly excludeTags: ReadonlySet<string>;
}

/**
 * Upstream `TestExplorerFilterState.setText`: comma-separated globs, `!` excludes; `@ctrlId:tagId` (quoted
 * `@ctrlId:"tag id"`) includes a tag, `!@ctrlId:tagId` excludes it; any other `@word` is plain text.
 */
export function parseTestExplorerFilter(text: string): ITestExplorerFilter {
    const globList: IGlob[] = [];
    const includeTags = new Set<string>();
    const excludeTags = new Set<string>();
    let globText = "";
    let lastIndex = 0;
    for (const match of text.matchAll(TAG_RE)) {
        let nextIndex = match.index + match[0].length;
        const isFilterTerm = FILTER_TERMS.includes(match[0]);
        let isTag = false;
        if (text[nextIndex] === ":") {
            isTag = true;
            nextIndex++;
            let delimiter = text[nextIndex];
            if (delimiter !== `"` && delimiter !== `'`) delimiter = " ";
            else nextIndex++;
            let tagId = "";
            while (nextIndex < text.length && text[nextIndex] !== delimiter) {
                if (text[nextIndex] === "\\") {
                    tagId += text[nextIndex + 1];
                    nextIndex += 2;
                } else {
                    tagId += text[nextIndex];
                    nextIndex++;
                }
            }
            (match[0].startsWith("!") ? excludeTags : includeTags).add(match[1] + TEST_ID_DELIMITER + tagId);
            nextIndex++;
        }
        // A test named "@smoke" is searched by its name.
        if (!isFilterTerm && !isTag) continue;
        globText += text.slice(lastIndex, match.index);
        lastIndex = nextIndex;
    }
    globText += text.slice(lastIndex).trim();
    for (const filter of splitGlobAware(globText, ",").map((part) => part.trim())) {
        if (filter === "") continue;
        if (filter.startsWith("!")) globList.push({ include: false, text: filter.slice(1).toLowerCase() });
        else globList.push({ include: true, text: filter.toLowerCase() });
    }
    return { globList, includeTags, excludeTags };
}

/** Upstream `FilterResult`, ordered as upstream's `Math.min` reads it. */
export const FilterResult = {
    Exclude: 0,
    /** Visible if a descendant is: upstream `TreeVisibility.Recurse`. */
    Inherit: 1,
    Include: 2,
} as const;
export type FilterResult = (typeof FilterResult)[keyof typeof FilterResult];

/** The test and its ancestors up to the controller, nearest first. */
export type TestLineage = readonly IWireTestItem[];

/** Upstream `TestsFilter.filter` without the state and location terms: text AND tags. */
export function filterTest(filter: ITestExplorerFilter, lineage: TestLineage): FilterResult {
    return Math.min(filterText(filter, lineage), filterTags(filter, lineage[0])) as FilterResult;
}

/** Upstream `testFilterText`: the nearest of the test and its ancestors whose label decides wins. */
function filterText(filter: ITestExplorerFilter, lineage: TestLineage): FilterResult {
    if (filter.globList.length === 0) return FilterResult.Include;
    for (const item of lineage) {
        // A first negation starts as included: `!slow` shows everything else.
        let included: FilterResult = filter.globList[0].include ? FilterResult.Inherit : FilterResult.Include;
        const label = item.label.toLowerCase();
        for (const { include, text } of filter.globList) {
            if (label.includes(text)) included = include ? FilterResult.Include : FilterResult.Exclude;
        }
        if (included !== FilterResult.Inherit) return included;
    }
    return FilterResult.Inherit;
}

/** Upstream `testTags`: some included tag, none of the excluded ones. */
function filterTags(filter: ITestExplorerFilter, item: IWireTestItem): FilterResult {
    if (filter.includeTags.size === 0 && filter.excludeTags.size === 0) return FilterResult.Include;
    const included = filter.includeTags.size === 0 || item.tags.some((tag) => filter.includeTags.has(tag));
    return included && item.tags.every((tag) => !filter.excludeTags.has(tag))
        ? FilterResult.Include
        : FilterResult.Inherit;
}

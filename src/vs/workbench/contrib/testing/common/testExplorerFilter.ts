import { splitGlobAware } from "../../../../base/common/glob.ts";
import { type IWireTestItem, namespaceTestTag, TestResultState } from "../../../api/common/testingWireTypes.ts";

import { isFailedState } from "./testingStates.ts";

/** Upstream `TestFilterTerm`. */
export const TestFilterTerm = {
    Failed: "@failed",
    Executed: "@executed",
    CurrentDoc: "@doc",
    OpenedFiles: "@openedFiles",
    Hidden: "@hidden",
} as const;
export type TestFilterTerm = (typeof TestFilterTerm)[keyof typeof TestFilterTerm];

/**
 * Recognized and taken out of the text. Only `@failed` and `@executed` filter: `@doc`, `@openedFiles` (tests of the
 * editor) and `@hidden` (hidden tests) have nothing to filter by yet.
 */
const FILTER_TERMS: readonly string[] = Object.values(TestFilterTerm);

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
    /** The {@link TestFilterTerm}s in the text. */
    readonly terms: ReadonlySet<string>;
}

/**
 * Upstream `TestExplorerFilterState.setText`: comma-separated globs, `!` excludes; `@ctrlId:tagId` (quoted
 * `@ctrlId:"tag id"`) includes a tag, `!@ctrlId:tagId` excludes it; any other `@word` is plain text.
 */
export function parseTestExplorerFilter(text: string): ITestExplorerFilter {
    const globList: IGlob[] = [];
    const includeTags = new Set<string>();
    const excludeTags = new Set<string>();
    const terms = new Set<string>();
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
            (match[0].startsWith("!") ? excludeTags : includeTags).add(namespaceTestTag(match[1], tagId));
            nextIndex++;
        }
        // A test named "@smoke" is searched by its name.
        if (!isFilterTerm && !isTag) continue;
        if (isFilterTerm) terms.add(match[0]);
        globText += text.slice(lastIndex, match.index);
        lastIndex = nextIndex;
    }
    globText += text.slice(lastIndex).trim();
    for (const filter of splitGlobAware(globText, ",").map((part) => part.trim())) {
        if (filter === "") continue;
        const include = !filter.startsWith("!");
        globList.push({ include, text: (include ? filter : filter.slice(1)).toLowerCase() });
    }
    return { globList, includeTags, excludeTags, terms };
}

/** Upstream `toggleFilteringFor`: the term is appended to the text or taken out of it. */
export function toggleFilterTerm(text: string, term: TestFilterTerm, on: boolean): string {
    const trimmed = text.trim();
    const has = parseTestExplorerFilter(text).terms.has(term);
    if (on && !has) return trimmed === "" ? term : `${trimmed} ${term}`;
    if (!on && has) return trimmed.replace(term, "").replace(/\s\s+/g, " ").trim();
    return text;
}

/** Nothing to filter by: every test is shown. */
export function isEmptyFilter(filter: ITestExplorerFilter): boolean {
    return (
        filter.globList.length === 0 &&
        filter.includeTags.size === 0 &&
        filter.excludeTags.size === 0 &&
        !filter.terms.has(TestFilterTerm.Failed) &&
        !filter.terms.has(TestFilterTerm.Executed)
    );
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

/** Upstream `TestsFilter.filter` without the location terms: text AND state AND tags; `state` is the test's computed one. */
export function filterTest(filter: ITestExplorerFilter, lineage: TestLineage, state: TestResultState): FilterResult {
    return Math.min(
        filterText(filter, lineage),
        filterState(filter, state),
        filterTags(filter, lineage[0]),
    ) as FilterResult;
}

/** Upstream `testState`: `@failed` wins over `@executed`. */
function filterState(filter: ITestExplorerFilter, state: TestResultState): FilterResult {
    if (filter.terms.has(TestFilterTerm.Failed))
        return isFailedState(state) ? FilterResult.Include : FilterResult.Inherit;
    if (filter.terms.has(TestFilterTerm.Executed))
        return state === TestResultState.Unset ? FilterResult.Inherit : FilterResult.Include;
    return FilterResult.Include;
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
    const included = filter.includeTags.size === 0 || item.tags.some((tag) => filter.includeTags.has(tag));
    return included && item.tags.every((tag) => !filter.excludeTags.has(tag))
        ? FilterResult.Include
        : FilterResult.Inherit;
}

import {
    matchesExtensionQuery,
    normalizeExtensionQuery,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";

import type { IExtensionListEntry } from "./extensionsWorkbench.ts";

/**
 * The search box's filters (upstream `extensionQuery.ts` plus the parts of `extensionsViews.ts` that read them). The
 * whole catalog is in memory, so every filter is local; upstream sends `category:`/`tag:`/`@sort` to the gallery.
 */

/** Upstream `Query.parse`: the last one wins, the order suffix (`-asc`) is ignored. */
const SORT_FILTER = /@sort:(\w+)(-\w*)?/g;
/** Upstream `queryByIds`: with any `@id:` the rest of the query is ignored. */
const ID_FILTER = /@id:(([a-z0-9A-Z][a-z0-9\-A-Z]*)\.([a-z0-9A-Z][a-z0-9\-A-Z]*))/g;
/**
 * Upstream `parseCategories` and the gallery's `tag:`: quoted or not. The `@` goes too: upstream's pattern leaves
 * it behind for the gallery's text search, here it would match nothing.
 */
const CATEGORY_FILTER = /@?\bcategory:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g;
const TAG_FILTER = /@?\btag:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g;
const INSTALLED_FILTER = /@installed/giu;
/** Upstream `@updates` is `@outdated` in the installed view. */
const OUTDATED_FILTER = /@(outdated|updates)/giu;

/** Upstream `NONE_CATEGORY`: `category:none` matches extensions without categories. */
const NONE_CATEGORY = "none";

/**
 * Upstream sort keys. `name` and `publishedDate` sort here; the rest have no data in the registry (installs,
 * rating) or the profile (`updateDate`, the install date), so the list keeps its order (a deviation).
 */
export type ExtensionSortBy = "installs" | "rating" | "name" | "publishedDate" | "updateDate";

const SORT_KEYS: ReadonlySet<string> = new Set<ExtensionSortBy>([
    "installs",
    "rating",
    "name",
    "publishedDate",
    "updateDate",
]);

/** Which entries the view shows: everything (MARKETPLACE and INSTALLED), or one installed list. */
export type ExtensionQueryScope = "all" | "installed" | "outdated";

export interface IExtensionQuery {
    readonly scope: ExtensionQueryScope;
    /** `@id:`, lowercased; non-empty means only these ids, whatever the rest says. */
    readonly ids: readonly string[];
    /** Lowercased; an entry matches any of them. */
    readonly categories: readonly string[];
    /** `category:-x`, lowercased without the dash. */
    readonly excludedCategories: readonly string[];
    /** Lowercased; an entry matches any of them. */
    readonly tags: readonly string[];
    readonly sortBy: ExtensionSortBy | undefined;
    /** The rest of the query, normalized for {@link matchesExtensionQuery}. */
    readonly text: string;
}

/** The pattern's first group: `"x y"` with its quotes, or a bare word. */
function unquoted(raw: string): string {
    return (raw.startsWith('"') ? raw.slice(1, -1) : raw).toLowerCase();
}

export function parseExtensionQuery(query: string): IExtensionQuery {
    let sortBy: ExtensionSortBy | undefined;
    let value = query.replace(SORT_FILTER, (_match, by: string) => {
        sortBy = SORT_KEYS.has(by) ? (by as ExtensionSortBy) : undefined;
        return "";
    });
    // With an id the rest is not read (see `ids`), so the tokens stay in the text.
    const ids = [...value.matchAll(ID_FILTER)].map((match) => match[1].toLowerCase());

    const categories: string[] = [];
    const excludedCategories: string[] = [];
    value = value.replace(CATEGORY_FILTER, (_match, raw: string) => {
        const category = unquoted(raw);
        if (category.startsWith("-")) excludedCategories.push(category.slice(1));
        else categories.push(category);
        return "";
    });
    const tags: string[] = [];
    value = value.replace(TAG_FILTER, (_match, raw: string) => {
        tags.push(unquoted(raw));
        return "";
    });

    let scope: ExtensionQueryScope = "all";
    const withoutOutdated = value.replace(OUTDATED_FILTER, "");
    if (withoutOutdated !== value) scope = "outdated";
    value = withoutOutdated;
    const withoutInstalled = value.replace(INSTALLED_FILTER, "");
    // Upstream checks `@installed` first: `@installed @outdated` is the installed list.
    if (withoutInstalled !== value) scope = "installed";
    value = withoutInstalled;

    return { scope, ids, categories, excludedCategories, tags, sortBy, text: normalizeExtensionQuery(value) };
}

/** Upstream `filterExtensionByCategory`, with the exclusion the dash asks for. */
function matchesCategories(entry: IExtensionListEntry, query: IExtensionQuery): boolean {
    if (query.categories.length === 0 && query.excludedCategories.length === 0) return true;
    const own = entry.categories.map((category) => category.toLowerCase());
    if (own.length === 0) return query.categories.includes(NONE_CATEGORY);
    if (own.some((category) => query.excludedCategories.includes(category))) return false;
    return query.categories.length === 0 || own.some((category) => query.categories.includes(category));
}

function matchesTags(entry: IExtensionListEntry, tags: readonly string[]): boolean {
    return tags.length === 0 || entry.tags.some((tag) => tags.includes(tag.toLowerCase()));
}

function matchesScope(entry: IExtensionListEntry, scope: ExtensionQueryScope): boolean {
    if (scope === "installed") return entry.installedVersion !== null;
    if (scope === "outdated") return entry.availability === "outdated";
    return true;
}

/** Upstream `new Query(value, sortBy).toString()`: the query with its `@sort:` replaced. */
export function withSortBy(query: string, sortBy: ExtensionSortBy): string {
    const value = query.replace(SORT_FILTER, "").trim();
    return `${value}${value ? " " : ""}@sort:${sortBy}`;
}

/** Newest first; an entry without a date goes last (upstream sorts a missing date as the oldest). */
function byPublishedDate(a: IExtensionListEntry, b: IExtensionListEntry): number {
    return (b.latestPublishedAt ?? "").localeCompare(a.latestPublishedAt ?? "");
}

function byName(a: IExtensionListEntry, b: IExtensionListEntry): number {
    return a.displayName.localeCompare(b.displayName);
}

function sortEntries(entries: IExtensionListEntry[], sortBy: ExtensionSortBy | undefined): IExtensionListEntry[] {
    if (sortBy === "name") return entries.sort(byName);
    if (sortBy === "publishedDate") return entries.sort(byPublishedDate);
    return entries;
}

/** `searchRegistryIndex` semantics for the text (shared predicate in `registryFormat.ts`) plus the filters. */
export function filterExtensionEntries(
    entries: readonly IExtensionListEntry[],
    query: IExtensionQuery,
): IExtensionListEntry[] {
    if (query.ids.length > 0) return entries.filter((entry) => query.ids.includes(entry.id.toLowerCase()));
    const matching = entries.filter(
        (entry) =>
            matchesScope(entry, query.scope) &&
            matchesCategories(entry, query) &&
            matchesTags(entry, query.tags) &&
            matchesExtensionQuery(entry, query.text),
    );
    return sortEntries(matching, query.sortBy);
}

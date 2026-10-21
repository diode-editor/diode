/**
 * The upstream `typescript-language-features` returns "Organize Imports" for any
 * request whose `only` includes it and computes the edits lazily: with nothing to change
 * the action applies as a no-op. The stock `typescript-language-server` returns no action
 * on an empty tsserver response, and the editor reports "No organize imports
 * action" on every tidy file. We restore the upstream shape with a no-op action.
 */

export const ORGANIZE_IMPORTS_TS_KIND = "source.organizeImports.ts";

const ORGANIZE_IMPORTS_KIND = "source.organizeImports";

/** Like upstream `HierarchicalKind.contains`. */
function kindContains(parent: string, kind: string): boolean {
    return parent === "" || parent === kind || kind.startsWith(`${parent}.`);
}

/** Without `only` upstream returns no no-op action. */
export function needsNoopOrganizeImports(only: string | undefined, kinds: readonly (string | undefined)[]): boolean {
    // Stryker disable next-line ConditionalExpression: equivalent — without the guard `undefined` reaches kindContains, and `"source.organizeImports.ts".startsWith("undefined.")` is false too
    if (only === undefined || !kindContains(only, ORGANIZE_IMPORTS_TS_KIND)) return false;
    return !kinds.some((kind) => kind !== undefined && kindContains(ORGANIZE_IMPORTS_KIND, kind));
}

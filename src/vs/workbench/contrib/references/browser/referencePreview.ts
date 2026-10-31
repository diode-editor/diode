import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";

/** Shaped like a search file group, so rows are drawn by the same `buildFileRow`/`buildMatchRow`. */
export interface IReferenceGroup {
    /** The target's resource as the provider named it: it may be off disk (`jdt:`), where a path can't reopen it. */
    readonly uri: string;
    readonly absolutePath: string;
    /** `/` separators. */
    readonly relPath: string;
    readonly matches: ITextMatch[];
}

/**
 * Open model first: the server sees unsaved edits via didChange, otherwise the columns would
 * drift apart. Then disk.
 */
export interface IReferenceTextSource {
    /** `null` means the file is not open. */
    openText(uri: Uri): string | null;
    /** Throws if the resource is unavailable. */
    readText(uri: Uri): Promise<string>;
}

/**
 * Otherwise a reference in a minified or lock file drags hundreds of kilobytes into a list row
 * (docs/TODO/SearchPerformance.md, case 1). `before` is cut by `trimBefore` at render time.
 */
const MAX_AFTER_CHARS = 256;

/**
 * Group order is the first appearance of a file in the response (for tsserver: declaration, then usages).
 * Each file is read once per request; a reference whose line is past the end of the text is dropped.
 */
export async function buildReferenceGroups(
    references: readonly ICoreReference[],
    source: IReferenceTextSource,
    root: string,
): Promise<IReferenceGroup[]> {
    const groups = new Map<string, IReferenceGroup>();
    const lineCache = new Map<string, readonly string[] | null>();

    for (const reference of references) {
        const lines = await linesOf(reference.uri, source, lineCache);
        if (lines === null) continue;
        const match = toTextMatch(lines, reference.range);
        if (match === null) continue;

        let group = groups.get(reference.uri);
        if (group === undefined) {
            const absolutePath = Uri.parse(reference.uri).fsPath;
            group = { uri: reference.uri, absolutePath, relPath: labelFor(absolutePath, root), matches: [] };
            groups.set(reference.uri, group);
        }
        group.matches.push(match);
    }

    return [...groups.values()];
}

async function linesOf(
    uri: string,
    source: IReferenceTextSource,
    cache: Map<string, readonly string[] | null>,
): Promise<readonly string[] | null> {
    const cached = cache.get(uri);
    if (cached !== undefined) return cached;
    const lines = await readLines(uri, source);
    cache.set(uri, lines);
    return lines;
}

async function readLines(uri: string, source: IReferenceTextSource): Promise<readonly string[] | null> {
    const parsed = Uri.parse(uri);
    const open = source.openText(parsed);
    if (open !== null) return splitLines(open);
    try {
        return splitLines(await source.readText(parsed));
    } catch {
        return null;
    }
}

function splitLines(text: string): string[] {
    return text.split("\n").map((line) => line.replace(/\r$/u, ""));
}

/**
 * LSP columns are UTF-16 code units, exactly what a JS string is sliced by. A multi-line range is
 * highlighted to the end of its first line.
 */
function toTextMatch(lines: readonly string[], range: IRange): ITextMatch | null {
    // Not `.at()`: the line number comes from the provider, and a negative `.at()` would count from the end
    // of the file. Indexing yields undefined past the edge too — the type doesn't say so.
    const line = lines[range.start.line] as string | undefined;
    if (line === undefined) return null;

    const startColumn = Math.min(range.start.character, line.length);
    const endColumn = range.end.line === range.start.line ? Math.min(range.end.character, line.length) : line.length;

    return {
        // 1-based line number, like ripgrep: list rows are shared with search.
        lineNumber: range.start.line + 1,
        startColumn,
        endColumn,
        preview: {
            before: line.slice(0, startColumn),
            inside: line.slice(startColumn, endColumn),
            after: capAfter(line.slice(endColumn)),
        },
    };
}

function capAfter(after: string): string {
    if (after.length <= MAX_AFTER_CHARS) return after;
    // Don't split a surrogate pair: half a pair renders as U+FFFD.
    let cut = MAX_AFTER_CHARS;
    const lead = after.charCodeAt(cut - 1);
    if (lead >= 0xd800 && lead <= 0xdbff) cut--;
    return after.slice(0, cut);
}

/** Twin of the search panel's `labelFor`: an absolute path would eat the whole width of a narrow sidebar. */
function labelFor(absolutePath: string, root: string): string {
    // Empty root means no folder is open (file from the CLI): show the path as is,
    // otherwise `startsWith("")` would eat the leading slash.
    const rest = root !== "" && absolutePath.startsWith(root) ? absolutePath.slice(root.length) : null;
    // A sibling with a common prefix ("/work/project2" with root "/work/project") is not
    // inside the root: the remainder must start with a separator.
    // Stryker disable next-line Regex: the branch is taken only when `rest` starts with a separator, so the `^` anchor doesn't affect the result
    // Stryker disable next-line ConditionalExpression: `rest !== null` is a fast path; without it the regexp would test the string "null", find no separator and fall into the same `absolutePath` branch
    const rel = rest !== null && /^[/\\]/u.test(rest) ? rest.replace(/^[/\\]+/u, "") : absolutePath;
    return rel.replace(/\\/gu, "/");
}

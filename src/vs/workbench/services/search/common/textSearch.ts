/**
 * Pure model + ripgrep glue for the Search view: the query shape, the mapping
 * from query → `rg` arguments, and the parser for `rg --json` output. No I/O and
 * no `node:` imports — the spawning lives in `../node/textSearchService.ts`.
 *
 * This module is the browser-importable **port**: it also declares the
 * {@link ITextSearchService} interface + DI token that the node service
 * implements, so the (browser) Search view depends on the interface, not the
 * node process code (env-axis boundary).
 *
 * Mirrors VS Code's `IPatternInfo` / `IFileMatch` conceptually (see
 * `/workspaces/vscode` `services/search/common/search.ts`), trimmed to the
 * minimal surface this slice needs.
 */

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** A single content-search request, one per query/toggle change. */
export interface ITextSearchQuery {
    /** The raw query text as typed by the user. */
    pattern: string;
    /** Treat {@link pattern} as a regular expression instead of a literal. */
    isRegExp: boolean;
    /** Match case exactly; when false the search is case-insensitive. */
    isCaseSensitive: boolean;
    /** Match whole words only (`rg -w`). */
    isWholeWord: boolean;
    /** Include globs (`rg --glob <g>`); empty means "everything". */
    includes: readonly string[];
    /** Exclude globs (`rg --glob !<g>`). */
    excludes: readonly string[];
}

/** One matched span on one line, with a split preview for highlighting. */
export interface ITextMatch {
    /** 1-based line number, as reported by ripgrep. */
    lineNumber: number;
    /** 0-based character offset of the match start within the line. */
    startColumn: number;
    /** 0-based character offset just past the match end. */
    endColumn: number;
    /** The line split around the match so the view can highlight `inside`. */
    preview: { before: string; inside: string; after: string };
}

/** All matches found in a single file. */
export interface IFileMatch {
    absolutePath: string;
    matches: ITextMatch[];
}

/** Summary of a finished (or cancelled) search. */
export interface ITextSearchComplete {
    /** Total matched spans reported. */
    matchCount: number;
    /** Distinct files that had at least one match. */
    fileCount: number;
    /** True when the search was stopped at the result cap. */
    limitHit: boolean;
    /** Human-readable ripgrep/spawn error, when the search failed. */
    error?: string;
}

/** A running search: awaitable completion + a way to stop it early. */
export interface ISearchHandle {
    readonly complete: Promise<ITextSearchComplete>;
    cancel(): void;
}

/**
 * Content search across the workspace. Implemented by the node service (spawns
 * ripgrep); the browser Search view depends on this interface via
 * {@link TextSearchServiceDIToken}.
 */
export interface ITextSearchService {
    /**
     * Runs {@link query} under `folder`, streaming each file's matches to
     * `onResult`. Returns immediately with a handle; awaiting `handle.complete`
     * yields the summary.
     */
    search(query: ITextSearchQuery, folder: string, onResult: (match: IFileMatch) => void): ISearchHandle;
}

export const TextSearchServiceDIToken = token<ITextSearchService>("TextSearchService");

/**
 * Validates a user-typed regular expression. Returns an error message when the
 * pattern is malformed, or `null` when it compiles. Only meaningful when the
 * regex toggle is on — a literal query is never compiled.
 */
export function validateRegex(pattern: string): string | null {
    try {
        // Calling RegExp as a function compiles the pattern and throws on a
        // malformed one, without constructing an unused object.
        RegExp(pattern);
        return null;
    } catch (err) {
        // RegExp only ever throws a SyntaxError (an Error) for a bad pattern.
        return (err as Error).message;
    }
}

/**
 * Builds the `rg` argument vector for {@link query}, searching under
 * `searchPath`. The caller spawns `rg` with these args (and typically that same
 * path as cwd). Returns `null` when there is nothing to search for (empty
 * pattern, or a regex toggle with a malformed pattern).
 */
export function buildRgArgs(query: ITextSearchQuery, searchPath: string): string[] | null {
    if (query.pattern === "") return null;
    if (query.isRegExp && validateRegex(query.pattern) !== null) return null;

    // `--json` streams structured begin/match/end events; `--` terminates
    // options so a path that looks like a flag is still treated as a path.
    const args: string[] = ["--json"];

    args.push(query.isCaseSensitive ? "--case-sensitive" : "--ignore-case");
    if (query.isWholeWord) args.push("--word-regexp");
    // Literal queries go through `-F` (fixed-string) so regex metacharacters are
    // taken verbatim. `-e` passes the pattern explicitly so a leading `-` is not
    // mistaken for a flag and the query never collides with the positional path.
    if (!query.isRegExp) args.push("--fixed-strings");
    args.push("-e", query.pattern);

    for (const glob of query.includes) {
        if (glob !== "") args.push("--glob", glob);
    }
    for (const glob of query.excludes) {
        if (glob !== "") args.push("--glob", `!${glob}`);
    }

    args.push("--", searchPath);
    return args;
}

// ─── rg --json parsing ──────────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * ripgrep reports submatch offsets as **byte** offsets into the (UTF-8) line, so
 * the split must happen on bytes and re-decode — slicing the JS string directly
 * would be wrong for any non-ASCII line. Also strips a trailing newline from
 * `after` so the preview does not carry the line break.
 */
function splitPreviewByBytes(lineText: string, startByte: number, endByte: number): ITextMatch["preview"] {
    const bytes = encoder.encode(lineText);
    const before = decoder.decode(bytes.subarray(0, startByte));
    const inside = decoder.decode(bytes.subarray(startByte, endByte));
    const after = decoder.decode(bytes.subarray(endByte)).replace(/\r?\n$/, "");
    return { before, inside, after };
}

/**
 * Parses one line of `rg --json` output. Returns an {@link IFileMatch} (one file,
 * the matches on that single reported line) for a `match` event, or `null` for
 * every other event type (`begin`/`end`/`summary`), blank lines, and anything
 * that fails to parse — the caller merges the per-line results by path.
 *
 * A single `match` event carries one line with one or more submatches; each
 * submatch becomes one {@link ITextMatch}. Paths that ripgrep reports as bytes
 * (non-UTF-8 filenames) are skipped for this minimal slice.
 */
export function parseRgMatchLine(line: string): IFileMatch | null {
    if (line.trim() === "") return null;

    let event: unknown;
    try {
        event = JSON.parse(line);
    } catch {
        return null;
    }

    if (!isRecord(event) || event.type !== "match" || !isRecord(event.data)) return null;
    const data = event.data;

    const absolutePath = textField(data.path);
    const lineText = textField(data.lines);
    const lineNumber = typeof data.line_number === "number" ? data.line_number : null;
    if (absolutePath === null || lineText === null || lineNumber === null) return null;

    if (!Array.isArray(data.submatches)) return null;
    const matches: ITextMatch[] = [];
    for (const raw of data.submatches) {
        if (!isRecord(raw) || typeof raw.start !== "number" || typeof raw.end !== "number") continue;
        const preview = splitPreviewByBytes(lineText, raw.start, raw.end);
        matches.push({
            lineNumber,
            startColumn: preview.before.length,
            endColumn: preview.before.length + preview.inside.length,
            preview,
        });
    }
    if (matches.length === 0) return null;

    return { absolutePath, matches };
}

/** Reads ripgrep's `{ text: string }` wrapper (used for `path` and `lines`). */
function textField(value: unknown): string | null {
    return isRecord(value) && typeof value.text === "string" ? value.text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

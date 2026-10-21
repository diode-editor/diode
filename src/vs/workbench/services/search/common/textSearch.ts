import { splitGlobAware } from "../../../../base/common/glob.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IUseIgnoreFiles } from "../../../common/configuration/excludeSettings.ts";

import { anchorRgGlob, rgExcludeArgs, rgIgnoreFilesArgs } from "./ripgrepArgs.ts";

export interface ITextSearchQuery {
    pattern: string;
    isRegExp: boolean;
    isCaseSensitive: boolean;
    isWholeWord: boolean;
    /** Empty means everything; matched like {@link excludes}. */
    includes: readonly string[];
    /**
     * Matched against the path from the search root (`common` is `<root>/common` only);
     * field text goes through {@link parseSearchFieldGlobs} first.
     */
    excludes: readonly string[];
    useIgnoreFiles: IUseIgnoreFiles;
}

export interface ITextMatch {
    /** 1-based line number, as reported by ripgrep. */
    lineNumber: number;
    /** 0-based character offset of the match start within the line. */
    startColumn: number;
    /** 0-based character offset just past the match end. */
    endColumn: number;
    preview: { before: string; inside: string; after: string };
}

export interface IFileMatch {
    absolutePath: string;
    matches: ITextMatch[];
}

export interface ITextSearchComplete {
    matchCount: number;
    fileCount: number;
    limitHit: boolean;
    error?: string;
}

export interface ISearchHandle {
    readonly complete: Promise<ITextSearchComplete>;
    cancel(): void;
}

export interface ITextSearchService {
    search(query: ITextSearchQuery, folder: string, onResult: (match: IFileMatch) => void): ISearchHandle;
}

export const TextSearchServiceDIToken = token<ITextSearchService>("TextSearchService");

export function validateRegex(pattern: string): string | null {
    try {
        // Without `new`: compiles (and throws) without constructing an unused object.
        RegExp(pattern);
        return null;
    } catch (err) {
        // RegExp only ever throws a SyntaxError (an Error) for a bad pattern.
        return (err as Error).message;
    }
}

/**
 * Parses the "files to include" / "files to exclude" field into
 * {@link ITextSearchQuery} globs (relative to the search root) — upstream
 * `parseSearchPaths` for a single folder:
 * - comma-separated list; a comma inside `{…}`/`[…]` does not split;
 * - `foo` matches at any depth: `**\/foo` and everything under it `**\/foo/**`;
 * - `.js` is shorthand for `*.js`; a trailing `/` is trimmed;
 * - `./src` is a root-relative path: `src` and `src/**`.
 *
 * Upstream turns `.` (the root itself), paths outside the root (`../x`) and
 * absolute paths into search roots; we have a single root, so such segments
 * yield no globs.
 */
export function parseSearchFieldGlobs(value: string): string[] {
    const globs: string[] = [];
    for (const raw of splitGlobAware(value, ",")) {
        const segment = raw.trim();
        if (/^\.\.?([/\\]|$)/u.test(segment)) {
            const relative = segment
                .replace(/\\/gu, "/")
                .replace(/^\.(\/|$)/u, "")
                .replace(/\/+$/u, "");
            // `.` is the root itself: upstream makes it a search root without a glob.
            // A `**` glob is not the same — rg's `--glob` overrides `.gitignore`.
            if (relative === "" || relative.startsWith("..")) continue;
            globs.push(relative, `${relative}/**`);
            continue;
        }
        let glob = segment.replace(/[/\\]+$/u, "");
        if (glob === "" || isAbsolutePath(glob)) continue;
        if (glob.startsWith(".")) glob = `*${glob}`;
        // `**/**` collapses: `**/*.ts` yields `**/*.ts/**` and `**/*.ts`, not `**/**/*.ts`.
        globs.push(...[`**/${glob}/**`, `**/${glob}`].map((g) => g.replace(/\*\*\/\*\*/gu, "**")));
    }
    return globs;
}

/** No `node:path`: this is a browser module. */
function isAbsolutePath(segment: string): boolean {
    return segment.startsWith("/") || /^[a-zA-Z]:[/\\]/u.test(segment) || segment.startsWith("\\\\");
}

/** `null` when there is nothing to search: empty pattern or a malformed regex. */
export function buildRgArgs(query: ITextSearchQuery, searchPath: string): string[] | null {
    if (query.pattern === "") return null;
    if (query.isRegExp && validateRegex(query.pattern) !== null) return null;

    const args: string[] = ["--json"];

    args.push(query.isCaseSensitive ? "--case-sensitive" : "--ignore-case");
    if (query.isWholeWord) args.push("--word-regexp");
    // `-e`: a pattern with a leading `-` is not taken for a flag.
    if (!query.isRegExp) args.push("--fixed-strings");
    args.push("-e", query.pattern);

    // Globs are anchored to the root, like upstream `getRgArgs`: rg matches a glob
    // without `/` at any depth, so `"common": true` from `files.exclude` would
    // silently drop `nci/common/**`, which Explorer shows.
    for (const glob of query.includes) {
        if (glob !== "") args.push("--glob", anchorRgGlob(glob));
    }
    args.push(...rgExcludeArgs(query.excludes));
    // `--hidden`, like upstream and Quick Open (`buildRgFilesArgs`): dotfiles are
    // filtered by `files.exclude` and ignore files, not by the leading dot.
    args.push("--hidden", ...rgIgnoreFilesArgs(query.useIgnoreFiles));

    args.push("--", searchPath);
    return args;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Only the tail is capped: it is needed just for rendering, and uncapped, a match in a
// minified file drags hundreds of kilobytes into the line. `before` must not be capped —
// startColumn is computed from it.
const MAX_AFTER_CHARS = 256;

/**
 * ripgrep reports submatch offsets as UTF-8 **byte** offsets, so the split goes on
 * bytes and re-decodes — slicing the JS string breaks on non-ASCII lines.
 */
function splitPreviewByBytes(lineText: string, startByte: number, endByte: number): ITextMatch["preview"] {
    const bytes = encoder.encode(lineText);
    const before = decoder.decode(bytes.subarray(0, startByte));
    const inside = decoder.decode(bytes.subarray(startByte, endByte));
    let after = decoder.decode(bytes.subarray(endByte)).replace(/\r?\n$/, "");
    if (after.length > MAX_AFTER_CHARS) {
        // Cut after decoding (a byte cut would leave U+FFFD in the middle of a
        // multibyte character) and never split a surrogate pair.
        let cut = MAX_AFTER_CHARS;
        const lead = after.charCodeAt(cut - 1);
        if (lead >= 0xd800 && lead <= 0xdbff) cut--;
        after = after.slice(0, cut);
    }
    return { before, inside, after };
}

/**
 * `null` for non-`match` events and unparsable lines — the caller merges per-line
 * results by path. Paths reported as bytes (non-UTF-8) are skipped.
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

function textField(value: unknown): string | null {
    return isRecord(value) && typeof value.text === "string" ? value.text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

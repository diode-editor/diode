import { splitGlobAware } from "../../../../base/common/glob.ts";
import { isHighSurrogate, isLowSurrogate } from "../../../../base/common/strings.ts";
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
    /** `before` and `after` are capped at the match side — not the whole line. */
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

// Both sides of the preview are capped: the row renders only a few characters around
// the match, and uncapped, a line with thousands of matches (a minified bundle,
// `tsconfig.tsbuildinfo`) keeps a copy of the line prefix per match — that ran the
// heap out of memory on a 1 MB line with ~5000 hits. Columns are computed from the
// byte offsets, not from the preview, so the caps never shift them.
const MAX_PREVIEW_CHARS = 256;

/**
 * ripgrep reports submatch offsets as UTF-8 **byte** offsets. Like upstream
 * `createTextSearchMatch`, the line is encoded once and each submatch decodes only
 * the bytes since the previous one — linear in the line, not in line × matches.
 */
function toTextMatches(lineText: string, lineNumber: number, submatches: readonly unknown[]): ITextMatch[] {
    const bytes = encoder.encode(lineText);
    const contentEnd = contentLength(lineText);
    const matches: ITextMatch[] = [];
    let prevByte = 0;
    let prevColumn = 0;
    for (const raw of submatches) {
        if (!isRecord(raw) || typeof raw.start !== "number" || typeof raw.end !== "number") continue;
        const startColumn = prevColumn + decoder.decode(bytes.subarray(prevByte, raw.start)).length;
        const endColumn = startColumn + decoder.decode(bytes.subarray(raw.start, raw.end)).length;
        prevByte = raw.end;
        prevColumn = endColumn;
        matches.push({
            lineNumber,
            startColumn,
            endColumn,
            preview: {
                before: lineText.slice(previewStart(lineText, startColumn), startColumn),
                inside: lineText.slice(startColumn, endColumn),
                after: lineText.slice(endColumn, previewEnd(lineText, endColumn, contentEnd)),
            },
        });
    }
    return matches;
}

/** The line's own newline (`\n` or `\r\n`) is not part of the preview. */
function contentLength(lineText: string): number {
    if (lineText.endsWith("\r\n")) return lineText.length - 2;
    if (lineText.endsWith("\n")) return lineText.length - 1;
    return lineText.length;
}

/** Never starts on the low half of a surrogate pair (well-formed text never has one at 0). */
function previewStart(lineText: string, startColumn: number): number {
    const start = Math.max(0, startColumn - MAX_PREVIEW_CHARS);
    return isLowSurrogate(lineText.charCodeAt(start)) ? start + 1 : start;
}

/** Never ends on the high half of a surrogate pair (well-formed text never has one last). */
function previewEnd(lineText: string, endColumn: number, contentEnd: number): number {
    const end = Math.min(contentEnd, endColumn + MAX_PREVIEW_CHARS);
    return isHighSurrogate(lineText.charCodeAt(end - 1)) ? end - 1 : end;
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
    const matches = toTextMatches(lineText, lineNumber, data.submatches);
    if (matches.length === 0) return null;

    return { absolutePath, matches };
}

function textField(value: unknown): string | null {
    return isRecord(value) && typeof value.text === "string" ? value.text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

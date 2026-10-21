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
 * Разбирает текст поля «files to include» / «files to exclude» в шаблоны
 * {@link ITextSearchQuery} (от корня поиска) — `parseSearchPaths` эталона для
 * одной папки:
 * - список через запятую, запятая внутри `{…}`/`[…]` не делит;
 * - `foo` — на любой глубине: `**\/foo` и всё под ним `**\/foo/**`;
 * - `.js` — сокращение `*.js`; хвостовой `/` срезается;
 * - `./src` — путь от корня: `src` и `src/**`.
 *
 * `.` (сам корень), пути вне корня (`../x`) и абсолютные пути эталон
 * превращает в корни поиска; у нас корень один, и такие сегменты шаблонов не
 * дают.
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
            // `.` — сам корень: у эталона это корень поиска без шаблона. Шаблон
            // `**` был бы не тем же самым — `--glob` у rg перебивает `.gitignore`.
            if (relative === "" || relative.startsWith("..")) continue;
            globs.push(relative, `${relative}/**`);
            continue;
        }
        let glob = segment.replace(/[/\\]+$/u, "");
        if (glob === "" || isAbsolutePath(glob)) continue;
        if (glob.startsWith(".")) glob = `*${glob}`;
        // `**/**` склеивается: `**/*.ts` даёт `**/*.ts/**` и `**/*.ts`, а не `**/**/*.ts`.
        globs.push(...[`**/${glob}/**`, `**/${glob}`].map((g) => g.replace(/\*\*\/\*\*/gu, "**")));
    }
    return globs;
}

/** Без `node:path`: модуль браузерный. */
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

    // Шаблоны якорятся к корню, как `getRgArgs` эталона: у rg шаблон без `/`
    // матчится на любой глубине, и `"common": true` из `files.exclude` молча
    // выкидывал бы из поиска `nci/common/**`, который Explorer показывает.
    for (const glob of query.includes) {
        if (glob !== "") args.push("--glob", anchorRgGlob(glob));
    }
    args.push(...rgExcludeArgs(query.excludes));
    // `--hidden`, как у эталона и у Quick Open (`buildRgFilesArgs`): dot-файлы
    // режут `files.exclude` и ignore-файлы, а не точка в имени.
    args.push("--hidden", ...rgIgnoreFilesArgs(query.useIgnoreFiles));

    args.push("--", searchPath);
    return args;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Капаем только хвост: он нужен лишь отрисовке, без капа матч в минифицированном
// файле тащит в строку сотни килобайт. `before` капать нельзя — от него считается startColumn.
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
        // Режем после декодирования (срез по байтам дал бы U+FFFD посреди
        // мультибайтового символа) и не разрываем суррогатную пару.
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

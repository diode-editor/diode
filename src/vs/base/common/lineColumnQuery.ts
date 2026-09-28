/**
 * A parsed line/column navigation target. `line` and `column` are 1-based, as
 * the user types them (matching the editor status bar "Ln X, Col Y").
 */
export interface ParsedGoto {
    line: number;
    column?: number;
}

// Trailing `:line`, `:line:col` or `:line,col` suffix. Numbers may be empty so
// that `file.ts:` (mid-typing) still strips the colon from the fuzzy filter.
const GOTO_SUFFIX = /:(\d*)(?:[:,](\d*))?$/;

/**
 * Splits a `file[:line[:column]]` string into the file part and an optional
 * line/column suffix, mirroring VS Code (`file.ts:10`, `file.ts:10:5`,
 * `file.ts:10,5`). Two callers share it: Quick Open (fuzzy file part) and the
 * CLI (`--goto`), so the suffix grammar cannot drift between them.
 *
 * The suffix is always stripped from the returned `filePart` — even a bare
 * trailing colon with no number yet (`file.ts:`) — so a `:` never leaks into
 * fuzzy matching and wrecks the file search. `goto` is non-null only once a
 * line number is present.
 */
export function splitFileQuery(query: string): { filePart: string; goto: ParsedGoto | null } {
    const match = GOTO_SUFFIX.exec(query);
    if (match === null) return { filePart: query, goto: null };

    const filePart = query.slice(0, match.index);
    const goto = parseGotoGroups(match[1], match[2]);
    return { filePart, goto };
}

/**
 * Parses a Go-to-Line query (the `:`-prefixed Quick Open mode). Accepts
 * `:line`, `:line:col` and `:line,col`; returns null until a line number is
 * actually typed (`:` alone).
 */
export function parseGotoLineQuery(query: string): ParsedGoto | null {
    return splitFileQuery(query).goto;
}

function parseGotoGroups(lineGroup: string, colGroup: string | undefined): ParsedGoto | null {
    if (lineGroup === "") return null;
    const line = Number(lineGroup);
    if (colGroup === undefined || colGroup === "") return { line };
    return { line, column: Number(colGroup) };
}

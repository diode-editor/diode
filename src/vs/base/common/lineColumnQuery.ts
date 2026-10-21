/** 1-based, as the user types them. */
export interface ParsedGoto {
    line: number;
    column?: number;
}

// Trailing `:line`, `:line:col` or `:line,col` suffix. Numbers may be empty so
// that `file.ts:` (mid-typing) still strips the colon from the fuzzy filter.
const GOTO_SUFFIX = /:(\d*)(?:[:,](\d*))?$/;

export function splitFileQuery(query: string): { filePart: string; goto: ParsedGoto | null } {
    const match = GOTO_SUFFIX.exec(query);
    if (match === null) return { filePart: query, goto: null };

    const filePart = query.slice(0, match.index);
    const goto = parseGotoGroups(match[1], match[2]);
    return { filePart, goto };
}

export function parseGotoLineQuery(query: string): ParsedGoto | null {
    return splitFileQuery(query).goto;
}

function parseGotoGroups(lineGroup: string, colGroup: string | undefined): ParsedGoto | null {
    if (lineGroup === "") return null;
    const line = Number(lineGroup);
    if (colGroup === undefined || colGroup === "") return { line };
    return { line, column: Number(colGroup) };
}

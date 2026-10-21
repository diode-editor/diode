import { getLocation } from "jsonc-parser";

/** Half-open `[start, end)` offsets into the document text. */
export interface IOffsetRange {
    readonly start: number;
    readonly end: number;
}

export interface ISettingsKeyContext {
    readonly kind: "key";
    readonly replaceRange: IOffsetRange;
}

export interface ISettingsValueContext {
    readonly kind: "value";
    readonly key: string;
    readonly replaceRange: IOffsetRange;
}

export type SettingsCompletionContext = ISettingsKeyContext | ISettingsValueContext | null;

/** Mirrors the core's completion prefix. */
const TOKEN_CHAR = /[\w.-]/;

/**
 * `null` — the caret isn't a top-level entry of the settings map.
 * `section` — `settings` for a `.code-workspace` file; omitted for `settings.json`.
 */
export function getSettingsCompletionContext(
    text: string,
    offset: number,
    section?: string,
): SettingsCompletionContext {
    const location = getLocation(text, offset);
    const depth = section === undefined ? 0 : 1;
    if (section !== undefined && location.path[0] !== section) return null;

    // Only direct entries carry schema; nested objects have a longer path.
    if (location.path.length !== depth + 1) return null;

    const replaceRange = tokenRangeAt(text, offset);
    if (location.isAtPropertyKey) return { kind: "key", replaceRange };

    const key = location.path[depth];
    if (typeof key !== "string" || key === "") return null;
    return { kind: "value", key, replaceRange };
}

/**
 * Scanned, not read off the parse tree: `getLocation().previousNode` disappears
 * exactly in half-typed states (`{ edi`, `"x": t`). Quotes are included so the
 * provider's `"editor.tabSize"` replaces `"edi"` instead of doubling them.
 */
function tokenRangeAt(text: string, offset: number): IOffsetRange {
    let start = offset;
    while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start--;
    const quoted = start > 0 && text[start - 1] === '"';
    if (quoted) start--;

    let end = offset;
    while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
    if (quoted && text[end] === '"') end++;

    return { start, end };
}

/** 0-based; clamped to the text length. */
export function positionToOffset(text: string, line: number, character: number): number {
    let offset = 0;
    for (let i = 0; i < line; i++) {
        const nl = text.indexOf("\n", offset);
        if (nl === -1) return text.length;
        offset = nl + 1;
    }
    return Math.min(offset + character, text.length);
}

/** 0-based. */
export function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    const clamped = Math.min(Math.max(offset, 0), text.length);
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < clamped; i++) {
        if (text[i] === "\n") {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: clamped - lineStart };
}

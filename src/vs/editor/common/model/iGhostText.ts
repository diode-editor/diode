/** `lines[0]` is drawn at the tail of line `line` after `character`; the rest are view zones below it. */
export interface IGhostText {
    readonly line: number;
    readonly character: number;
    readonly lines: readonly string[];
}

export function ghostTextEquals(a: IGhostText | null, b: IGhostText | null): boolean {
    if (a === null || b === null) return a === b;
    return (
        a.line === b.line &&
        a.character === b.character &&
        a.lines.length === b.lines.length &&
        a.lines.every((text, i) => text === b.lines[i])
    );
}

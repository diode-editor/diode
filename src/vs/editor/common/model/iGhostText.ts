/** `lines[0]` дорисовывается в хвост строки `line` после `character`, остальные — view zones под ней. */
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

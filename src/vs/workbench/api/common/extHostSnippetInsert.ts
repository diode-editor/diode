import type * as vscode from "vscode";

import { Range } from "./vscodeTypes.ts";

/** Upstream's `where`: nothing or an empty list means the selections; a position is an empty range. */
export function snippetRanges(
    location: vscode.Position | vscode.Range | readonly vscode.Position[] | readonly vscode.Range[] | undefined,
    selections: readonly vscode.Selection[],
): readonly vscode.Range[] {
    if (location === undefined || (Array.isArray(location) && location.length === 0)) return selections;
    const list: readonly (vscode.Position | vscode.Range)[] = Array.isArray(location) ? location : [location];
    return list.map((item) =>
        item instanceof Range ? item : new Range(item as vscode.Position, item as vscode.Position),
    );
}

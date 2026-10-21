import * as path from "node:path";

import type { IEditorPane } from "./iEditorPane.ts";

/**
 * A deliberate deviation from upstream (the maintainer's call): VS Code shows deletion only with
 * strikethrough (SGR 9), which not every terminal renders.
 */
export const DELETED_TAB_SUFFIX = " (deleted)";

/**
 * Same-named files get the shortest distinguishing path suffix (like VS Code). Shared by the tab
 * strip and the Ctrl+Tab overlay: the lists are ordered differently, but the names must match.
 */
export function computeTabLabels(
    editors: readonly IEditorPane[],
    displayName: (editor: IEditorPane) => string,
): string[] {
    const names = editors.map((editor) => displayName(editor));
    const groups = new Map<string, number[]>();
    names.forEach((name, i) => {
        const arr = groups.get(name);
        if (arr) arr.push(i);
        else groups.set(name, [i]);
    });

    const labels = [...names];
    for (const indices of groups.values()) {
        if (indices.length < 2) continue;
        const dirs = indices.map((i) => {
            const uri = editors[i].uri;
            // Gate on the scheme, not on "path is non-empty": fsPath of a non-file scheme
            // returns garbage instead of throwing.
            /* v8 ignore start -- defensive: only files can share a displayName */
            // Stryker disable next-line ConditionalExpression,ArrayDeclaration: unreachable for the same reason as for coverage
            if (uri.scheme !== "file") return [];
            /* v8 ignore stop */
            // The path is already absolute: Uri.file goes through path.resolve.
            return path.dirname(uri.fsPath).split(path.sep).filter(Boolean);
        });
        const maxK = Math.max(0, ...dirs.map((d) => d.length));
        indices.forEach((editorIndex, a) => {
            // Same-named files always differ by path (openFile dedupes), so the loop finds
            // a unique tail by k = maxK at the latest.
            for (let k = 1; k <= maxK; k++) {
                const mine = dirs[a].slice(-k).join(path.sep);
                const collision = dirs.some((d, b) => b !== a && d.slice(-k).join(path.sep) === mine);
                if (!collision) {
                    labels[editorIndex] = `${names[editorIndex]} — ${mine}`;
                    return;
                }
            }
        });
    }
    // Appended after the distinguishing suffix: same-named files are told apart by path, not by deletion.
    return labels.map((label, i) => (editors[i].isOrphaned === true ? label + DELETED_TAB_SUFFIX : label));
}

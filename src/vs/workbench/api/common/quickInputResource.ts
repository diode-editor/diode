import type * as vscode from "vscode";

import { QuickPickItemKind } from "./vscodeTypes.ts";

/** `workspace.asRelativePath`: `window` is built before `workspace`, so it comes as a function. */
export type AsRelativePath = (uri: vscode.Uri) => string;

/**
 * Upstream `mainThreadQuickOpen`: what `resourceUri` gives an item with no label or description of its own.
 * Done on this side, not in the host, because the workspace-relative path is at hand here.
 */
export function withResourceFields(
    item: vscode.QuickPickItem,
    asRelativePath: AsRelativePath,
): { readonly label: string; readonly description: string | undefined } {
    const { description, resourceUri } = item;
    // Declared as a string, but `resourceUri` is documented as making it optional.
    const label = (item.label as string | undefined) ?? "";
    if (resourceUri === undefined) return { label, description };
    if (label !== "") return { label, description: description ?? asRelativePath(resourceUri) };
    const slash = resourceUri.path.lastIndexOf("/");
    const folder = resourceUri.with({ path: resourceUri.path.slice(0, slash) });
    return {
        label: resourceUri.path.slice(slash + 1),
        description: description ?? asRelativePath(folder),
    };
}

/** An item the picker shows: its index in the extension's `items` and the separator right before it. */
export interface IGroupedQuickPickItem<T> {
    readonly item: T;
    readonly index: number;
    readonly separatorLabel?: string;
}

/**
 * Upstream `QuickPickItemKind.Separator` is not a row: it attaches to the item right after it
 * (`quickInputList.ts` `setElements`). Of several in a row the last one wins, a trailing one draws nothing.
 */
export function attachSeparators<T extends string | vscode.QuickPickItem>(
    items: readonly T[],
): IGroupedQuickPickItem<T>[] {
    const grouped: IGroupedQuickPickItem<T>[] = [];
    let separatorLabel: string | undefined;
    for (const [index, item] of items.entries()) {
        // A string has no `kind` either. Compared as a number: the extension's enum comes from its own copy of d.ts.
        const separator = item as Partial<vscode.QuickPickItem>;
        if ((separator.kind as number | undefined) === (QuickPickItemKind.Separator as number)) {
            separatorLabel = typeof separator.label === "string" ? separator.label : "";
            continue;
        }
        grouped.push({ item, index, separatorLabel });
        separatorLabel = undefined;
    }
    return grouped;
}

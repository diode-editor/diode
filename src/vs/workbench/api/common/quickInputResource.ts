import type * as vscode from "vscode";

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

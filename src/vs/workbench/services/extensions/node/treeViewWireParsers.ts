import type {
    IWireThemeIcon,
    IWireTreeItem,
    IWireTreeViewMessage,
    IWireTreeViewRefresh,
    IWireTreeViewRegistration,
    IWireTreeViewReveal,
    IWireTreeViewTitle,
    WireTreeItemCollapsibleState,
} from "../../../api/common/treeViewWireTypes.ts";

// Tree view messages from the subprocess (`treeView.*`); `null` — a malformed message, ignored.
// An absent optional field stays `undefined` (the wire carries `undefined` as is).

type Fields = Readonly<Record<string, unknown>>;

/** The message's fields, when it names a view. */
function viewEnvelope(raw: unknown): (Fields & { readonly viewId: string }) | null {
    const p = raw as Fields | null | undefined;
    const viewId = p?.viewId;
    return typeof viewId === "string" && viewId !== "" ? (p as Fields & { readonly viewId: string }) : null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function parseWireTreeViewRegistration(raw: unknown): IWireTreeViewRegistration | null {
    const p = viewEnvelope(raw);
    if (p === null) return null;
    return {
        viewId: p.viewId,
        showCollapseAll: p.showCollapseAll === true,
        canSelectMany: p.canSelectMany === true,
        extensionId: optionalString(p.extensionId),
    };
}

export function parseWireTreeViewId(raw: unknown): string | null {
    return viewEnvelope(raw)?.viewId ?? null;
}

export function parseWireTreeViewRefresh(raw: unknown): IWireTreeViewRefresh | null {
    const p = viewEnvelope(raw);
    if (p === null) return null;
    if (p.items === undefined) return { viewId: p.viewId };
    return Array.isArray(p.items) ? { viewId: p.viewId, items: parseWireTreeItems(p.items) } : null;
}

export function parseWireTreeViewMessage(raw: unknown): IWireTreeViewMessage | null {
    const p = viewEnvelope(raw);
    if (p === null || typeof p.message !== "string") return null;
    return { viewId: p.viewId, message: p.message };
}

export function parseWireTreeViewTitle(raw: unknown): IWireTreeViewTitle | null {
    const p = viewEnvelope(raw);
    if (p === null) return null;
    return { viewId: p.viewId, title: optionalString(p.title), description: optionalString(p.description) };
}

export function parseWireTreeViewReveal(raw: unknown): IWireTreeViewReveal | null {
    const p = viewEnvelope(raw);
    if (p === null) return null;
    const item = p.item === undefined ? undefined : parseWireTreeItem(p.item);
    if (item === null) return null;
    return {
        viewId: p.viewId,
        item,
        parentChain: parseWireTreeItems(p.parentChain),
        select: p.select !== false,
        focus: p.focus === true,
        expand: typeof p.expand === "number" || p.expand === true ? p.expand : false,
    };
}

/** Rows without a handle are dropped: the host has nothing to key them by. */
export function parseWireTreeItems(raw: unknown): IWireTreeItem[] {
    if (!Array.isArray(raw)) return [];
    const items: IWireTreeItem[] = [];
    for (const entry of raw) {
        const item = parseWireTreeItem(entry);
        if (item !== null) items.push(item);
    }
    return items;
}

function parseWireTreeItem(raw: unknown): IWireTreeItem | null {
    const row = raw as Fields | null | undefined;
    if (typeof row?.handle !== "string" || row.handle === "") return null;
    return {
        handle: row.handle,
        previousHandle: optionalString(row.previousHandle),
        parentHandle: optionalString(row.parentHandle),
        label: optionalString(row.label) ?? "",
        description: typeof row.description === "string" || row.description === true ? row.description : undefined,
        collapsibleState: collapsibleStateOf(row.collapsibleState),
        themeIcon: parseThemeIcon(row.themeIcon),
        resourceUri: optionalString(row.resourceUri),
        contextValue: optionalString(row.contextValue),
        command: parseCommand(row.command),
    };
}

function collapsibleStateOf(raw: unknown): WireTreeItemCollapsibleState {
    return raw === 1 || raw === 2 ? raw : 0;
}

function parseThemeIcon(raw: unknown): IWireThemeIcon | undefined {
    const p = raw as Fields | null | undefined;
    if (typeof p?.id !== "string") return undefined;
    return { id: p.id, color: optionalString(p.color) };
}

function parseCommand(raw: unknown): IWireTreeItem["command"] {
    const p = raw as Fields | null | undefined;
    if (typeof p?.id !== "string") return undefined;
    return { id: p.id, title: optionalString(p.title) ?? "" };
}

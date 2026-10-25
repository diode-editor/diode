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

type Envelope = Readonly<Record<string, unknown>> | null | undefined;

function viewIdOf(raw: unknown): string | null {
    const viewId = (raw as Envelope)?.viewId;
    return typeof viewId === "string" && viewId !== "" ? viewId : null;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function parseWireTreeViewRegistration(raw: unknown): IWireTreeViewRegistration | null {
    const viewId = viewIdOf(raw);
    if (viewId === null) return null;
    const p = raw as Envelope;
    const extensionId = optionalString(p?.extensionId);
    return {
        viewId,
        showCollapseAll: p?.showCollapseAll === true,
        canSelectMany: p?.canSelectMany === true,
        ...(extensionId === undefined ? {} : { extensionId }),
    };
}

export function parseWireTreeViewId(raw: unknown): string | null {
    return viewIdOf(raw);
}

export function parseWireTreeViewRefresh(raw: unknown): IWireTreeViewRefresh | null {
    const viewId = viewIdOf(raw);
    if (viewId === null) return null;
    const items = (raw as Envelope)?.items;
    if (items === undefined) return { viewId };
    return Array.isArray(items) ? { viewId, items: parseWireTreeItems(items) } : null;
}

export function parseWireTreeViewMessage(raw: unknown): IWireTreeViewMessage | null {
    const viewId = viewIdOf(raw);
    const message = (raw as Envelope)?.message;
    return viewId === null || typeof message !== "string" ? null : { viewId, message };
}

export function parseWireTreeViewTitle(raw: unknown): IWireTreeViewTitle | null {
    const viewId = viewIdOf(raw);
    if (viewId === null) return null;
    const p = raw as Envelope;
    const title = optionalString(p?.title);
    const description = optionalString(p?.description);
    return {
        viewId,
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
    };
}

export function parseWireTreeViewReveal(raw: unknown): IWireTreeViewReveal | null {
    const viewId = viewIdOf(raw);
    if (viewId === null) return null;
    const p = raw as Envelope;
    const item = p?.item === undefined ? undefined : parseWireTreeItem(p.item);
    if (item === null) return null;
    const chain = Array.isArray(p?.parentChain) ? parseWireTreeItems(p.parentChain as unknown[]) : [];
    const expand = typeof p?.expand === "number" || p?.expand === true ? p.expand : false;
    return {
        viewId,
        ...(item === undefined ? {} : { item }),
        parentChain: chain,
        select: p?.select !== false,
        focus: p?.focus === true,
        expand,
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
    const p = raw as Envelope;
    if (typeof p?.handle !== "string" || p.handle === "") return null;
    const parentHandle = optionalString(p.parentHandle);
    const description = typeof p.description === "string" || p.description === true ? p.description : undefined;
    const themeIcon = parseThemeIcon(p.themeIcon);
    const resourceUri = optionalString(p.resourceUri);
    const contextValue = optionalString(p.contextValue);
    const command = p.command as Envelope;
    return {
        handle: p.handle,
        ...(parentHandle === undefined ? {} : { parentHandle }),
        label: optionalString(p.label) ?? "",
        ...(description === undefined ? {} : { description }),
        collapsibleState: collapsibleStateOf(p.collapsibleState),
        ...(themeIcon === undefined ? {} : { themeIcon }),
        ...(resourceUri === undefined ? {} : { resourceUri }),
        ...(contextValue === undefined ? {} : { contextValue }),
        ...(typeof command?.id === "string"
            ? { command: { id: command.id, title: optionalString(command.title) ?? "" } }
            : {}),
    };
}

function collapsibleStateOf(raw: unknown): WireTreeItemCollapsibleState {
    return raw === 1 || raw === 2 ? raw : 0;
}

function parseThemeIcon(raw: unknown): IWireThemeIcon | undefined {
    const p = raw as Envelope;
    if (typeof p?.id !== "string") return undefined;
    const color = optionalString(p.color);
    return color === undefined ? { id: p.id } : { id: p.id, color };
}

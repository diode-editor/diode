import * as nodePath from "node:path";

import type * as vscode from "vscode";

import { cursorStyleFromApi, cursorStyleToApi } from "../../../editor/common/config/editorCursorStyle.ts";

import { implementsApi } from "./apiSurface.ts";
import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import { applyTextEditorEdit } from "./extHostTextEditorEdit.ts";
import { createExtHostTreeViews, type ITreeViewMembers } from "./extHostTreeViews.ts";
import {
    normalizeDecorationRanges,
    serializeDecorationRenderOptions,
    toVscodeSelection,
    toWireSelection,
} from "./extHostTypeConverters.ts";
import { createMessageApi } from "./messageNamespace.ts";
import { createQuickInputApi } from "./quickInputNamespace.ts";
import type { AsRelativePath } from "./quickInputResource.ts";
import { createStatusBarMessage } from "./statusBarMessage.ts";
import { createTerminalNamespace, type ITerminalNamespace } from "./terminalNamespace.ts";
import { createUriHandlers } from "./uriHandlers.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    ColorThemeKind,
    DisposableImpl,
    EventEmitter,
    Position,
    Selection,
    StatusBarAlignment,
    TabInputText,
    TabInputTextDiff,
    Uri,
} from "./vscodeTypes.ts";
import { createWebviewNoopMembers } from "./webviewNoop.ts";
import {
    type IWireDialogFilter,
    type IWireEditorEdit,
    type IWireEditorLayout,
    type IWireFileDecoration,
    type IWireSelection,
    type IWireShowTextDocumentResult,
    type IWireTabGroupSnapshot,
    type IWireTabSnapshot,
    parseWireColorTheme,
    parseWireEditorLayout,
    parseWireOpenDialogResult,
    parseWireSaveDialogResult,
    parseWireSelectionChangeKind,
    parseWireSelections,
    type WireOutputLevel,
} from "./wireTypes.ts";

function makeListenerEvent<T>(listeners: ((e: T) => unknown)[]): vscode.Event<T> {
    return (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: vscode.Disposable[]): vscode.Disposable => {
        const bound: (e: T) => unknown = thisArgs != null ? (e) => listener.call(thisArgs, e) : listener;
        listeners.push(bound);
        const disposable = new DisposableImpl(() => {
            const idx = listeners.indexOf(bound);
            if (idx >= 0) listeners.splice(idx, 1);
        });
        if (disposables !== undefined) disposables.push(disposable);
        return disposable;
    };
}

const NEVER_CANCELLED: vscode.CancellationToken = {
    isCancellationRequested: false,
    /* v8 ignore next -- defensive stub: the host bridge never cancels provideFileDecoration, so the listener is never called */
    onCancellationRequested: () => new DisposableImpl(() => undefined),
};

function normalizeChangedUris(changed: undefined | vscode.Uri | vscode.Uri[]): vscode.Uri[] {
    if (changed === undefined) return [];
    return Array.isArray(changed) ? changed : [changed];
}

/** A single empty cursor at the document start: the selection of a fresh model (upstream 1:1). */
function isInitialSelection(selections: readonly IWireSelection[]): boolean {
    const [only] = selections;
    return (
        selections.length === 1 &&
        only.anchorLine === 0 &&
        only.anchorCharacter === 0 &&
        only.activeLine === 0 &&
        only.activeCharacter === 0
    );
}

function slugify(name: string, fallback: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return slug === "" ? fallback : slug;
}

export function slugifyChannelName(name: string): string {
    return slugify(name, "channel");
}

/**
 * `terminals` is passed when `vscode.tasks` shares terminals with `window` (pty `CustomExecution`);
 * `treeViews` — when a row's command must reach the extension's own commands (`vscode.commands`).
 */
export function createWindowNamespace(
    ctx: IVscodeHostContext,
    terminals: ITerminalNamespace = createTerminalNamespace(ctx.rpc),
    treeViews: ITreeViewMembers = createExtHostTreeViews(ctx.rpc, {
        executeCommand: (id, ...args) => ctx.rpc.request("commands.executeCommand", { id, args }),
        owner: ctx.owner,
    }),
    asRelativePath?: AsRelativePath,
    getWorkspaceFolders: () => readonly vscode.WorkspaceFolder[] | undefined = () => undefined,
): typeof vscode.window {
    const { rpc, registry, owner } = ctx;

    const quickInput = createQuickInputApi(rpc, asRelativePath);
    const messages = createMessageApi(rpc);

    let activeEditorUri: string | null = null;
    /** null until the first meta that carries a group. */
    let activeEditorGroupId: number | null = null;
    let nextProgressHandle = 1;
    let nextStatusBarItemHandle = 1;
    let activeSelections: readonly IWireSelection[] = [];
    /** Single source of `visibleTextEditors`/`tabGroups`/`viewColumn`: API events come from diffing snapshots. */
    let layout: IWireEditorLayout = { groups: [] };
    const selectionsByEditor = new Map<string, readonly IWireSelection[]>();
    /** Their selection event waits for `editor.activeEditorChanged` (see {@link announceRestoredSelections}). */
    const pendingRestoredSelections = new Map<
        string,
        { readonly uri: string; readonly groupId: number; readonly selections: readonly IWireSelection[] }
    >();
    /**
     * Keyed by groupId, not viewColumn: columns are renumbered when groups collapse, and
     * an editor must survive renumbering (AS-9). One file in two groups is two editors (AS-7).
     */
    const editorCache = new Map<number, Map<string, vscode.TextEditor>>();
    const activeEditorListeners: ((editor: vscode.TextEditor | undefined) => void)[] = [];
    const visibleEditorsListeners: ((editors: readonly vscode.TextEditor[]) => void)[] = [];
    const viewColumnListeners: ((e: vscode.TextEditorViewColumnChangeEvent) => void)[] = [];
    const tabsListeners: ((e: vscode.TabChangeEvent) => void)[] = [];
    const tabGroupsListeners: ((e: vscode.TabGroupChangeEvent) => void)[] = [];
    const selectionListeners: ((e: vscode.TextEditorSelectionChangeEvent) => void)[] = [];
    const colorThemeListeners: ((e: vscode.ColorTheme) => void)[] = [];
    /** Seeded with Dark, the VS Code default: `activeColorTheme.kind` is read unchecked before the first `window.themeChanged`. */
    let activeColorTheme: vscode.ColorTheme = { kind: ColorThemeKind.Dark };

    // The host knows a decoration type only by its number.
    let nextDecorationKey = 1;
    const decorationTypeKeys = new WeakMap<vscode.TextEditorDecorationType, number>();

    function selectionKey(groupId: number, uri: string): string {
        return `${String(groupId)}:${uri}`;
    }

    function layoutGroup(groupId: number): IWireTabGroupSnapshot | null {
        return layout.groups.find((group) => group.groupId === groupId) ?? null;
    }

    function effectiveActiveGroupId(): number {
        if (activeEditorGroupId !== null) return activeEditorGroupId;
        return layout.groups.find((group) => group.isActive)?.groupId ?? 1;
    }

    /** The selection cache is already up to date when this is called. */
    function fireSelectionChanged(
        uri: string,
        groupId: number,
        selections: readonly IWireSelection[],
        kind: vscode.TextEditorSelectionChangeKind | undefined,
    ): void {
        const editor = getEditorFor(registry.getOrCreate(Uri.parse(uri)), groupId);
        const event: vscode.TextEditorSelectionChangeEvent = {
            textEditor: editor,
            selections: selections.map(toVscodeSelection),
            kind,
        };
        for (const listener of [...selectionListeners]) listener(event);
    }

    /**
     * Upstream fires `onDidChangeTextEditorSelection` for a tab that becomes visible with a selection
     * other than 1:1 (`restoreState` replaces a fresh model's 1:1). For the active group's editor it fires
     * after `onDidChangeActiveTextEditor`: Claude Code filters by `e.textEditor === activeTextEditor`.
     */
    function announceRestoredSelections(previous: IWireEditorLayout, next: IWireEditorLayout): void {
        pendingRestoredSelections.clear();
        const wasVisible = new Set(visiblePairs(previous));
        for (const group of next.groups) {
            const active = group.tabs.find((tab) => tab.isActive);
            if (active?.kind !== "text") continue;
            const key = selectionKey(group.groupId, active.uri);
            const selections = selectionsByEditor.get(key);
            if (wasVisible.has(key) || selections === undefined || isInitialSelection(selections)) continue;
            if (group.isActive)
                pendingRestoredSelections.set(key, { uri: active.uri, groupId: group.groupId, selections });
            else fireSelectionChanged(active.uri, group.groupId, selections, undefined);
        }
    }

    rpc.handleNotification("editor.activeEditorChanged", (params) => {
        const meta: {
            uri: string | null;
            languageId?: string | null;
            isDirty?: boolean;
            encoding?: string | null;
            eol?: number | null;
            selection?: IWireSelection | null;
            groupId?: number | null;
        } = params;
        activeEditorUri = meta.uri;
        activeEditorGroupId = typeof meta.groupId === "number" ? meta.groupId : null;
        activeSelections = meta.selection == null ? [] : [meta.selection];
        let editor: vscode.TextEditor | undefined;
        if (meta.uri != null) {
            const doc = registry.upsertMeta({
                uri: meta.uri,
                languageId: meta.languageId ?? undefined,
                isDirty: meta.isDirty,
                encoding: meta.encoding ?? undefined,
                eol: meta.eol === 1 || meta.eol === 2 ? meta.eol : undefined,
            });
            editor = getEditorFor(doc, effectiveActiveGroupId());
        }
        for (const listener of [...activeEditorListeners]) {
            listener(editor);
        }
        // Stryker disable next-line StringLiteral: fallback for a missing uri; any non-uri key matches no tab
        const restored = pendingRestoredSelections.get(selectionKey(effectiveActiveGroupId(), meta.uri ?? ""));
        if (restored !== undefined)
            fireSelectionChanged(restored.uri, restored.groupId, restored.selections, undefined);
        pendingRestoredSelections.clear();
    });

    // The active editor did not change (otherwise `editor.activeEditorChanged` would arrive): update only the cache.
    rpc.handleNotification("editor.selectionChanged", (params) => {
        const p: { uri?: unknown; selections?: unknown; groupId?: unknown; kind?: unknown } = params;
        if (typeof p.uri !== "string") return;
        const selections = parseWireSelections(p.selections);
        const groupId = typeof p.groupId === "number" ? p.groupId : effectiveActiveGroupId();
        selectionsByEditor.set(selectionKey(groupId, p.uri), selections);
        if (p.uri === activeEditorUri) activeSelections = selections;
        // The cache is updated BEFORE dispatch: listeners read `editor.selections`.
        fireSelectionChanged(p.uri, groupId, selections, parseWireSelectionChangeKind(p.kind));
    });

    // Fire on EVERY message, even when the kind stays the same (Dark+ → Abyss): upstream
    // documents the event as "the theme changed OR was modified".
    rpc.handleNotification("window.themeChanged", (params) => {
        const parsed = parseWireColorTheme(params);
        if (parsed === null) return;
        activeColorTheme = { kind: parsed.kind };
        for (const listener of [...colorThemeListeners]) listener(activeColorTheme);
    });

    rpc.handleNotification("editor.layoutChanged", (params) => {
        const parsed = parseWireEditorLayout(params);
        if (parsed === null) return;
        const previous = layout;
        layout = parsed;
        applyLayoutDiff(previous, parsed);
    });

    function tabKeys(
        snapshot: IWireEditorLayout,
    ): Map<string, { group: IWireTabGroupSnapshot; tab: IWireTabSnapshot }> {
        const keys = new Map<string, { group: IWireTabGroupSnapshot; tab: IWireTabSnapshot }>();
        for (const group of snapshot.groups) {
            for (const tab of group.tabs) {
                keys.set(selectionKey(group.groupId, tab.uri), { group, tab });
            }
        }
        return keys;
    }

    function visiblePairs(snapshot: IWireEditorLayout): string[] {
        return visibleDocuments(snapshot).map(({ groupId, uri }) => selectionKey(groupId, uri));
    }

    /** Upstream treats a diff as two editors: a diff tab yields the documents of both sides. */
    function visibleDocuments(snapshot: IWireEditorLayout): { groupId: number; uri: string }[] {
        const visible: { groupId: number; uri: string }[] = [];
        for (const group of snapshot.groups) {
            const active = group.tabs.find((tab) => tab.isActive);
            if (active?.kind === "text") visible.push({ groupId: group.groupId, uri: active.uri });
            if (active?.kind === "diff") {
                for (const uri of active.sideEditors ?? []) visible.push({ groupId: group.groupId, uri });
            }
        }
        return visible;
    }

    function applyLayoutDiff(previous: IWireEditorLayout, next: IWireEditorLayout): void {
        const prevTabs = tabKeys(previous);
        const nextTabs = tabKeys(next);

        for (const group of next.groups) {
            for (const tab of group.tabs) {
                if (tab.selections !== undefined) {
                    selectionsByEditor.set(selectionKey(group.groupId, tab.uri), tab.selections);
                }
            }
        }

        // A stale extension reference to an editor of a dead group gets viewColumn === undefined, not a TypeError.
        const aliveGroups = new Set(next.groups.map((group) => group.groupId));
        for (const [groupId, editors] of [...editorCache]) {
            if (!aliveGroups.has(groupId)) {
                editorCache.delete(groupId);
                continue;
            }
            for (const uri of [...editors.keys()]) {
                if (!nextTabs.has(selectionKey(groupId, uri))) editors.delete(uri);
            }
        }
        for (const key of [...selectionsByEditor.keys()]) {
            if (!nextTabs.has(key)) selectionsByEditor.delete(key);
        }

        const prevGroups = new Map(previous.groups.map((group) => [group.groupId, group]));
        const openedGroups = next.groups.filter((group) => !prevGroups.has(group.groupId));
        const closedGroups = previous.groups.filter((group) => !aliveGroups.has(group.groupId));
        const changedGroups = next.groups.filter((group) => {
            const before = prevGroups.get(group.groupId);
            return (
                before !== undefined && (before.isActive !== group.isActive || before.viewColumn !== group.viewColumn)
            );
        });
        if (openedGroups.length > 0 || closedGroups.length > 0 || changedGroups.length > 0) {
            const event: vscode.TabGroupChangeEvent = {
                opened: openedGroups.map(makeTabGroup),
                closed: closedGroups.map(makeTabGroup),
                changed: changedGroups.map(makeTabGroup),
            };
            for (const listener of [...tabGroupsListeners]) listener(event);
        }

        const openedTabs: vscode.Tab[] = [];
        const closedTabs: vscode.Tab[] = [];
        const changedTabs: vscode.Tab[] = [];
        for (const [key, { group, tab }] of nextTabs) {
            const before = prevTabs.get(key);
            if (before === undefined) openedTabs.push(makeTab(group, tab));
            else if (
                before.tab.isActive !== tab.isActive ||
                before.tab.isDirty !== tab.isDirty ||
                before.tab.label !== tab.label
            ) {
                changedTabs.push(makeTab(group, tab));
            }
        }
        for (const [key, { group, tab }] of prevTabs) {
            if (!nextTabs.has(key)) closedTabs.push(makeTab(group, tab));
        }
        if (openedTabs.length > 0 || closedTabs.length > 0 || changedTabs.length > 0) {
            const event: vscode.TabChangeEvent = {
                opened: openedTabs,
                closed: closedTabs,
                changed: changedTabs,
            };
            for (const listener of [...tabsListeners]) listener(event);
        }

        const prevVisible = visiblePairs(previous);
        const nextVisible = visiblePairs(next);
        if (prevVisible.length !== nextVisible.length || prevVisible.some((pair, i) => pair !== nextVisible[i])) {
            const editors = windowNs.visibleTextEditors;
            for (const listener of [...visibleEditorsListeners]) listener(editors);
        }
        announceRestoredSelections(previous, next);

        for (const group of next.groups) {
            const before = prevGroups.get(group.groupId);
            if (before === undefined || before.viewColumn === group.viewColumn) continue;
            const editors = editorCache.get(group.groupId);
            if (editors === undefined) continue;
            for (const editor of editors.values()) {
                const event: vscode.TextEditorViewColumnChangeEvent = {
                    textEditor: editor,
                    viewColumn: group.viewColumn,
                };
                for (const listener of [...viewColumnListeners]) listener(event);
            }
        }
    }

    function getEditorFor(doc: ExtHostTextDocument, groupId: number): vscode.TextEditor {
        let groupEditors = editorCache.get(groupId);
        if (groupEditors === undefined) {
            groupEditors = new Map();
            editorCache.set(groupId, groupEditors);
        }
        const key = doc.uri.toString();
        const cached = groupEditors.get(key);
        if (cached !== undefined) return cached;
        const editor = makeEditorProxy(doc, groupId);
        groupEditors.set(key, editor);
        return editor;
    }

    /** A non-text tab or a diff without resource sides gives `undefined`, like vscode's `TabInputUnknown`. */
    function tabInputOf(tab: IWireTabSnapshot): TabInputText | TabInputTextDiff | undefined {
        if (tab.kind === "text") return new TabInputText(Uri.parse(tab.uri));
        if (tab.kind === "diff" && tab.original !== undefined && tab.modified !== undefined) {
            return new TabInputTextDiff(Uri.parse(tab.original), Uri.parse(tab.modified));
        }
        return undefined;
    }

    /** Kept outside `Tab` so the extension does not see internal fields. */
    const tabAddress = new WeakMap<vscode.Tab, { groupId: number; uri: string }>();

    function makeTab(group: IWireTabGroupSnapshot, tab: IWireTabSnapshot): vscode.Tab {
        return makeTabGroup(group).tabs[group.tabs.indexOf(tab)];
    }

    function makeTabGroup(group: IWireTabGroupSnapshot): vscode.TabGroup {
        const tabs = group.tabs.map((tab) => makeTabOnly(group, tab, () => tabGroup));
        const tabGroup: vscode.TabGroup = {
            isActive: group.isActive,
            viewColumn: group.viewColumn,
            activeTab: tabs.find((tab) => tab.isActive),
            tabs,
        };
        return tabGroup;
    }

    /** Lazy `group` back-reference, as in upstream `extHostEditorTabs`. */
    function makeTabOnly(
        group: IWireTabGroupSnapshot,
        tab: IWireTabSnapshot,
        owner: () => vscode.TabGroup,
    ): vscode.Tab {
        const result: vscode.Tab = {
            label: tab.label,
            input: tabInputOf(tab),
            isActive: tab.isActive,
            isDirty: tab.isDirty,
            isPinned: false,
            isPreview: false,
            get group() {
                return owner();
            },
        };
        tabAddress.set(result, { groupId: group.groupId, uri: tab.uri });
        return result;
    }

    function editorSelections(groupId: number, uri: string): readonly IWireSelection[] {
        if (uri === activeEditorUri && groupId === effectiveActiveGroupId()) return activeSelections;
        return selectionsByEditor.get(selectionKey(groupId, uri)) ?? [];
    }

    function pushSelections(
        document: ExtHostTextDocument,
        groupId: number,
        selections: readonly vscode.Selection[],
    ): void {
        const wire = selections.map(toWireSelection);
        if (wire.length === 0) return;
        selectionsByEditor.set(selectionKey(groupId, document.uri.toString()), wire);
        if (document.uri.toString() === activeEditorUri && groupId === effectiveActiveGroupId()) {
            activeSelections = wire;
        }
        rpc.notify("editor.setSelection", { uri: document.uri.toString(), selections: wire, groupId });
    }

    function makeEditorProxy(document: ExtHostTextDocument, groupId: number): vscode.TextEditor {
        const primarySelection = (): vscode.Selection => {
            const primary = editorSelections(groupId, document.uri.toString()).at(0);
            if (primary === undefined) {
                return new Selection(new Position(0, 0), new Position(0, 0));
            }
            return toVscodeSelection(primary);
        };
        // A closed tab drops the editor from the cache; a reopened one is another object, as upstream.
        const isEditorClosed = (): boolean =>
            document.isClosed || editorCache.get(groupId)?.get(document.uri.toString()) !== editorProxy;
        let storedOptions: vscode.TextEditorOptions = {};
        /** Lives with this object: a closed tab drops it from the cache, so a reopened one starts clean. */
        let cursorStyleOverride: vscode.TextEditorCursorStyle | undefined;
        // Upstream resolves the style from the code editor; unset in Diode means the terminal's own shape.
        const effectiveCursorStyle = (): vscode.TextEditorCursorStyle | undefined =>
            cursorStyleOverride ??
            cursorStyleToApi(ctx.configStore.get("editor.cursorStyle", undefined, document.languageId));
        const editorData: vscode.TextEditor = {
            get options(): vscode.TextEditorOptions {
                const cursorStyle = effectiveCursorStyle();
                return cursorStyle === undefined ? { ...storedOptions } : { ...storedOptions, cursorStyle };
            },
            document,
            /** Read from the current snapshot: renumbering does not break the object (AS-9). */
            get viewColumn(): number | undefined {
                return layoutGroup(groupId)?.viewColumn;
            },
            get selection(): vscode.Selection {
                return primarySelection();
            },
            set selection(value: vscode.Selection) {
                pushSelections(document, groupId, [value]);
            },
            get selections(): readonly vscode.Selection[] {
                const all = editorSelections(groupId, document.uri.toString());
                if (all.length === 0) return [primarySelection()];
                return all.map(toVscodeSelection);
            },
            set selections(value: readonly vscode.Selection[]) {
                pushSelections(document, groupId, value);
            },
            edit: (
                callback: (editBuilder: vscode.TextEditorEdit) => void,
                options?: { undoStopBefore: boolean; undoStopAfter: boolean },
            ): Thenable<boolean> =>
                applyTextEditorEdit(document, isEditorClosed(), callback, options, (params) =>
                    rpc.request("editor.applyEdit", params),
                ),
            setDecorations: (
                decorationType: vscode.TextEditorDecorationType,
                rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
            ): void => {
                const key = decorationTypeKeys.get(decorationType);
                if (key === undefined) return;
                rpc.notify("editor.setDecorations", {
                    key,
                    uri: document.uri.toString(),
                    ranges: normalizeDecorationRanges(rangesOrOptions),
                    groupId,
                });
            },
        };
        const editorProxy: vscode.TextEditor = new Proxy(editorData, {
            set: (target, prop, value): boolean => {
                if (prop === "options") {
                    if (typeof value !== "object" || value === null) return false;
                    const patch = value as vscode.TextEditorOptions & { indentSize?: number | string };
                    const normalized: {
                        tabSize?: number;
                        insertSpaces?: boolean;
                        indentSize?: number;
                        cursorStyle?: number;
                    } = {};
                    if (patch.tabSize !== undefined) {
                        normalized.tabSize = normalizeTabSize(patch.tabSize);
                    }
                    if (patch.insertSpaces !== undefined) {
                        normalized.insertSpaces = normalizeInsertSpaces(patch.insertSpaces);
                    }
                    if (patch.indentSize !== undefined) {
                        const indentSize = normalizeIndentSize(patch.indentSize);
                        if (indentSize !== undefined) normalized.indentSize = indentSize;
                    }
                    // As upstream `_setOptions`: only a change goes out, so a read-modify-write of
                    // `options` for `tabSize` does not pin the configured style as an override.
                    if (
                        cursorStyleFromApi(patch.cursorStyle) !== undefined &&
                        patch.cursorStyle !== effectiveCursorStyle()
                    ) {
                        cursorStyleOverride = patch.cursorStyle;
                        normalized.cursorStyle = patch.cursorStyle;
                    }
                    storedOptions = { ...storedOptions, ...patch };
                    delete storedOptions.cursorStyle;
                    if (Object.keys(normalized).length > 0) {
                        void rpc.request("editor.setOptions", {
                            ...normalized,
                            uri: document.uri.toString(),
                            groupId,
                        });
                    }
                    return true;
                }
                if (prop === "selection") {
                    target.selection = value as vscode.Selection;
                    return true;
                }
                if (prop === "selections") {
                    target.selections = value as readonly vscode.Selection[];
                    return true;
                }
                return false;
            },
        });
        return editorProxy;
    }

    // A uri without a decoration is sent bare, so the host clears it from the file. `undefined` (all
    // files) is not expanded: the subprocess has no list of all uris.
    async function pushFileDecorations(
        provider: vscode.FileDecorationProvider,
        changed: undefined | vscode.Uri | vscode.Uri[],
    ): Promise<void> {
        const uris = normalizeChangedUris(changed);
        if (uris.length === 0) return;
        const decorations: IWireFileDecoration[] = [];
        for (const uri of uris) {
            const decoration = await provider.provideFileDecoration(uri, NEVER_CANCELLED);
            const entry: IWireFileDecoration = {
                uri: uri.toString(),
                ...(decoration?.badge !== undefined ? { badge: decoration.badge } : {}),
                ...(decoration?.color !== undefined ? { colorId: decoration.color.id } : {}),
                ...(decoration?.propagate !== undefined ? { propagate: decoration.propagate } : {}),
            };
            decorations.push(entry);
        }
        rpc.notify("window.fileDecorationsChanged", { decorations });
    }

    // Nothing goes over the wire until the item is shown: in VS Code `createStatusBarItem` does NOT show
    // the item. Deviations: `tooltip` is not shown; colors and `accessibilityInformation` have no effect.
    const createStatusBarItem = (
        idOrAlignment?: string | vscode.StatusBarAlignment,
        alignmentOrPriority?: vscode.StatusBarAlignment | number,
        priorityArg?: number,
    ): vscode.StatusBarItem => {
        const withId = typeof idOrAlignment === "string";
        const explicitId = withId ? idOrAlignment : undefined;
        const alignment = (withId ? alignmentOrPriority : idOrAlignment) as vscode.StatusBarAlignment | undefined;
        const priority = withId ? priorityArg : alignmentOrPriority;
        const handle = nextStatusBarItemHandle++;
        // Nominally different enums with the same values: compare as numbers.
        const side: "left" | "right" =
            (alignment as number | undefined) === (StatusBarAlignment.Right as number) ? "right" : "left";

        let text = "";
        let name: string | undefined;
        let command: string | vscode.Command | undefined;
        let visible = false;
        let disposed = false;

        /**
         * The id derives from the name so that hiding the item survives a restart. The owner (`<owner>.<id>`,
         * as `asStatusBarItemIdentifier`) is captured here: it is gone by the time of `name =`.
         */
        const fallbackId = `item-${String(handle)}`;
        const prefix = owner.current === undefined ? "" : `${owner.current}.`;
        const currentId = (): string =>
            prefix + (explicitId ?? (name !== undefined ? slugify(name, fallbackId) : fallbackId));

        const commandWire = (): { command?: string; arguments?: readonly unknown[] } => {
            if (typeof command === "string") return { command };
            if (command === undefined) return {};
            return {
                command: command.command,
                ...(Array.isArray(command.arguments) ? { arguments: command.arguments } : {}),
            };
        };

        const push = (): void => {
            if (disposed || !visible) return;
            rpc.notify("window.statusBarItem.update", {
                handle,
                id: currentId(),
                alignment: side,
                ...(Number.isFinite(priority) ? { priority } : {}),
                text,
                ...(name !== undefined ? { name } : {}),
                ...commandWire(),
            });
        };

        const unpush = (): void => {
            if (!visible) return;
            visible = false;
            rpc.notify("window.statusBarItem.dispose", { handle });
        };

        const item: vscode.StatusBarItem = {
            get id(): string {
                return currentId();
            },
            get alignment(): vscode.StatusBarAlignment {
                return alignment ?? StatusBarAlignment.Left;
            },
            get priority(): number | undefined {
                return priority;
            },
            get name(): string | undefined {
                return name;
            },
            set name(value: string | undefined) {
                name = value;
                push();
            },
            get text(): string {
                return text;
            },
            set text(value: string) {
                text = value;
                push();
            },
            get command(): string | vscode.Command | undefined {
                return command;
            },
            set command(value: string | vscode.Command | undefined) {
                command = value;
                push();
            },
            // Read back but do not affect the bar: that needs a hover widget and theme tokens.
            tooltip: undefined,
            color: undefined,
            backgroundColor: undefined,
            accessibilityInformation: undefined,
            show: (): void => {
                if (disposed || visible) return;
                visible = true;
                push();
            },
            // No `disposed` check needed: `unpush` is silent on a hidden item, and `show`/`push` are inert after dispose.
            hide: (): void => {
                unpush();
            },
            dispose: (): void => {
                unpush();
                disposed = true;
            },
        };
        return item;
    };

    const windowNs = {
        // There are no webviews, but without these members an extension with a chat panel failed activation entirely.
        ...createWebviewNoopMembers(rpc),
        registerTreeDataProvider: treeViews.registerTreeDataProvider,
        createTreeView: treeViews.createTreeView,

        createStatusBarItem,
        // The message item has no owner: its id has no extension prefix.
        setStatusBarMessage: createStatusBarMessage(() =>
            owner.runAs(undefined, () =>
                createStatusBarItem("status.extensionMessage", StatusBarAlignment.Left, Number.MIN_VALUE),
            ),
        ),

        get activeTextEditor(): vscode.TextEditor | undefined {
            if (activeEditorUri === null) return undefined;
            return getEditorFor(registry.getOrCreate(Uri.parse(activeEditorUri)), effectiveActiveGroupId());
        },

        // An empty snapshot (before the first layoutChanged) degrades to "active editor only".
        get visibleTextEditors(): readonly vscode.TextEditor[] {
            if (layout.groups.length === 0) {
                if (activeEditorUri === null) return [];
                return [getEditorFor(registry.getOrCreate(Uri.parse(activeEditorUri)), effectiveActiveGroupId())];
            }
            return visibleDocuments(layout).map(({ groupId, uri }) =>
                getEditorFor(registry.getOrCreate(Uri.parse(uri)), groupId),
            );
        },

        state: { focused: true, active: true },

        onDidChangeActiveTextEditor: (
            listener: (e: vscode.TextEditor | undefined) => unknown,
            thisArgs?: unknown,
            disposables?: vscode.Disposable[],
        ): vscode.Disposable => {
            const bound: (e: vscode.TextEditor | undefined) => unknown =
                thisArgs != null ? (e) => listener.call(thisArgs, e) : listener;
            activeEditorListeners.push(bound);
            const disposable = new DisposableImpl(() => {
                const idx = activeEditorListeners.indexOf(bound);
                if (idx >= 0) activeEditorListeners.splice(idx, 1);
            });
            if (disposables !== undefined) disposables.push(disposable);
            return disposable;
        },

        // A selection set by the extension itself is not echoed back: the echo guard lives on the host side.
        onDidChangeTextEditorSelection: makeListenerEvent(selectionListeners),

        get activeColorTheme(): vscode.ColorTheme {
            return activeColorTheme;
        },
        onDidChangeActiveColorTheme: makeListenerEvent(colorThemeListeners),

        onDidChangeWindowState: (
            _listener: (e: vscode.WindowState) => unknown,
            _thisArgs?: unknown,
            disposables?: vscode.Disposable[],
        ): vscode.Disposable => {
            const disposable = new DisposableImpl(() => undefined);
            if (disposables !== undefined) disposables.push(disposable);
            return disposable;
        },

        // Cast to the d.ts overloads: one implementation serves all four.
        showErrorMessage: messages.showErrorMessage as typeof vscode.window.showErrorMessage,
        showWarningMessage: messages.showWarningMessage as typeof vscode.window.showWarningMessage,
        showInformationMessage: messages.showInformationMessage as typeof vscode.window.showInformationMessage,

        createTextEditorDecorationType: (options: vscode.DecorationRenderOptions): vscode.TextEditorDecorationType => {
            const key = nextDecorationKey++;
            const type: vscode.TextEditorDecorationType = {
                key: String(key),
                dispose: (): void => {
                    rpc.notify("window.disposeTextEditorDecorationType", { key });
                },
            };
            decorationTypeKeys.set(type, key);
            rpc.notify("window.createTextEditorDecorationType", {
                key,
                options: serializeDecorationRenderOptions(options),
            });
            return type;
        },

        registerFileDecorationProvider: (provider: vscode.FileDecorationProvider): vscode.Disposable => {
            const changeEvent = provider.onDidChangeFileDecorations;
            if (changeEvent === undefined) {
                return new DisposableImpl(() => undefined);
            }
            return changeEvent((changed) => {
                void pushFileDecorations(provider, changed);
            });
        },

        // Getters, not copies: the list and the active terminal stay live.
        createTerminal: terminals.createTerminal.bind(terminals) as typeof vscode.window.createTerminal,
        get terminals(): readonly vscode.Terminal[] {
            return terminals.terminals;
        },
        get activeTerminal(): vscode.Terminal | undefined {
            return terminals.activeTerminal;
        },
        onDidOpenTerminal: terminals.onDidOpenTerminal,
        onDidCloseTerminal: terminals.onDidCloseTerminal,
        onDidChangeActiveTerminal: terminals.onDidChangeActiveTerminal,
        // No shell integration, so these events never fire: after a 3 s wait Claude Code
        // falls back to `sendText`.
        onDidChangeTerminalShellIntegration: new EventEmitter<vscode.TerminalShellIntegrationChangeEvent>().event,
        onDidStartTerminalShellExecution: new EventEmitter<vscode.TerminalShellExecutionStartEvent>().event,
        onDidEndTerminalShellExecution: new EventEmitter<vscode.TerminalShellExecutionEndEvent>().event,

        registerUriHandler: createUriHandlers(rpc, owner),

        // vscode-languageclient reports errors ONLY here, so the channel must be real.
        // id `extensions.<owner>.<slug>`: same-named channels of different extensions and host loggers do not collide.
        createOutputChannel: (name: string): vscode.OutputChannel => {
            const prefix = owner.current === undefined ? "extensions." : `extensions.${owner.current}.`;
            const channel = prefix + slugifyChannelName(name);
            const send = (level: WireOutputLevel, value: string): void => {
                rpc.notify("output.append", { channel, label: name, level, value });
            };
            const logEntry =
                (level: WireOutputLevel) =>
                (value: unknown): void => {
                    send(level, typeof value === "string" ? value : JSON.stringify(value));
                };
            // append without a newline is buffered until `\n`: the panel is line-based.
            let pending = "";
            const flushPending = (): void => {
                if (pending === "") return;
                const value = pending;
                pending = "";
                send("info", value);
            };
            // The `{ log: true }` d.ts overload is not implemented, but extensions call `channel.info(...)` on a plain channel too.
            const logChannelExtras = {
                logLevel: 3, // vscode.LogLevel.Info
                onDidChangeLogLevel: new EventEmitter<never>().event,
                trace: logEntry("trace"),
                debug: logEntry("debug"),
                info: logEntry("info"),
                warn: logEntry("warn"),
                error: logEntry("error"),
            };
            return {
                name,
                append: (value: string) => {
                    pending += value;
                    let nl = pending.indexOf("\n");
                    while (nl !== -1) {
                        send("info", pending.slice(0, nl));
                        pending = pending.slice(nl + 1);
                        nl = pending.indexOf("\n");
                    }
                },
                appendLine: (value: string) => {
                    flushPending();
                    send("info", value);
                },
                replace: () => {
                    /* no-op: the log is append-only */
                },
                clear: () => {
                    /* no-op: the log is append-only */
                },
                show: () => {
                    rpc.notify("output.show", { channel, label: name });
                },
                hide: () => {
                    /* no-op */
                },
                dispose: () => {
                    flushPending();
                },
                ...logChannelExtras,
            };
        },

        onDidChangeVisibleTextEditors: makeListenerEvent(visibleEditorsListeners),
        onDidChangeTextEditorViewColumn: makeListenerEvent(viewColumnListeners),

        // Tab object identity across snapshots is not guaranteed; extensions
        // compare by `input.uri` (deliberate deviation).
        tabGroups: {
            get all(): readonly vscode.TabGroup[] {
                return layout.groups.map(makeTabGroup);
            },
            get activeTabGroup(): vscode.TabGroup {
                const active = layout.groups.find((group) => group.isActive) ?? layout.groups.at(0);
                if (active === undefined) {
                    return {
                        isActive: true,
                        viewColumn: 1,
                        activeTab: undefined,
                        tabs: [],
                    };
                }
                return makeTabGroup(active);
            },
            onDidChangeTabs: makeListenerEvent(tabsListeners),
            onDidChangeTabGroups: makeListenerEvent(tabGroupsListeners),
            close: (
                tabOrTabs: vscode.Tab | readonly vscode.Tab[] | vscode.TabGroup | readonly vscode.TabGroup[],
                _preserveFocus?: boolean,
            ): Thenable<boolean> => {
                const items = Array.isArray(tabOrTabs) ? tabOrTabs : [tabOrTabs];
                if (items.length === 0) return Promise.resolve(true);
                if (tabAddress.has(items[0] as vscode.Tab)) {
                    const tabs = (items as vscode.Tab[]).flatMap((tab) => tabAddress.get(tab) ?? []);
                    return rpc.request("editor.closeTabs", { tabs });
                }
                const groupIds = (items as vscode.TabGroup[]).map((group) => {
                    // vscode.TabGroup.viewColumn is the ViewColumn enum, the same value as a number.
                    const column: number = group.viewColumn;
                    const snapshot = layout.groups.find((g) => g.viewColumn === column);
                    return snapshot?.groupId ?? -1;
                });
                return rpc.request("editor.closeGroups", { groupIds });
            },
        } satisfies vscode.TabGroups,

        showInputBox: (
            options?: vscode.InputBoxOptions,
            token?: vscode.CancellationToken,
        ): Thenable<string | undefined> => quickInput.showInputBox(options, token),
        // Cast to the four d.ts overloads: the implementation picks the result shape by `canPickMany`.
        showQuickPick: quickInput.showQuickPick as typeof vscode.window.showQuickPick,
        // Upstream `_workbench.pickWorkspaceFolder`: a single folder is still offered, no folder means no picker.
        showWorkspaceFolderPick: async (
            options?: vscode.WorkspaceFolderPickOptions,
        ): Promise<vscode.WorkspaceFolder | undefined> => {
            const folders = getWorkspaceFolders();
            if (folders === undefined || folders.length === 0) return undefined;
            const picks = folders.map((folder) => ({
                label: folder.name,
                description: nodePath.dirname(folder.uri.fsPath),
                folder,
            }));
            const pick = await quickInput.showQuickPick(picks, {
                placeHolder: options?.placeHolder ?? "Select workspace folder",
            });
            return (pick as (typeof picks)[number] | undefined)?.folder;
        },
        createQuickPick: <T extends vscode.QuickPickItem>(): vscode.QuickPick<T> => quickInput.createQuickPick<T>(),
        showOpenDialog: async (options?: vscode.OpenDialogOptions): Promise<vscode.Uri[] | undefined> => {
            const result = parseWireOpenDialogResult(
                await rpc.request("window.showOpenDialog", {
                    defaultUri: options?.defaultUri?.toString(),
                    openLabel: options?.openLabel,
                    canSelectFiles: options?.canSelectFiles,
                    canSelectFolders: options?.canSelectFolders,
                    canSelectMany: options?.canSelectMany,
                    filters: toWireDialogFilters(options?.filters),
                    title: options?.title,
                }),
            );
            return result.uris?.map((uri) => Uri.parse(uri));
        },
        showSaveDialog: async (options?: vscode.SaveDialogOptions): Promise<vscode.Uri | undefined> => {
            const result = parseWireSaveDialogResult(
                await rpc.request("window.showSaveDialog", {
                    defaultUri: options?.defaultUri?.toString(),
                    saveLabel: options?.saveLabel,
                    filters: toWireDialogFilters(options?.filters),
                    title: options?.title,
                }),
            );
            return result.uri === null ? undefined : Uri.parse(result.uri);
        },

        // By the time this resolves, `editor.layoutChanged` is already applied: the host flushes it before replying.
        showTextDocument: (
            documentOrUri: vscode.TextDocument | vscode.Uri,
            columnOrOptions?: vscode.ViewColumn | vscode.TextDocumentShowOptions,
            preserveFocus?: boolean,
        ): Thenable<vscode.TextEditor> => {
            const uri = documentOrUri instanceof Uri ? documentOrUri : (documentOrUri as vscode.TextDocument).uri;
            const options: vscode.TextDocumentShowOptions =
                typeof columnOrOptions === "number"
                    ? { viewColumn: columnOrOptions, preserveFocus }
                    : (columnOrOptions ?? {});
            const selection = options.selection;
            const params = {
                uri: uri.toString(),
                ...(options.viewColumn !== undefined ? { viewColumn: options.viewColumn } : {}),
                ...(options.preserveFocus !== undefined ? { preserveFocus: options.preserveFocus } : {}),
                ...(selection !== undefined
                    ? {
                          selection: {
                              anchorLine: selection.start.line,
                              anchorCharacter: selection.start.character,
                              activeLine: selection.end.line,
                              activeCharacter: selection.end.character,
                          },
                      }
                    : {}),
            };
            const shown: Promise<IWireShowTextDocumentResult | null | undefined> = rpc.request(
                "editor.showTextDocument",
                params,
            );
            return shown.then((result) => {
                // Harnesses with a stub RPC answer undefined; `getEditorFor` memoizes by
                // (group, uri), so this is the same object as `activeTextEditor`.
                if (result === null || typeof result !== "object") {
                    return getEditorFor(registry.getOrCreate(uri), effectiveActiveGroupId());
                }
                return getEditorFor(registry.getOrCreate(Uri.parse(result.uri)), result.groupId);
            });
        },
        // Location is ignored (in a TUI everything is Window); the token never fires, which
        // languageclient's ProgressPart tolerates.
        withProgress: <R>(
            options: vscode.ProgressOptions,
            task: (
                progress: vscode.Progress<{ message?: string; increment?: number }>,
                token: vscode.CancellationToken,
            ) => Thenable<R>,
        ): Thenable<R> => {
            const handle = nextProgressHandle++;
            const token: vscode.CancellationToken = {
                isCancellationRequested: false,
                onCancellationRequested: new EventEmitter<never>().event,
            };
            rpc.notify("window.progress.start", { handle, title: options.title ?? "" });
            const progress: vscode.Progress<{ message?: string; increment?: number }> = {
                report: (value: unknown) => {
                    const v = (typeof value === "object" && value !== null ? value : {}) as {
                        message?: unknown;
                        increment?: unknown;
                    };
                    rpc.notify("window.progress.report", {
                        handle,
                        ...(typeof v.message === "string" ? { message: v.message } : {}),
                        ...(typeof v.increment === "number" && Number.isFinite(v.increment)
                            ? { increment: v.increment }
                            : {}),
                    });
                },
            };
            const done = (): void => {
                rpc.notify("window.progress.end", { handle });
            };
            return Promise.resolve(task(progress, token)).then(
                (result) => {
                    done();
                    return result;
                },
                (err: unknown) => {
                    done();
                    throw err;
                },
            );
        },
    };

    return implementsApi<typeof vscode.window>()(windowNs);
}

function normalizeTabSize(value: number | string): number {
    if (typeof value === "number") return Math.max(1, Math.floor(value));
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 4 : Math.max(1, parsed);
}

function normalizeInsertSpaces(value: boolean | string): boolean {
    if (typeof value === "boolean") return value;
    if (value === "auto") return true;
    return value === "true";
}

/** `indentSize` is either a number or `"tabSize"` (same as tabSize, so skipped). */
function normalizeIndentSize(value: number | string): number | undefined {
    if (typeof value === "number") return Math.max(1, Math.floor(value));
    if (value === "tabSize") return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : Math.max(1, parsed);
}

function toWireDialogFilters(filters: Readonly<Record<string, string[]>> | undefined): IWireDialogFilter[] | undefined {
    if (filters === undefined) return undefined;
    return Object.entries(filters).map(([name, extensions]) => ({ name, extensions }));
}

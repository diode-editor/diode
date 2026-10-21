import type * as vscode from "vscode";

import { implementsApi } from "./apiSurface.ts";
import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import {
    normalizeDecorationRanges,
    serializeDecorationRenderOptions,
    toVscodeSelection,
    toWireEditRange,
    toWireSelection,
} from "./extHostTypeConverters.ts";
import { createMessageApi } from "./messageNamespace.ts";
import { createQuickInputApi } from "./quickInputNamespace.ts";
import { createStatusBarMessage } from "./statusBarMessage.ts";
import { createTerminalNamespace, type ITerminalNamespace } from "./terminalNamespace.ts";
import { createTreeViewNoopMembers } from "./treeViewNoop.ts";
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
    /* v8 ignore next -- defensive stub: host-мост никогда не отменяет provideFileDecoration, слушатель не вызывается */
    onCancellationRequested: () => new DisposableImpl(() => undefined),
};

function normalizeChangedUris(changed: undefined | vscode.Uri | vscode.Uri[]): vscode.Uri[] {
    if (changed === undefined) return [];
    return Array.isArray(changed) ? changed : [changed];
}

/** Одна пустая каретка в начале документа — выделение свежей модели (1:1 эталона). */
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

/** `terminals` передают, когда терминалы с `window` делит `vscode.tasks` (pty `CustomExecution`). */
export function createWindowNamespace(
    ctx: IVscodeHostContext,
    terminals: ITerminalNamespace = createTerminalNamespace(ctx.rpc),
): typeof vscode.window {
    const { rpc, registry, owner } = ctx;

    const quickInput = createQuickInputApi(rpc);
    const messages = createMessageApi(rpc);

    let activeEditorUri: string | null = null;
    /** null — до первой меты с группой. */
    let activeEditorGroupId: number | null = null;
    let nextProgressHandle = 1;
    let nextStatusBarItemHandle = 1;
    let activeSelections: readonly IWireSelection[] = [];
    /** Единственный источник `visibleTextEditors`/`tabGroups`/`viewColumn`: события API производит дифф снимков. */
    let layout: IWireEditorLayout = { groups: [] };
    const selectionsByEditor = new Map<string, readonly IWireSelection[]>();
    /** Их событие выделения ждёт `editor.activeEditorChanged` (см. {@link announceRestoredSelections}). */
    const pendingRestoredSelections = new Map<
        string,
        { readonly uri: string; readonly groupId: number; readonly selections: readonly IWireSelection[] }
    >();
    /**
     * Ключ — groupId, не viewColumn: колонка пересчитывается при схлопывании, а
     * редактор обязан пережить перенумерацию (AS-9). Один файл в двух группах — два редактора (AS-7).
     */
    const editorCache = new Map<number, Map<string, vscode.TextEditor>>();
    const activeEditorListeners: ((editor: vscode.TextEditor | undefined) => void)[] = [];
    const visibleEditorsListeners: ((editors: readonly vscode.TextEditor[]) => void)[] = [];
    const viewColumnListeners: ((e: vscode.TextEditorViewColumnChangeEvent) => void)[] = [];
    const tabsListeners: ((e: vscode.TabChangeEvent) => void)[] = [];
    const tabGroupsListeners: ((e: vscode.TabGroupChangeEvent) => void)[] = [];
    const selectionListeners: ((e: vscode.TextEditorSelectionChangeEvent) => void)[] = [];
    const colorThemeListeners: ((e: vscode.ColorTheme) => void)[] = [];
    /** Семя Dark — дефолт VS Code: до первой `window.themeChanged` `activeColorTheme.kind` читают без проверок. */
    let activeColorTheme: vscode.ColorTheme = { kind: ColorThemeKind.Dark };

    // Хост знает тип декорации только по числу.
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

    /** Кэш выделений к вызову уже свежий. */
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
     * Эталон шлёт `onDidChangeTextEditorSelection` вкладке, ставшей видимой с выделением
     * не в 1:1 (`restoreState` меняет 1:1 свежей модели). Редактору активной группы — после
     * `onDidChangeActiveTextEditor`: Claude Code фильтрует по `e.textEditor === activeTextEditor`.
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
        // Stryker disable next-line StringLiteral: подстановка без uri — любой не-uri ключ ни с одной вкладкой не совпадёт
        const restored = pendingRestoredSelections.get(selectionKey(effectiveActiveGroupId(), meta.uri ?? ""));
        if (restored !== undefined)
            fireSelectionChanged(restored.uri, restored.groupId, restored.selections, undefined);
        pendingRestoredSelections.clear();
    });

    // Активный редактор не сменился (иначе пришёл бы `editor.activeEditorChanged`) — обновляем только кэш.
    rpc.handleNotification("editor.selectionChanged", (params) => {
        const p: { uri?: unknown; selections?: unknown; groupId?: unknown; kind?: unknown } = params;
        if (typeof p.uri !== "string") return;
        const selections = parseWireSelections(p.selections);
        const groupId = typeof p.groupId === "number" ? p.groupId : effectiveActiveGroupId();
        selectionsByEditor.set(selectionKey(groupId, p.uri), selections);
        if (p.uri === activeEditorUri) activeSelections = selections;
        // Кэш обновлён ДО рассылки: слушатель читает `editor.selections`.
        fireSelectionChanged(p.uri, groupId, selections, parseWireSelectionChangeKind(p.kind));
    });

    // Стреляем на КАЖДОЕ сообщение, даже без смены вида (Dark+ → Abyss): upstream
    // объявляет событие как «тема сменилась ИЛИ изменилась».
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

    /** У эталона дифф — два редактора: дифф-вкладка даёт документы обеих сторон. */
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

        // Застрявшая у расширения ссылка на редактор мёртвой группы даёт viewColumn === undefined, не TypeError.
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

    /** Нетекстовая вкладка и дифф без ресурсных сторон — `undefined`, как `TabInputUnknown` у vscode. */
    function tabInputOf(tab: IWireTabSnapshot): TabInputText | TabInputTextDiff | undefined {
        if (tab.kind === "text") return new TabInputText(Uri.parse(tab.uri));
        if (tab.kind === "diff" && tab.original !== undefined && tab.modified !== undefined) {
            return new TabInputTextDiff(Uri.parse(tab.original), Uri.parse(tab.modified));
        }
        return undefined;
    }

    /** Вне `Tab`, чтобы расширение не видело служебных полей. */
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

    /** Ленивая обратная ссылка `group`, как в upstream `extHostEditorTabs`. */
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
        const editorData: vscode.TextEditor = {
            options: {},
            document,
            /** От текущего снимка: перенумерация не рвёт объект (AS-9). */
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
                _options?: { undoStopBefore: boolean; undoStopAfter: boolean },
            ): Thenable<boolean> => {
                const edits: IWireEditorEdit[] = [];
                // Правка с битым диапазоном выпадает (её отбросил бы и разбор
                // хоста); выпали все — ответ `false`, как хост ответил бы на
                // пустой батч, а не вакуумный успех пустого callback'а.
                let dropped = false;
                const push = (location: vscode.Position | vscode.Range, text: string): void => {
                    const range = toWireEditRange(location);
                    if (range === null) dropped = true;
                    else edits.push({ range, text });
                };
                const builder: vscode.TextEditorEdit = {
                    replace: (location: vscode.Position | vscode.Range | vscode.Selection, value: string) => {
                        push(location, value);
                    },
                    insert: (position: vscode.Position, value: string) => {
                        push(position, value);
                    },
                    delete: (location: vscode.Range | vscode.Selection) => {
                        push(location, "");
                    },
                    setEndOfLine: () => {
                        /* смена EOL из edit() пока не поддержана (MVP #194) */
                    },
                };
                callback(builder);
                if (edits.length === 0) return Promise.resolve(!dropped);
                return rpc.request("editor.applyEdit", {
                    uri: document.uri.toString(),
                    edits,
                });
            },
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
        return new Proxy(editorData, {
            set: (target, prop, value): boolean => {
                if (prop === "options") {
                    if (typeof value !== "object" || value === null) return false;
                    const patch = value as vscode.TextEditorOptions & { indentSize?: number | string };
                    const normalized: { tabSize?: number; insertSpaces?: boolean; indentSize?: number } = {};
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
                    target.options = { ...target.options, ...patch };
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
    }

    // uri без декорации уходит «голым» — хост снимает её с файла. `undefined` (все
    // файлы) не разворачивается: списка всех uri у субпроцесса нет.
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

    // Провод молчит, пока пункт не показан: в VS Code `createStatusBarItem` НЕ показывает
    // пункт. Отклонения: `tooltip` не показывается, цвета и `accessibilityInformation` ни на что не влияют.
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
        // Номинально разные enum'ы с одними значениями — сравниваем числами.
        const side: "left" | "right" =
            (alignment as number | undefined) === (StatusBarAlignment.Right as number) ? "right" : "left";

        let text = "";
        let name: string | undefined;
        let command: string | vscode.Command | undefined;
        let visible = false;
        let disposed = false;

        /**
         * Id из имени — чтобы скрытие пункта пережило перезапуск. Владелец (`<owner>.<id>`,
         * как `asStatusBarItemIdentifier`) фиксируется здесь: к `name =` его уже нет.
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
            // Читаются обратно, но на полосу не влияют: нужны виджет подсказки и токены темы.
            tooltip: undefined,
            color: undefined,
            backgroundColor: undefined,
            accessibilityInformation: undefined,
            show: (): void => {
                if (disposed || visible) return;
                visible = true;
                push();
            },
            // Гейт по `disposed` не нужен: `unpush` молчит на непоказанном пункте, после dispose инертны `show`/`push`.
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
        // Webview не будет, но без этих членов расширение с чат-панелью умирало на активации целиком.
        ...createWebviewNoopMembers(rpc),
        // Деревья не рисуются, но без регистрации расширение с деревом умирало на активации.
        ...createTreeViewNoopMembers(rpc),

        createStatusBarItem,
        // Пункт сообщений ничей: id без префикса расширения.
        setStatusBarMessage: createStatusBarMessage(() =>
            owner.runAs(undefined, () =>
                createStatusBarItem("status.extensionMessage", StatusBarAlignment.Left, Number.MIN_VALUE),
            ),
        ),

        get activeTextEditor(): vscode.TextEditor | undefined {
            if (activeEditorUri === null) return undefined;
            return getEditorFor(registry.getOrCreate(Uri.parse(activeEditorUri)), effectiveActiveGroupId());
        },

        // Пустой снимок (до первого layoutChanged) деградирует в «только активный».
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

        // Выделение, поставленное самим расширением, эхом не приходит — эхо-гард на стороне хоста.
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

        // Каст к перегрузкам d.ts: одна реализация обслуживает все четыре.
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

        // Геттеры, а не копии: список и активный живые.
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
        // Shell integration нет, события не стреляют: Claude Code после 3 с ожидания
        // уходит в фоллбэк на `sendText`.
        onDidChangeTerminalShellIntegration: new EventEmitter<vscode.TerminalShellIntegrationChangeEvent>().event,
        onDidStartTerminalShellExecution: new EventEmitter<vscode.TerminalShellExecutionStartEvent>().event,
        onDidEndTerminalShellExecution: new EventEmitter<vscode.TerminalShellExecutionEndEvent>().event,

        registerUriHandler: createUriHandlers(rpc, owner),

        // Ошибки vscode-languageclient идут ТОЛЬКО сюда — канал обязан быть настоящим.
        // id `extensions.<owner>.<slug>`: одноимённые каналы расширений и логгеры хоста не сталкиваются.
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
            // append без перевода строки буферизуется до `\n` — панель строчная.
            let pending = "";
            const flushPending = (): void => {
                if (pending === "") return;
                const value = pending;
                pending = "";
                send("info", value);
            };
            // Перегрузка `{ log: true }` в d.ts не поднята, но расширения зовут `channel.info(...)` и на обычном канале.
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
                    /* no-op: журнал ретенционный */
                },
                clear: () => {
                    /* no-op: журнал ретенционный */
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

        // Идентичность Tab-объектов между снимками не гарантируется — расширения
        // сравнивают по `input.uri` (осознанное отклонение).
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
                    // У vscode.TabGroup viewColumn — enum ViewColumn, та же величина числом.
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
        // Каст к четырём перегрузкам d.ts: форму ответа реализация выбирает по `canPickMany`.
        showQuickPick: quickInput.showQuickPick as typeof vscode.window.showQuickPick,
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

        // К резолву `editor.layoutChanged` уже применён: хост флашит его перед ответом.
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
                // Харнессы со стаб-RPC отвечают undefined; `getEditorFor` мемоизирует по
                // (группа, uri), так что это тот же объект, что и `activeTextEditor`.
                if (result === null || typeof result !== "object") {
                    return getEditorFor(registry.getOrCreate(uri), effectiveActiveGroupId());
                }
                return getEditorFor(registry.getOrCreate(Uri.parse(result.uri)), result.groupId);
            });
        },
        // Location игнорируется (в TUI всё — Window); токен никогда не стреляет — ProgressPart
        // languageclient'а это переживает.
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

/** `indentSize` может быть числом либо `"tabSize"` (= совпадает с tabSize → скип). */
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

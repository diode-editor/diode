import type * as vscode from "vscode";

import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import { createQuickInputApi } from "./quickInputNamespace.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
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
    type IWireEditorEdit,
    type IWireEditorLayout,
    type IWireFileDecoration,
    type IWireSelection,
    type IWireTabGroupSnapshot,
    type IWireTabSnapshot,
    parseWireColorTheme,
    parseWireEditorLayout,
    parseWireSelectionChangeKind,
    parseWireSelections,
    serializeDecorationRenderOptions,
} from "./wireTypes.ts";

/**
 * Событие на listener-массиве (паттерн `onDidChangeActiveTextEditor`): подписка
 * с thisArgs/disposables, отписка сплайсом. Файрит {@link createWindowNamespace}
 * из layout-диффера.
 */
function makeListenerEvent<T>(listeners: ((e: T) => unknown)[]): vscode.Event<T> {
    return ((listener: (e: T) => unknown, thisArgs?: unknown, disposables?: vscode.Disposable[]): vscode.Disposable => {
        const bound: (e: T) => unknown = thisArgs != null ? (e) => listener.call(thisArgs, e) : listener;
        listeners.push(bound);
        const disposable = new DisposableImpl(() => {
            const idx = listeners.indexOf(bound);
            if (idx >= 0) listeners.splice(idx, 1);
        });
        if (disposables !== undefined) disposables.push(disposable as unknown as vscode.Disposable);
        return disposable as unknown as vscode.Disposable;
    }) as vscode.Event<T>;
}

/** Wire-форма диапазона декорации (nested `start`/`end`, совпадает с `IRange`). */
interface IWireRange {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
}

function toWireRange(range: vscode.Range): IWireRange {
    return {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
    };
}

/** Диапазоны из `setDecorations` — либо голые Range, либо DecorationOptions с `.range`. */
function normalizeDecorationRanges(
    rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
): IWireRange[] {
    return rangesOrOptions.map((item) => {
        const range = "range" in item ? item.range : item;
        return toWireRange(range);
    });
}

/** Никогда-не-отменённый токен для `provideFileDecoration` (host-мост не отменяет запросы). */
const NEVER_CANCELLED = {
    isCancellationRequested: false,
    /* v8 ignore next -- defensive stub: host-мост никогда не отменяет provideFileDecoration, слушатель не вызывается */
    onCancellationRequested: () => new DisposableImpl(() => undefined),
} as unknown as vscode.CancellationToken;

function normalizeChangedUris(changed: undefined | vscode.Uri | vscode.Uri[]): vscode.Uri[] {
    if (changed === undefined) return [];
    return Array.isArray(changed) ? changed : [changed];
}

/**
 * `vscode.window` на стороне subprocess.
 *
 * Держит активный редактор со стабильной идентичностью (кэш editor-объекта по
 * документу — editorconfig сравнивает `activeTextEditor.document === doc` по
 * ссылке), проксирует установку `editor.options` хосту через RPC и стабит
 * оконное состояние / сообщения.
 */
/**
 * Человекочитаемое имя → slug для id: lower-case, не-алфанумерика схлопывается
 * в дефис, из имени без единой латинской буквы или цифры получается `fallback`.
 */
function slugify(name: string, fallback: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    return slug === "" ? fallback : slug;
}

/**
 * Имя output-канала → slug для id (`extensions.<slug>`). Полный id без
 * extension id — у subprocess-неймспейса нет per-call контекста расширения
 * (docs/TODO/Logging.md).
 */
export function slugifyChannelName(name: string): string {
    return slugify(name, "channel");
}

export function createWindowNamespace(ctx: IVscodeHostContext): typeof vscode.window {
    const { rpc, registry } = ctx;

    // Ввод/выбор у человека: собственный модуль — у него своя проводка
    // (handle'ы показов, обратный запрос валидации, токен отмены).
    const quickInput = createQuickInputApi(rpc);

    let activeEditorUri: string | null = null;
    /** Группа активного редактора (из меты); null — до первой меты с группой. */
    let activeEditorGroupId: number | null = null;
    // Идентификаторы withProgress-жизненных-циклов (window.progress.*).
    let nextProgressHandle = 1;
    // Идентификаторы пунктов статус-бара (window.statusBarItem.*).
    let nextStatusBarItemHandle = 1;
    // Выделения активного редактора: последние из meta / `editor.selectionChanged`
    // либо выставленные самим расширением. Первое выделение — первичное
    // (`TextEditor.selection`).
    let activeSelections: readonly IWireSelection[] = [];
    /**
     * Текущий снимок полосы групп (`editor.layoutChanged`). Единственный
     * источник правды для `visibleTextEditors`/`tabGroups`/`viewColumn`:
     * subprocess диффит его с прошлым и сам производит события API.
     */
    let layout: IWireEditorLayout = { groups: [] };
    /**
     * Выделения видимых редакторов по ключу `groupId:uri` — сеются из снимков
     * (у активной вкладки каждой группы) и из `editor.selectionChanged`.
     */
    const selectionsByEditor = new Map<string, readonly IWireSelection[]>();
    /**
     * Идентичность `TextEditor` = (группа, документ): один файл в двух группах —
     * два разных редактора с одним `document` (AS-7). Ключ — groupId, не
     * viewColumn: номер колонки пересчитывается при схлопывании, а объект
     * редактора обязан пережить перенумерацию (AS-9). Прюнится по снимкам.
     */
    const editorCache = new Map<number, Map<string, vscode.TextEditor>>();
    const activeEditorListeners: ((editor: vscode.TextEditor | undefined) => void)[] = [];
    const visibleEditorsListeners: ((editors: readonly vscode.TextEditor[]) => void)[] = [];
    const viewColumnListeners: ((e: vscode.TextEditorViewColumnChangeEvent) => void)[] = [];
    const tabsListeners: ((e: vscode.TabChangeEvent) => void)[] = [];
    const tabGroupsListeners: ((e: vscode.TabGroupChangeEvent) => void)[] = [];
    const selectionListeners: ((e: vscode.TextEditorSelectionChangeEvent) => void)[] = [];
    const colorThemeListeners: ((e: vscode.ColorTheme) => void)[] = [];
    /**
     * Активная тема окна. Семя — `vscode.ColorThemeKind.Dark` (дефолт VS Code
     * без настройки): хост присылает настоящую `window.themeChanged` ещё до
     * первой активации, но пока сообщение не пришло, врать `undefined`
     * расширению нельзя — `activeColorTheme.kind` читают без проверок.
     */
    let activeColorTheme: vscode.ColorTheme = { kind: ColorThemeKind.Dark } as vscode.ColorTheme;

    // Монотонный ключ типа декорации + маппинг type-объект → числовой ключ.
    // Ключ живёт локально в субпроцессе; хост знает тип только по числу.
    let nextDecorationKey = 1;
    const decorationTypeKeys = new WeakMap<object, number>();

    function selectionKey(groupId: number, uri: string): string {
        return `${String(groupId)}:${uri}`;
    }

    /** Группа снимка по id; `null` — группы нет в текущей полосе. */
    function layoutGroup(groupId: number): IWireTabGroupSnapshot | null {
        return layout.groups.find((group) => group.groupId === groupId) ?? null;
    }

    /** Группа активного редактора: из меты либо активная группа снимка. */
    function effectiveActiveGroupId(): number {
        if (activeEditorGroupId !== null) return activeEditorGroupId;
        return layout.groups.find((group) => group.isActive)?.groupId ?? 1;
    }

    rpc.handleNotification("editor.activeEditorChanged", (params) => {
        const meta = params as {
            uri: string | null;
            languageId?: string | null;
            isDirty?: boolean;
            encoding?: string | null;
            eol?: number | null;
            selection?: IWireSelection | null;
            groupId?: number | null;
        };
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
    });

    // Каретка/выделение поехали в редакторе — обновляем только кэш выделений.
    // Слушателей активного редактора не трогаем: активный редактор не сменился
    // (иначе пришёл бы `editor.activeEditorChanged`).
    rpc.handleNotification("editor.selectionChanged", (params) => {
        const p = params as { uri?: unknown; selections?: unknown; groupId?: unknown; kind?: unknown };
        if (typeof p.uri !== "string") return;
        const selections = parseWireSelections(p.selections);
        const groupId = typeof p.groupId === "number" ? p.groupId : effectiveActiveGroupId();
        selectionsByEditor.set(selectionKey(groupId, p.uri), selections);
        if (p.uri === activeEditorUri) activeSelections = selections;
        // Кэш обновлён ДО рассылки: слушатель читает `editor.selections` и
        // обязан увидеть новое, а не то, что было до события.
        const editor = getEditorFor(registry.getOrCreate(Uri.parse(p.uri)), groupId);
        const event = {
            textEditor: editor,
            selections: selections.map(toSelection),
            // Числа провода — это и есть значения `TextEditorSelectionChangeKind`
            // (см. WireSelectionChangeKind); нераспознанный источник — `undefined`.
            kind: parseWireSelectionChangeKind(p.kind),
        } as unknown as vscode.TextEditorSelectionChangeEvent;
        for (const listener of [...selectionListeners]) listener(event);
    });

    // Вид активной темы окна: семя на handshake + каждая настоящая смена.
    // Стреляем на КАЖДОЕ сообщение, даже если вид не поменялся (Dark+ → Abyss):
    // upstream объявляет событие как «тема сменилась ИЛИ изменилась», а семя
    // приходит раньше любой активации, когда слушателей ещё нет.
    rpc.handleNotification("window.themeChanged", (params) => {
        const parsed = parseWireColorTheme(params);
        if (parsed === null) return;
        activeColorTheme = { kind: parsed.kind } as vscode.ColorTheme;
        for (const listener of [...colorThemeListeners]) listener(activeColorTheme);
    });

    // Снимок полосы: диффим с прошлым и производим события API сами — в проводе
    // гранулярных сообщений нет (см. IWireEditorLayout).
    rpc.handleNotification("editor.layoutChanged", (params) => {
        const parsed = parseWireEditorLayout(params);
        if (parsed === null) return;
        const previous = layout;
        layout = parsed;
        applyLayoutDiff(previous, parsed);
    });

    /** Ключи вкладок снимка: `groupId:uri`. */
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

    /** Пары (groupId, uri) видимых ТЕКСТОВЫХ редакторов снимка. */
    function visiblePairs(snapshot: IWireEditorLayout): string[] {
        const pairs: string[] = [];
        for (const group of snapshot.groups) {
            const active = group.tabs.find((tab) => tab.isActive);
            if (active?.kind === "text") {
                pairs.push(selectionKey(group.groupId, active.uri));
            }
        }
        return pairs;
    }

    function applyLayoutDiff(previous: IWireEditorLayout, next: IWireEditorLayout): void {
        const prevTabs = tabKeys(previous);
        const nextTabs = tabKeys(next);

        // Сев выделений видимых редакторов (активная вкладка каждой группы).
        for (const group of next.groups) {
            for (const tab of group.tabs) {
                if (tab.selections !== undefined) {
                    selectionsByEditor.set(selectionKey(group.groupId, tab.uri), tab.selections);
                }
            }
        }

        // Прюнинг кэшей по умершим парам и группам: застрявшая у расширения
        // ссылка на редактор мёртвой группы даёт viewColumn === undefined, не TypeError.
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

        // onDidChangeTabGroups: added/removed/changed(isActive|viewColumn).
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
            const event = {
                opened: openedGroups.map(makeTabGroup),
                closed: closedGroups.map(makeTabGroup),
                changed: changedGroups.map(makeTabGroup),
            } as unknown as vscode.TabGroupChangeEvent;
            for (const listener of [...tabGroupsListeners]) listener(event);
        }

        // onDidChangeTabs: added/removed/changed(isActive|isDirty|label).
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
            const event = {
                opened: openedTabs,
                closed: closedTabs,
                changed: changedTabs,
            } as unknown as vscode.TabChangeEvent;
            for (const listener of [...tabsListeners]) listener(event);
        }

        // onDidChangeVisibleTextEditors: сменился набор видимых пар.
        const prevVisible = visiblePairs(previous);
        const nextVisible = visiblePairs(next);
        if (prevVisible.length !== nextVisible.length || prevVisible.some((pair, i) => pair !== nextVisible[i])) {
            const editors = windowNs.visibleTextEditors;
            for (const listener of [...visibleEditorsListeners]) listener(editors);
        }

        // onDidChangeTextEditorViewColumn: выжившие редакторы со сменившейся колонкой.
        for (const group of next.groups) {
            const before = prevGroups.get(group.groupId);
            if (before === undefined || before.viewColumn === group.viewColumn) continue;
            const editors = editorCache.get(group.groupId);
            if (editors === undefined) continue;
            for (const editor of editors.values()) {
                const event = {
                    textEditor: editor,
                    viewColumn: group.viewColumn,
                } as unknown as vscode.TextEditorViewColumnChangeEvent;
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

    /** `Tab` для `window.tabGroups` — снимок на момент вызова (идентичность не гарантируется). */
    function makeTab(group: IWireTabGroupSnapshot, tab: IWireTabSnapshot): vscode.Tab {
        const input =
            tab.kind === "diff" && tab.original !== undefined && tab.modified !== undefined
                ? new TabInputTextDiff(Uri.parse(tab.original), Uri.parse(tab.modified))
                : tab.kind === "diff"
                  ? undefined
                  : new TabInputText(Uri.parse(tab.uri));
        return {
            label: tab.label,
            input,
            isActive: tab.isActive,
            isDirty: tab.isDirty,
            isPinned: false,
            isPreview: false,
            group: makeTabGroup(group),
            // Внутренняя адресация для tabGroups.close (не часть vscode API).
            _diodeGroupId: group.groupId,
            _diodeUri: tab.uri,
        } as unknown as vscode.Tab;
    }

    function makeTabGroup(group: IWireTabGroupSnapshot): vscode.TabGroup {
        const active = group.tabs.find((tab) => tab.isActive);
        return {
            isActive: group.isActive,
            viewColumn: group.viewColumn,
            activeTab: active !== undefined ? makeTabOnly(group, active) : undefined,
            tabs: group.tabs.map((tab) => makeTabOnly(group, tab)),
        } as unknown as vscode.TabGroup;
    }

    /** Tab без обратной ссылки на группу (обрыв рекурсии makeTab ↔ makeTabGroup). */
    function makeTabOnly(group: IWireTabGroupSnapshot, tab: IWireTabSnapshot): vscode.Tab {
        const input =
            tab.kind === "diff" && tab.original !== undefined && tab.modified !== undefined
                ? new TabInputTextDiff(Uri.parse(tab.original), Uri.parse(tab.modified))
                : tab.kind === "diff"
                  ? undefined
                  : new TabInputText(Uri.parse(tab.uri));
        return {
            label: tab.label,
            input,
            isActive: tab.isActive,
            isDirty: tab.isDirty,
            isPinned: false,
            isPreview: false,
            _diodeGroupId: group.groupId,
            _diodeUri: tab.uri,
        } as unknown as vscode.Tab;
    }

    function toSelection(s: IWireSelection): vscode.Selection {
        return new Selection(
            new Position(s.anchorLine, s.anchorCharacter),
            new Position(s.activeLine, s.activeCharacter),
        ) as unknown as vscode.Selection;
    }

    /** Выделения редактора (группа, документ): у активного — активные, у видимых — из снимка. */
    function editorSelections(groupId: number, uri: string): readonly IWireSelection[] {
        if (uri === activeEditorUri && groupId === effectiveActiveGroupId()) return activeSelections;
        return selectionsByEditor.get(selectionKey(groupId, uri)) ?? [];
    }

    /** Отправляет хосту новые выделения и кэширует их локально. */
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
                return new Selection(new Position(0, 0), new Position(0, 0)) as unknown as vscode.Selection;
            }
            return toSelection(primary);
        };
        const editorData = {
            options: {} as vscode.TextEditorOptions,
            document,
            /** Колонка — всегда от текущего снимка: перенумерация не рвёт объект (AS-9). */
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
                return all.map(toSelection);
            },
            set selections(value: readonly vscode.Selection[]) {
                pushSelections(document, groupId, value);
            },
            // `TextEditor.edit`: собирает правки из callback'а в TextEditorEdit и
            // отправляет их хосту одним undoable-батчем. Возвращает Thenable<boolean>.
            edit: (
                callback: (editBuilder: vscode.TextEditorEdit) => void,
                _options?: { undoStopBefore: boolean; undoStopAfter: boolean },
            ): Thenable<boolean> => {
                const edits: IWireEditorEdit[] = [];
                const builder: vscode.TextEditorEdit = {
                    replace: (location: vscode.Position | vscode.Range | vscode.Selection, value: string) => {
                        edits.push({ range: toWireEditRange(location), text: value });
                    },
                    insert: (position: vscode.Position, value: string) => {
                        edits.push({ range: toWireEditRange(position), text: value });
                    },
                    delete: (location: vscode.Range | vscode.Selection) => {
                        edits.push({ range: toWireEditRange(location), text: "" });
                    },
                    setEndOfLine: () => {
                        /* смена EOL из edit() пока не поддержана (MVP #194) */
                    },
                } as unknown as vscode.TextEditorEdit;
                callback(builder);
                if (edits.length === 0) return Promise.resolve(true);
                return rpc.request("editor.applyEdit", {
                    uri: document.uri.toString(),
                    edits,
                }) as Promise<boolean>;
            },
            // Применение набора декораций (`vscode.TextEditor.setDecorations`):
            // резолвим числовой ключ типа и шлём диапазоны хосту. Пустой набор
            // (`[]`) снимает декорации этого типа в этом файле.
            setDecorations: (
                decorationType: vscode.TextEditorDecorationType,
                rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
            ): void => {
                const key = decorationTypeKeys.get(decorationType as unknown as object);
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
        }) as unknown as vscode.TextEditor;
    }

    // Опрашивает провайдер по изменившимся uri и шлёт хосту результат. uri без
    // декорации (провайдер вернул null) уходит «голым» — хост трактует это как
    // снятие декорации с файла. `undefined` (все файлы) не разворачивается: у
    // субпроцесса нет списка всех uri, а хост держит полный набор сам.
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

    const windowNs = {
        // Webview — не будет by design, но члены обязаны существовать: без них
        // расширение с чат-панелью умирало на активации ЦЕЛИКОМ (см. webviewNoop.ts).
        ...createWebviewNoopMembers(rpc),

        get activeTextEditor(): vscode.TextEditor | undefined {
            if (activeEditorUri === null) return undefined;
            return getEditorFor(registry.getOrCreate(Uri.parse(activeEditorUri)), effectiveActiveGroupId());
        },

        // Видимые редакторы — активная ТЕКСТОВАЯ вкладка каждой группы полосы:
        // один файл в двух группах — два разных TextEditor с одним document (AS-7).
        // Пустой снимок (до первого layoutChanged) деградирует в «только активный».
        get visibleTextEditors(): readonly vscode.TextEditor[] {
            if (layout.groups.length === 0) {
                if (activeEditorUri === null) return [];
                return [getEditorFor(registry.getOrCreate(Uri.parse(activeEditorUri)), effectiveActiveGroupId())];
            }
            const editors: vscode.TextEditor[] = [];
            for (const group of layout.groups) {
                const active = group.tabs.find((tab) => tab.isActive);
                if (active?.kind !== "text") continue;
                editors.push(getEditorFor(registry.getOrCreate(Uri.parse(active.uri)), group.groupId));
            }
            return editors;
        },

        // Оконное состояние. В TUI мы всегда «сфокусированы»; событие
        // регистрируется (editorconfig подписывается), но никогда не стреляет.
        state: { focused: true, active: true } as vscode.WindowState,

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
            if (disposables !== undefined) disposables.push(disposable as unknown as vscode.Disposable);
            return disposable as unknown as vscode.Disposable;
        },

        // Смена каретки/выделения в редакторе. Продюсер — хост
        // (`editor.selectionChanged`); выделение, которое расширение поставило
        // САМО (`TextEditor.selection =`), назад эхом не приходит и события не
        // даёт — эхо-гард стоит на стороне хоста.
        onDidChangeTextEditorSelection: makeListenerEvent(selectionListeners),

        /** Активная тема окна: приезжает от хоста семенем ещё до `activate()`. */
        get activeColorTheme(): vscode.ColorTheme {
            return activeColorTheme;
        },
        onDidChangeActiveColorTheme: makeListenerEvent(colorThemeListeners),

        onDidChangeWindowState: (
            _listener: (e: vscode.WindowState) => unknown,
            _thisArgs?: unknown,
            disposables?: vscode.Disposable[],
        ): vscode.Disposable => {
            // В TUI окно всегда активно — событие никогда не стреляет. Возвращаем
            // валидный no-op Disposable, чтобы регистрация не падала.
            const disposable = new DisposableImpl(() => undefined) as unknown as vscode.Disposable;
            if (disposables !== undefined) disposables.push(disposable);
            return disposable;
        },

        showErrorMessage: (message: string): Thenable<string | undefined> => showMessage(rpc, "error", message),
        showWarningMessage: (message: string): Thenable<string | undefined> => showMessage(rpc, "warn", message),
        showInformationMessage: (message: string): Thenable<string | undefined> => showMessage(rpc, "info", message),

        // Создаёт тип декорации: числовой ключ монотонен и живёт локально;
        // хосту уходит сериализованный options (ThemeColor → { $themeColor: id }).
        // `dispose()` шлёт хосту снятие типа (все его декорации гаснут).
        createTextEditorDecorationType: (options: vscode.DecorationRenderOptions): vscode.TextEditorDecorationType => {
            const key = nextDecorationKey++;
            const type = {
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
            return type as unknown as vscode.TextEditorDecorationType;
        },

        // Провайдер файловых декораций живёт в субпроцессе; мост подписывается на
        // его onDidChangeFileDecorations и сам опрашивает provideFileDecoration по
        // изменившимся uri, проталкивая результат хосту.
        registerFileDecorationProvider: (provider: vscode.FileDecorationProvider): vscode.Disposable => {
            const changeEvent = provider.onDidChangeFileDecorations;
            if (changeEvent === undefined) {
                return new DisposableImpl(() => undefined) as unknown as vscode.Disposable;
            }
            return changeEvent((changed) => {
                void pushFileDecorations(provider, changed);
            });
        },

        // Настоящий output-канал: строки уезжают хосту (`output.append`) и
        // попадают в панель Output отдельным каналом с label = name (мост —
        // ExtensionOutputAdapter). Ошибки vscode-languageclient
        // (`p2c.asDiagnostics` и т.п.) идут ТОЛЬКО сюда — канал обязан быть
        // настоящим. `clear`/`replace` — no-op (журнал ретенционный, см.
        // docs/TODO/LSP.md).
        createOutputChannel: (name: string): vscode.OutputChannel => {
            const channel = "extensions." + slugifyChannelName(name);
            const send = (level: string, value: string): void => {
                rpc.notify("output.append", { channel, label: name, level, value });
            };
            const logEntry =
                (level: string) =>
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
                logLevel: 3, // vscode.LogLevel.Info
                onDidChangeLogLevel: new EventEmitter<never>().event,
                trace: logEntry("trace"),
                debug: logEntry("debug"),
                info: logEntry("info"),
                warn: logEntry("warn"),
                error: logEntry("error"),
            } as unknown as vscode.OutputChannel;
        },

        // Настоящий пункт статус-бара: состояние живёт здесь, а в полосу уезжает
        // нотификациями `window.statusBarItem.{update,dispose}` (мост —
        // ExtensionStatusBarAdapter). Провод молчит, пока пункт не показан: в
        // VS Code `createStatusBarItem` НЕ показывает пункт, это делает `show()`.
        //
        // Отклонения (см. постановку заявки): `tooltip` принимается, но не
        // показывается (виджета подсказки в TUI нет), `color`/`backgroundColor`/
        // `accessibilityInformation` ни на что не влияют.
        createStatusBarItem: (
            idOrAlignment?: string | vscode.StatusBarAlignment,
            alignmentOrPriority?: vscode.StatusBarAlignment | number,
            priorityArg?: number,
        ): vscode.StatusBarItem => {
            // Две перегрузки: с явным id первым аргументом и без него.
            const withId = typeof idOrAlignment === "string";
            const explicitId = withId ? idOrAlignment : undefined;
            const alignment = (withId ? alignmentOrPriority : idOrAlignment) as vscode.StatusBarAlignment | undefined;
            const priority = withId ? priorityArg : alignmentOrPriority;
            const handle = nextStatusBarItemHandle++;
            // `vscode.StatusBarAlignment` из типов расширения и наш рантайм-enum —
            // разные номинальные типы с одними и теми же значениями; сравниваем
            // их как числа, иначе TS видит несовместимые enum'ы.
            const side: "left" | "right" =
                (alignment as number | undefined) === (StatusBarAlignment.Right as number) ? "right" : "left";

            let text = "";
            let name: string | undefined;
            let command: string | vscode.Command | undefined;
            let visible = false;
            let disposed = false;

            /**
             * Id пункта для полосы. Явный — как его задало расширение; иначе
             * синтезируем из имени, чтобы «скрыл через меню видимости» пережило
             * перезапуск редактора (id хранится в состоянии). Пункт без имени
             * скрыть нельзя в принципе — ему хватает id по счётчику.
             *
             * Отклонение от VS Code: там пункт без id получает id расширения.
             * У нас копия `vscode` в субпроцессе одна на все расширения, и
             * контекста «кто именно зовёт» у неё нет (тот же изъян, что у имён
             * output-каналов).
             */
            const fallbackId = `item-${String(handle)}`;
            const currentId = (): string => explicitId ?? (name !== undefined ? slugify(name, fallbackId) : fallbackId);

            /** Команда клика в wire-форме: строка либо `Command` (command + arguments). */
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

            const item = {
                get id(): string {
                    return currentId();
                },
                get alignment(): vscode.StatusBarAlignment {
                    return alignment ?? (StatusBarAlignment.Left as unknown as vscode.StatusBarAlignment);
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
                // Принимаются и читаются обратно, но на полосу не влияют — см.
                // «Границы» постановки: подсказка требует виджета движка, цвета —
                // новых токенов темы и посегментных стилей.
                tooltip: undefined as string | vscode.MarkdownString | undefined,
                color: undefined as string | vscode.ThemeColor | undefined,
                backgroundColor: undefined as vscode.ThemeColor | undefined,
                accessibilityInformation: undefined as vscode.AccessibilityInformation | undefined,
                show: (): void => {
                    if (disposed || visible) return;
                    visible = true;
                    push();
                },
                // Отдельного гейта по `disposed` ни hide, ни dispose не нужны:
                // `unpush` сам молчит на непоказанном пункте, а инертность
                // ручки после dispose держат `show`/`push` (сценарий 6).
                hide: (): void => {
                    unpush();
                },
                dispose: (): void => {
                    unpush();
                    disposed = true;
                },
            };
            return item as unknown as vscode.StatusBarItem;
        },

        onDidChangeVisibleTextEditors: makeListenerEvent(visibleEditorsListeners),
        onDidChangeTextEditorViewColumn: makeListenerEvent(viewColumnListeners),

        // `window.tabGroups`: живой снимок полосы групп (из `editor.layoutChanged`).
        // `Tab.isPinned`/`isPreview` — честные false (фич нет); `isDirty` настоящий.
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
                    } as unknown as vscode.TabGroup;
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
                // Tab отличаем от TabGroup по внутренней адресации _diodeUri.
                if ((items[0] as { _diodeUri?: unknown })._diodeUri !== undefined) {
                    const tabs = (items as vscode.Tab[]).map((tab) => ({
                        groupId: (tab as unknown as { _diodeGroupId: number })._diodeGroupId,
                        uri: (tab as unknown as { _diodeUri: string })._diodeUri,
                    }));
                    return rpc.request("editor.closeTabs", { tabs }) as Promise<boolean>;
                }
                const groupIds = (items as vscode.TabGroup[]).map((group) => {
                    // Снимок несёт viewColumn числом, у vscode.TabGroup это enum ViewColumn —
                    // сравниваем как числа, это одна и та же величина.
                    const column: number = group.viewColumn;
                    const snapshot = layout.groups.find((g) => g.viewColumn === column);
                    return snapshot?.groupId ?? -1;
                });
                return rpc.request("editor.closeGroups", { groupIds }) as Promise<boolean>;
            },
        } as unknown as vscode.TabGroups,

        // Ввод и выбор по просьбе расширения: оба поднимают у хоста общий
        // QuickInput-оверлей приложения (тот же, что палитра и Quick Open) и
        // отдают введённое/выбранное, а по Esc — undefined. Детали провода —
        // quickInputNamespace.ts.
        showInputBox: (
            options?: vscode.InputBoxOptions,
            token?: vscode.CancellationToken,
        ): Thenable<string | undefined> => quickInput.showInputBox(options, token),
        showQuickPick: (
            items: unknown,
            options?: vscode.QuickPickOptions,
            token?: vscode.CancellationToken,
        ): Thenable<unknown> => quickInput.showQuickPick(items, options, token),

        // `window.showTextDocument` (3 перегрузки): нормализуем в один запрос
        // хосту; к моменту резолва `editor.layoutChanged` уже применён (хост
        // флашит его перед ответом), так что редактор существует в снимке.
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
            return (
                rpc.request("editor.showTextDocument", params) as Promise<
                    { uri: string; groupId: number } | null | undefined
                >
            ).then((result) => {
                // Защитный фолбэк (харнессы со стаб-RPC отвечают undefined):
                // без ответа собираем редактор по тому же uri, который и просили
                // показать, в активной группе — `getEditorFor` мемоизирует по
                // паре (группа, uri), так что это тот же объект, что и
                // `activeTextEditor`, когда открывали активный документ.
                if (result === null || typeof result !== "object") {
                    return getEditorFor(registry.getOrCreate(uri), effectiveActiveGroupId());
                }
                return getEditorFor(registry.getOrCreate(Uri.parse(result.uri)), result.groupId);
            });
        },
        // Настоящий withProgress: жизненный цикл уезжает хосту нотификациями
        // window.progress.{start,report,end} — статус-бар показывает спиннер,
        // пока промис задачи не устаканился. Location игнорируется (в TUI всё —
        // ProgressLocation.Window); отмены нет — токен никогда не стреляет
        // (ProgressPart languageclient'а это переживает, см. docs/TODO/LSP.md).
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
            } as unknown as vscode.CancellationToken;
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

    return windowNs as unknown as typeof vscode.window;
}

/** `vscode.Selection` → wire (anchor/active, 0-based). */
function toWireSelection(selection: vscode.Selection): IWireSelection {
    return {
        anchorLine: selection.anchor.line,
        anchorCharacter: selection.anchor.character,
        activeLine: selection.active.line,
        activeCharacter: selection.active.character,
    };
}

/**
 * Диапазон правки из `Range`/`Selection` (есть `start`/`end`) либо `Position`
 * (вставка в точку → пустой диапазон `pos..pos`).
 */
function toWireEditRange(location: vscode.Range | vscode.Position): IWireEditorEdit["range"] {
    const asRange = location as { start?: vscode.Position; end?: vscode.Position };
    if (asRange.start !== undefined && asRange.end !== undefined) {
        return {
            startLine: asRange.start.line,
            startCharacter: asRange.start.character,
            endLine: asRange.end.line,
            endCharacter: asRange.end.character,
        };
    }
    const pos = location as vscode.Position;
    return { startLine: pos.line, startCharacter: pos.character, endLine: pos.line, endCharacter: pos.character };
}

function showMessage(
    rpc: RpcEndpoint,
    severity: "error" | "warn" | "info",
    message: string,
): Thenable<string | undefined> {
    rpc.notify("window.showMessage", { severity, message });
    return Promise.resolve(undefined);
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

import { Uri } from "../../../base/common/uri.ts";
import type { CursorChangeSource } from "../../../editor/common/core/cursorChangeSource.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { CompletionTriggerKind } from "../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreSignatureHelp,
    SignatureHelpTriggerKind,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IConfigurationData } from "../../../platform/configuration/common/iConfigurationService.ts";

/**
 * Wire-форма правки save-участника (subprocess → host). Либо замена текста в
 * диапазоне (core `ITextEdit`, позиции 0-based), либо смена EOL всего
 * документа. Общий формат для обеих сторон RPC.
 */
export type WireTextEdit = ITextEdit | { readonly setEndOfLine: 1 | 2 };

/** Параметры запроса will-save (host → subprocess). */
export interface IWireWillSaveParams {
    /** Ресурс как `uri.toString()`. `document.fileName` субпроцесс выводит из него сам. */
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
    readonly isDirty: boolean;
    /** `vscode.TextDocumentSaveReason` (1=Manual, 2=AfterDelay, 3=FocusOut). */
    readonly reason: number;
    /** Текущий EOL документа (`vscode.EndOfLine`: 1=LF, 2=CRLF). */
    readonly eol: number;
    /** Кодировка дискового представления (id из SUPPORTED_ENCODINGS, напр. "windows1251"). */
    readonly encoding?: string;
}

/** Параметры `workspace.didSaveTextDocument` (host → subprocess): что сохранено. */
export interface IWireDidSaveParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
}

/**
 * Подписки субпроцесса (`workspace.updateSubscriptions`, subprocess → host):
 * есть ли слушатели will/did-save и document sync — без них хост не гоняет RPC.
 */
export interface IWireSubscriptions {
    readonly willSave: boolean;
    readonly didSave: boolean;
    readonly documentSync: boolean;
}

/** Папка воркспейса в проводе (host → subprocess). */
export interface IWireWorkspaceFolder {
    /** Ресурс папки как `uri.toString()`. */
    readonly uri: string;
    readonly name: string;
    readonly index: number;
}

/** Семя `workspace.initialize` (host → subprocess): слои настроек и папки воркспейса. */
export interface IWireWorkspaceInitialize {
    readonly configuration: IConfigurationData;
    readonly workspaceFolders: readonly IWireWorkspaceFolder[];
}

/** Смена настроек `workspace.configurationChanged` (host → subprocess): новые слои и изменившиеся ключи. */
export interface IWireConfigurationChanged {
    readonly configuration: IConfigurationData;
    readonly affectedKeys: readonly string[];
}

/**
 * Куда пишет `configuration.update` — `ConfigurationTarget` эталона на проводе
 * (`parseConfigurationTarget` extHostConfiguration). Нет поля — цель не задана,
 * её выводит хост (`deriveConfigurationTarget` эталона).
 */
export type WireConfigurationTarget = "user" | "workspace" | "workspaceFolder";

/**
 * Параметры `configuration.update` (subprocess → host):
 * `WorkspaceConfiguration.update(...)`. Ключ — полный dotted (секция уже
 * склеена); нет `value` — снять ключ (`$removeConfigurationOption` эталона).
 * `resource` — uri из scope `getConfiguration` (у цели `workspaceFolder`
 * по нему ищется папка).
 */
export interface IWireConfigurationUpdate {
    readonly key: string;
    readonly value?: unknown;
    readonly target?: WireConfigurationTarget;
    readonly resource?: string;
}

export function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

// ─── Document sync (зеркало документа: снапшот на открытии, дальше правки) ──

/**
 * Параметры, адресующие один ресурс (`uri.toString()`): `editor.didClose`,
 * `workspace.fs.readFile`, `workspace.provideTextDocumentContent`,
 * `workspace.textDocumentContentChanged`.
 */
export interface IWireUriParams {
    readonly uri: string;
}

/**
 * Полный снапшот документа host → subprocess: `editor.didOpen` и flush
 * (`editor.didChange` после замены содержимого целиком). Обычные правки едут
 * дельтой — {@link IWireDocumentChangedEvent}.
 */
export interface IWireDocumentSyncSnapshot {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /**
     * Версия ядрового документа (`TextDocument.versionId`). Монотонна
     * per-document — это требование LSP (`TextDocumentItem.version`).
     */
    readonly version: number;
    /** Полный текст документа (LF-канонический). */
    readonly text: string;
    readonly isDirty?: boolean;
}

/**
 * Одна правка батча модели: диапазон в координатах документа ДО неё и
 * вставленный текст (см. `IModelContentChange` ядра).
 */
export interface IWireDocumentContentChange {
    readonly range: IRange;
    readonly text: string;
}

/**
 * Правки документа host → subprocess (`editor.didChange`): батч модели целиком,
 * в порядке применения (по убыванию, в координатах до каждой правки), и
 * `versionId` модели после него — как `$acceptModelChanged` эталона.
 */
export interface IWireDocumentChangedEvent {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    /** Версия ядрового документа после батча. */
    readonly version: number;
    readonly changes: readonly IWireDocumentContentChange[];
    readonly isDirty?: boolean;
}

/**
 * Валидирует правки `editor.didChange`; `null`, если форма не распознана. Одна
 * битая правка отбрасывает весь батч: применённый частично, он испортил бы
 * зеркало.
 */
export function parseWireDocumentChangedEvent(raw: unknown): IWireDocumentChangedEvent | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.uri !== "string" || obj.uri === "") return null;
    if (!isFiniteNumber(obj.version) || !Array.isArray(obj.changes)) return null;
    const changes: IWireDocumentContentChange[] = [];
    for (const item of obj.changes as unknown[]) {
        if (typeof item !== "object" || item === null) return null;
        const change = item as Record<string, unknown>;
        const range = parseRange(change.range);
        if (range === null || typeof change.text !== "string") return null;
        changes.push({ range, text: change.text });
    }
    return {
        uri: obj.uri,
        version: obj.version,
        changes,
        ...(typeof obj.isDirty === "boolean" ? { isDirty: obj.isDirty } : {}),
    };
}

/** Валидирует снапшот `editor.didOpen`/flush; `null`, если форма не распознана. */
export function parseWireDocumentSyncSnapshot(raw: unknown): IWireDocumentSyncSnapshot | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.uri !== "string" || obj.uri === "") return null;
    if (typeof obj.languageId !== "string") return null;
    if (!isFiniteNumber(obj.version)) return null;
    if (typeof obj.text !== "string") return null;
    return {
        uri: obj.uri,
        languageId: obj.languageId,
        version: obj.version,
        text: obj.text,
        ...(typeof obj.isDirty === "boolean" ? { isDirty: obj.isDirty } : {}),
    };
}

// ─── Editor layout (полоса групп, window.tabGroups) ──────────────────────────

/**
 * Снимок одной вкладки в `editor.layoutChanged`. Метаданные без текста;
 * `selections` — только у активной вкладки группы (видимый редактор:
 * `visibleTextEditors[i].selection` сеется отсюда).
 */
export interface IWireTabSnapshot {
    /** Идентичность вкладки в группе — `uri.toString()` панели. */
    readonly uri: string;
    readonly label: string;
    /** Активная вкладка СВОЕЙ группы. */
    readonly isActive: boolean;
    readonly isDirty: boolean;
    /** `unknown` — вкладка не текстового и не дифф-вида (Keyboard Shortcuts, страница расширения). */
    readonly kind: "text" | "diff" | "unknown";
    /** kind=diff: uri original-стороны. */
    readonly original?: string;
    /** kind=diff: uri modified-стороны. */
    readonly modified?: string;
    readonly languageId?: string;
    readonly selections?: readonly IWireSelection[];
}

/** Снимок группы: стабильный id + производный номер колонки + вкладки. */
export interface IWireTabGroupSnapshot {
    readonly groupId: number;
    readonly viewColumn: number;
    readonly isActive: boolean;
    readonly tabs: readonly IWireTabSnapshot[];
}

/**
 * Снимок полосы групп (`editor.layoutChanged`, host → subprocess). Subprocess
 * диффит его с прошлым и сам производит события API
 * (`onDidChangeVisibleTextEditors`/`onDidChangeTabs`/`onDidChangeTabGroups`/
 * `onDidChangeTextEditorViewColumn`) — гранулярных сообщений в проводе нет,
 * состояние восстановимо идемпотентно (паттерн `diode.scm.publishChanges`).
 */
export interface IWireEditorLayout {
    readonly groups: readonly IWireTabGroupSnapshot[];
}

/** Валидирует `editor.layoutChanged`; `null`, если форма не распознана. */
export function parseWireEditorLayout(raw: unknown): IWireEditorLayout | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.groups)) return null;
    const groups: IWireTabGroupSnapshot[] = [];
    for (const rawGroup of obj.groups as unknown[]) {
        if (typeof rawGroup !== "object" || rawGroup === null) return null;
        const g = rawGroup as Record<string, unknown>;
        if (!isFiniteNumber(g.groupId) || !isFiniteNumber(g.viewColumn)) return null;
        if (typeof g.isActive !== "boolean" || !Array.isArray(g.tabs)) return null;
        const tabs: IWireTabSnapshot[] = [];
        for (const rawTab of g.tabs as unknown[]) {
            if (typeof rawTab !== "object" || rawTab === null) return null;
            const t = rawTab as Record<string, unknown>;
            if (typeof t.uri !== "string" || t.uri === "") return null;
            if (typeof t.label !== "string") return null;
            if (typeof t.isActive !== "boolean" || typeof t.isDirty !== "boolean") return null;
            if (t.kind !== "text" && t.kind !== "diff" && t.kind !== "unknown") return null;
            tabs.push({
                uri: t.uri,
                label: t.label,
                isActive: t.isActive,
                isDirty: t.isDirty,
                kind: t.kind,
                ...(typeof t.original === "string" ? { original: t.original } : {}),
                ...(typeof t.modified === "string" ? { modified: t.modified } : {}),
                ...(typeof t.languageId === "string" ? { languageId: t.languageId } : {}),
                ...(Array.isArray(t.selections) ? { selections: parseWireSelections(t.selections) } : {}),
            });
        }
        groups.push({ groupId: g.groupId, viewColumn: g.viewColumn, isActive: g.isActive, tabs });
    }
    return { groups };
}

/** Параметры `editor.showTextDocument` (subprocess → host, request). */
export interface IWireShowTextDocumentParams {
    readonly uri: string;
    /** `vscode.ViewColumn`: -1 Active (дефолт), -2 Beside, 1..9. */
    readonly viewColumn?: number;
    readonly preserveFocus?: boolean;
    readonly selection?: IWireSelection;
}

/** Результат `editor.showTextDocument`: где фактически открыто. */
export interface IWireShowTextDocumentResult {
    readonly uri: string;
    readonly groupId: number;
    readonly viewColumn: number;
}

/** Параметры `editor.closeTabs`: адресация вкладок парой (группа, ресурс). */
export interface IWireCloseTabsParams {
    readonly tabs: readonly { readonly groupId: number; readonly uri: string }[];
}

/** Параметры `editor.closeGroups`. */
export interface IWireCloseGroupsParams {
    readonly groupIds: readonly number[];
}

/**
 * Поднимает uri из JSON-аргумента команды (`vscode.diff` и т.п.): расширение
 * передаёт `vscode.Uri`, который сериализуется его `toJSON()` в компоненты
 * (`{$mid: 1, scheme, path, …}`); строка тоже принимается. Мусор — `null`.
 */
export function reviveWireUri(raw: unknown): Uri | null {
    if (typeof raw === "string" && raw !== "") return Uri.parse(raw);
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.scheme !== "string" || obj.scheme === "") return null;
    return Uri.from({
        scheme: obj.scheme,
        ...(typeof obj.authority === "string" ? { authority: obj.authority } : {}),
        ...(typeof obj.path === "string" ? { path: obj.path } : {}),
        ...(typeof obj.query === "string" ? { query: obj.query } : {}),
        ...(typeof obj.fragment === "string" ? { fragment: obj.fragment } : {}),
    });
}

// ─── Completion (WP8) ────────────────────────────────────────────────────────

/**
 * Документ запроса языковой фичи (host → subprocess) — общая база параметров
 * всех `languages.provide*`. Текст не едет: субпроцесс берёт его из своего
 * зеркала документов той версии, что указана в запросе.
 *
 * Тип — контракт отправителя (хоста). Получатель (субпроцесс) читает те же
 * параметры как {@link Received} — всё, кроме `uri`, необязательно: по RPC
 * приезжает то, что прислали.
 */
export interface IWireDocumentParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Версия документа (`versionId` модели) на момент запроса: текст — из зеркала субпроцесса. */
    readonly version: number;
}

/** Документ и позиция (0-based) запроса языковой фичи. */
export interface IWirePositionParams extends IWireDocumentParams {
    readonly line: number;
    readonly character: number;
}

/** Провайдер, выбранный ядром по селектору (см. `languages.register`): субпроцесс зовёт ровно его. */
export interface IWireProviderHandle {
    readonly handle: number;
}

/**
 * Пачка провайдеров, выбранных ядром по селектору, в порядке реестра
 * (`ProviderRequestBatcher`): ответ — массив, выровненный по `handles`.
 */
export interface IWireProviderHandles {
    readonly handles: readonly number[];
}

/**
 * Параметры запроса глазами получателя: обязательны только `uri` и поля `K`,
 * остальное — что доехало по проводу, и дефолты получателя — не украшение, а
 * обработка недоехавшего поля. Отправитель строит полный `T`.
 */
export type Received<T extends IWireDocumentParams, K extends keyof T = never> = Pick<T, "uri" | K> & Partial<T>;

/** Параметры запроса completion (host → subprocess); запрос пачечный. */
export interface IWireCompletionParams extends IWirePositionParams, IWireProviderHandles {
    /** Чем спровоцирован запрос; по умолчанию `Invoke`. */
    readonly triggerKind?: CompletionTriggerKind;
    /** Символ-триггер, если запрос спровоцирован набором (`.`). */
    readonly triggerCharacter?: string;
}

// ─── Inline completions (ghost text) ─────────────────────────────────────────

/** Параметры запроса inline completions (host → subprocess); запрос пачечный. */
export interface IWireInlineCompletionParams extends IWirePositionParams, IWireProviderHandles {
    /** `InlineCompletionTriggerKind`: 0 — Invoke, 1 — Automatic. */
    readonly triggerKind: number;
}

// ─── Folding (#87) ───────────────────────────────────────────────────────────

/**
 * Wire-форма области сворачивания (subprocess → host). `start`/`end` — 0-based
 * номера строк; `kind` — числовой `FoldingRangeKind` (для MVP ядро его
 * игнорирует, модель хранит только `startLine/endLine/isCollapsed`).
 */
export interface WireFoldingRange {
    readonly start: number;
    readonly end: number;
    readonly kind?: number;
}

/** Параметры запроса folding (host → subprocess); запрос пачечный. */
export type IWireFoldingParams = IWireDocumentParams & IWireProviderHandles;

// ─── Definition (LSP) ────────────────────────────────────────────────────────

/** Параметры запроса definition (host → subprocess): документ, позиция, провайдер. */
export type IWireDefinitionParams = IWirePositionParams & IWireProviderHandle;

// ─── Hover (LSP) ─────────────────────────────────────────────────────────────

/** Параметры запроса hover (host → subprocess) — форма definition-запроса. */
export type IWireHoverParams = IWirePositionParams & IWireProviderHandle;

// ─── Регистрации языковых провайдеров ────────────────────────────────────────

/**
 * Фичи, провайдеры которых субпроцесс регистрирует в реестре ядра по handle
 * (`languages.register`/`languages.unregister`, аналог upstream
 * `$registerHoverProvider(handle, selector)` + `$unregister(handle)`).
 * Список растёт по мере переезда фич с `languages.updateSubscriptions`.
 */
export const WIRE_LANGUAGE_FEATURE_KINDS = [
    "hover",
    "definition",
    "references",
    "signatureHelp",
    "completion",
    "formatting",
    "rangeFormatting",
    "codeActions",
    "folding",
    "inlineCompletions",
    "rename",
] as const;
export type WireLanguageFeatureKind = (typeof WIRE_LANGUAGE_FEATURE_KINDS)[number];

/**
 * Фильтр документа на проводе — форма `LanguageFilter` ядра. Строковый
 * селектор субпроцесс разворачивает в `{ language }`, `RelativePattern` — в
 * `{ base: fsPath, pattern }`.
 */
export interface IWireLanguageFilter {
    readonly language?: string;
    readonly scheme?: string;
    readonly pattern?: string | { readonly base: string; readonly pattern: string };
    readonly notebookType?: string;
    readonly exclusive?: boolean;
}

/**
 * Метаданные провайдера, которые едут вместе с регистрацией (upstream
 * `$registerSignatureHelpProvider(handle, selector, metadata)`): ядро читает их
 * у провайдеров, подошедших документу, без RPC.
 */
export interface IWireLanguageProviderMetadata {
    /** Символы, набор которых сам открывает подсказку/попап. */
    readonly triggerCharacters?: readonly string[];
    /** Символы, перезапрашивающие подсказку, пока она показана (signature help). */
    readonly retriggerCharacters?: readonly string[];
    /**
     * Виды code actions, которые провайдер вообще отдаёт
     * (`CodeActionProviderMetadata.providedCodeActionKinds`): ядро не спрашивает
     * провайдера, чьи виды не пересекаются с запрошенным `only`.
     */
    readonly providedCodeActionKinds?: readonly string[];
}

/** `languages.register`: провайдер фичи `kind` под селектором (subprocess → host). */
export interface IWireLanguageProviderRegistration extends IWireLanguageProviderMetadata {
    readonly handle: number;
    readonly kind: WireLanguageFeatureKind;
    readonly selector: readonly IWireLanguageFilter[];
}

/** `languages.unregister`: провайдер снят (subprocess → host). */
export interface IWireLanguageProviderUnregistration {
    readonly handle: number;
}

// ─── References (LSP) ────────────────────────────────────────────────────────

/**
 * Параметры запроса references (host → subprocess) — форма definition-запроса
 * плюс LSP-контекст `includeDeclaration`.
 */
export interface IWireReferenceParams extends IWirePositionParams, IWireProviderHandle {
    readonly includeDeclaration: boolean;
}

// ─── Signature Help (LSP) ────────────────────────────────────────────────────

/**
 * Параметры запроса подсказки параметров (host → subprocess). К форме
 * hover-запроса добавлен LSP-контекст: чем спровоцирован запрос и что показано
 * сейчас (по нему сервер удерживает выбранную пользователем перегрузку).
 */
export interface IWireSignatureHelpParams extends IWirePositionParams, IWireProviderHandle {
    readonly triggerKind: SignatureHelpTriggerKind;
    readonly triggerCharacter?: string;
    readonly isRetrigger: boolean;
    readonly activeSignatureHelp?: ICoreSignatureHelp;
}

// ─── Formatting (LSP, #196) ──────────────────────────────────────────────────

/**
 * Параметры запроса форматирования (host → subprocess). Один RPC на оба вида:
 * с `range` субпроцесс спрашивает range-провайдеры (Format Selection), без —
 * документные (Format Document).
 */
export interface IWireFormattingParams extends IWireDocumentParams {
    /**
     * Провайдер, выбранный ядром: с `range` — range-провайдер, без — документный
     * (см. `languages.register`, виды `formatting`/`rangeFormatting`).
     */
    readonly handle: number;
    /** `vscode.FormattingOptions` активного редактора. */
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    /** Диапазон Format Selection; отсутствие поля — весь документ. */
    readonly range?: IRange;
}

// ─── Code actions (LSP, #196) ────────────────────────────────────────────────

/**
 * Параметры запроса code actions (host → subprocess). Контекстные диагностики
 * НЕ едут: субпроцесс собирает их из своих DiagnosticCollection по пересечению
 * с `range` — так провайдер получает те же объекты, что публиковал сервер.
 */
export interface IWireCodeActionParams extends IWireDocumentParams, IWireProviderHandle {
    readonly range: IRange;
    /** LSP `CodeActionContext.only` (`source.organizeImports` и т.п.). */
    readonly only?: string;
}

/** Один code action в wire-форме — метаданные без правок (они в кэше субпроцесса). */
export interface WireCodeAction {
    /** Ключ в кэше субпроцесса (`"<cacheId>.<index>"`) для `languages.applyCodeAction`. */
    readonly id: string;
    readonly title: string;
    readonly kind?: string;
    readonly isPreferred?: boolean;
}

// ─── Rename (languages.registerRenameProvider) ───────────────────────────────

/** Параметры `languages.prepareRename` (host → subprocess) — форма definition-запроса. */
export type IWirePrepareRenameParams = IWirePositionParams & IWireProviderHandle;

/** Параметры `languages.provideRenameEdits` — то же плюс новое имя. */
export interface IWireRenameParams extends IWirePositionParams, IWireProviderHandle {
    readonly newName: string;
}

/**
 * Wire-форма ответа `prepareRename` (subprocess → host): имя символа либо
 * отказ с причиной. Пусто (оба поля отсутствуют) — провайдеру сказать нечего.
 */
export interface WireRenamePrepare {
    /** Текущее имя символа — placeholder поля ввода. */
    readonly placeholder?: string;
    /** «Здесь переименовать нельзя»: сообщение провайдера. */
    readonly rejectReason?: string;
}

/** Wire-форма исхода применения rename (subprocess → host). */
export interface WireRenameResult {
    readonly applied: boolean;
    readonly error?: string;
}

// ─── Progress (window.withProgress → статус-бар) ─────────────────────────────

/** Параметры `window.progress.start` (subprocess → host). */
export interface IWireProgressStart {
    /** Идентификатор прогресса в рамках subprocess'а (счётчик). */
    readonly handle: number;
    readonly title: string;
}

/** Параметры `window.progress.report`. */
export interface IWireProgressReport {
    readonly handle: number;
    readonly message?: string;
    /** Дискретный вклад в процентах (суммируется потребителем, кламп 0–100). */
    readonly increment?: number;
}

/** Параметры `window.progress.end`. */
export interface IWireProgressEnd {
    readonly handle: number;
}

// ─── Пункты статус-бара (window.createStatusBarItem → полоса) ────────────────

/**
 * Полное состояние пункта статус-бара расширения (subprocess → host, notify
 * `window.statusBarItem.update`). Сообщение — upsert: субпроцесс шлёт его на
 * `show()` и на каждую правку ПОКАЗАННОГО пункта, а не дельту. Пункт, который
 * создан, но не показан, в проводе не появляется вовсе.
 */
export interface IWireStatusBarItem {
    /** Идентификатор пункта в рамках subprocess'а (счётчик). */
    readonly handle: number;
    /**
     * Идентификатор пункта для полосы — явный (`createStatusBarItem(id, …)`)
     * либо синтезированный субпроцессом. Хост добавляет к нему свой префикс,
     * чтобы пункт расширения не столкнулся со встроенным сегментом.
     */
    readonly id: string;
    readonly alignment: "left" | "right";
    /**
     * Порядок внутри стороны (выше — левее). `undefined` — пункт без приоритета:
     * встаёт правее всех приоритетных, как в VS Code.
     */
    readonly priority?: number;
    /** Текст пункта как его задало расширение — с разметкой значков `$(name)`. */
    readonly text: string;
    /** Имя для меню видимости полосы; без него пункт в меню не показывается. */
    readonly name?: string;
    /** Команда по клику (`StatusBarItem.command`) и её аргументы. */
    readonly command?: string;
    readonly arguments?: readonly unknown[];
}

/** Параметры `window.statusBarItem.dispose` (он же `hide()`). */
export interface IWireStatusBarItemDispose {
    readonly handle: number;
}

// ─── Output-каналы (window.createOutputChannel → панель Output) ──────────────

/** Уровень строки output-канала (маппится на методы ILogger хоста). */
export type WireOutputLevel = "trace" | "debug" | "info" | "warn" | "error";

/** Параметры `output.append` (subprocess → host): одна строка канала. */
export interface IWireOutputAppend {
    /** Идентификатор канала (`extensions.<slug>`, ключ реестра/логгера). */
    readonly channel: string;
    /** Человекочитаемое имя канала (label в селекторе; регистрируется лениво). */
    readonly label: string;
    readonly level: WireOutputLevel;
    readonly value: string;
}

/** Параметры `output.show` (subprocess → host). */
export interface IWireOutputShow {
    readonly channel: string;
    /** Label канала — show мог прийти до первой строки, канал регистрируется лениво. */
    readonly label: string;
}

// ─── Терминалы (window.createTerminal → встроенный терминал) ─────────────────
// Состояние `vscode.Terminal` живёт в субпроцессе, инстансом владеет хост
// (`TerminalService`). Хост минтит `id` каждого инстанса — и открытого
// человеком, и заведённого расширением; субпроцесс для своих терминалов минтит
// `extHostId` (как `extHostTerminalId` эталона) и шлёт его в
// `terminal.create`. Пока `terminal.opened` с хостовым `id` не пришёл,
// субпроцесс адресует свой терминал по `extHostId` — хост знает обе метки.

/** Адрес терминала в нотификациях субпроцесса: хостовый `id` либо свой `extHostId`. */
export type IWireTerminalRef = { readonly id: number } | { readonly extHostId: number };

/**
 * Параметры `terminal.create` (subprocess → host): расширение завело шелл
 * (`TerminalOptions`); строковые `shellArgs` (Windows-форма) сюда уже не
 * доезжают — субпроцесс режет их по пробелам.
 */
export interface IWireTerminalCreate {
    readonly extHostId: number;
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    /** `null` — снять переменную из окружения шелла (семантика `TerminalOptions.env`). */
    readonly env?: Readonly<Record<string, string | null>>;
    readonly strictEnv?: boolean;
    readonly hideFromUser?: boolean;
    readonly message?: string;
}

/** Параметры `terminal.show` (subprocess → host). */
export interface IWireTerminalShow {
    readonly terminal: IWireTerminalRef;
    readonly preserveFocus: boolean;
}

/** Параметры `terminal.hide` / `terminal.dispose` (subprocess → host). */
export interface IWireTerminalTarget {
    readonly terminal: IWireTerminalRef;
}

/** Параметры `terminal.sendText` (subprocess → host); нормализует Enter хост. */
export interface IWireTerminalSendText {
    readonly terminal: IWireTerminalRef;
    readonly text: string;
    readonly shouldExecute: boolean;
}

/** `creationOptions` терминала, которого субпроцесс не заводил (шелл человека). */
export interface IWireTerminalLaunch {
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | null>>;
    readonly hideFromUser?: boolean;
}

/**
 * Параметры `terminal.opened` (host → subprocess): инстанс заведён. `extHostId`
 * — у терминала, заведённого этим субпроцессом; `pid` — у настоящего шелла.
 */
export interface IWireTerminalOpened {
    readonly id: number;
    readonly extHostId?: number;
    readonly name: string;
    readonly pid?: number;
    readonly launch: IWireTerminalLaunch;
}

/** Причина закрытия терминала — вид `vscode.TerminalExitReason` на проводе. */
export type WireTerminalExitReason = "unknown" | "shutdown" | "process" | "user" | "extension";

/** Параметры `terminal.closed` (host → subprocess): инстанс снесён. */
export interface IWireTerminalClosed {
    readonly id: number;
    readonly code?: number;
    readonly reason: WireTerminalExitReason;
}

/** Параметры `terminal.activeChanged` (host → subprocess); `null` — активного нет. */
export interface IWireTerminalActive {
    readonly id: number | null;
}

const WIRE_TERMINAL_EXIT_REASONS: readonly WireTerminalExitReason[] = [
    "unknown",
    "shutdown",
    "process",
    "user",
    "extension",
];

/** Объект «строка → строка | null»; прочие значения отбрасываются. */
export function parseWireStringRecord(raw: unknown): Record<string, string | null> | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" || value === null) out[key] = value;
    }
    return out;
}

/** Массив строк; не-строки отбрасываются, не массив — `undefined`. */
export function parseWireStringArray(raw: unknown): string[] | undefined {
    return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : undefined;
}

/**
 * Конверт провода как объект «может быть»: поля читаются опциональной цепочкой —
 * у примитива их нет так же, как у `null`, и отдельная проверка «это объект»
 * не нужна.
 */
type WireEnvelope = Readonly<Record<string, unknown>> | null | undefined;

/** Разбор `creationOptions` чужого терминала: незнакомые поля отбрасываются. */
function parseWireTerminalLaunch(raw: unknown): IWireTerminalLaunch {
    const p = raw as WireEnvelope;
    const shellArgs = parseWireStringArray(p?.shellArgs);
    const env = parseWireStringRecord(p?.env);
    return {
        ...(typeof p?.name === "string" ? { name: p.name } : {}),
        ...(typeof p?.shellPath === "string" ? { shellPath: p.shellPath } : {}),
        ...(shellArgs !== undefined ? { shellArgs } : {}),
        ...(typeof p?.cwd === "string" ? { cwd: p.cwd } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(typeof p?.hideFromUser === "boolean" ? { hideFromUser: p.hideFromUser } : {}),
    };
}

/** Валидирует `terminal.opened`; `null`, если нет `id` или имени. */
export function parseWireTerminalOpened(raw: unknown): IWireTerminalOpened | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.name !== "string") return null;
    return {
        id: p.id,
        name: p.name,
        ...(typeof p.extHostId === "number" ? { extHostId: p.extHostId } : {}),
        ...(typeof p.pid === "number" ? { pid: p.pid } : {}),
        launch: parseWireTerminalLaunch(p.launch),
    };
}

/** Валидирует `terminal.closed`; незнакомая причина (хост новее) — `unknown`. */
export function parseWireTerminalClosed(raw: unknown): IWireTerminalClosed | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number") return null;
    const reason = WIRE_TERMINAL_EXIT_REASONS.find((r) => r === p.reason) ?? "unknown";
    return { id: p.id, ...(typeof p.code === "number" ? { code: p.code } : {}), reason };
}

/** Валидирует `terminal.activeChanged`: не число — «активного нет». */
export function parseWireTerminalActive(raw: unknown): IWireTerminalActive {
    const id = (raw as WireEnvelope)?.id;
    return { id: typeof id === "number" ? id : null };
}

// ─── Diagnostics (LSP) ───────────────────────────────────────────────────────

/**
 * Wire-форма одной диагностики (subprocess → host, notify `diagnostics.publish`).
 * `range` — core `IRange` (0-based); `severity` —
 * `vscode.DiagnosticSeverity` (0=Error…3=Hint), маппинг в `MarkerSeverity`
 * делает потребитель sink'а.
 */
export interface WireMarker {
    readonly severity: number;
    readonly range: IRange;
    readonly message: string;
    readonly code?: string;
    readonly source?: string;
}

/** Разобранные параметры `diagnostics.publish`. */
export interface IWireDiagnosticsPublish {
    readonly owner: string;
    /** Ресурс как `uri.toString()` — ключ MarkerService. */
    readonly resource: string;
    readonly markers: readonly WireMarker[];
}

// ─── Editor write (selection + edit, #194) ───────────────────────────────────

/** Wire-форма выделения (0-based; anchor — якорь, active — курсор). */
export interface IWireSelection {
    readonly anchorLine: number;
    readonly anchorCharacter: number;
    readonly activeLine: number;
    readonly activeCharacter: number;
}

/**
 * Wire-форма одной правки текста — `TextEditor.edit`, workspace edit, ответ
 * форматирования, правки-спутники автодополнения: core `ITextEdit` как есть.
 */
export type IWireEditorEdit = ITextEdit;

/** Параметры `editor.applyEdit` (subprocess → host): правки активного редактора. */
export interface IWireApplyEditParams {
    readonly uri: string;
    readonly edits: readonly IWireEditorEdit[];
}

/** Параметры `editor.setSelection` (subprocess → host): новые выделения активного редактора. */
export interface IWireSetSelectionParams {
    readonly uri: string;
    readonly selections: readonly IWireSelection[];
    /** Группа редактора (`TextEditor` адресуется парой группа + документ). */
    readonly groupId: number;
}

/**
 * Параметры `editor.setOptions` (subprocess → host): нормализованный патч
 * `TextEditor.options` и адрес редактора. `indentSize` — алиас `tabSize`.
 */
export interface IWireSetEditorOptionsParams {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    readonly indentSize?: number;
    readonly uri: string;
    readonly groupId: number;
}

export function parseWireSelection(raw: unknown): IWireSelection | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (
        !isFiniteNumber(r.anchorLine) ||
        !isFiniteNumber(r.anchorCharacter) ||
        !isFiniteNumber(r.activeLine) ||
        !isFiniteNumber(r.activeCharacter)
    ) {
        return null;
    }
    return {
        anchorLine: r.anchorLine,
        anchorCharacter: r.anchorCharacter,
        activeLine: r.activeLine,
        activeCharacter: r.activeCharacter,
    };
}

/**
 * Вид смены выделения в проводе (`editor.selectionChanged`) — значения
 * `vscode.TextEditorSelectionChangeKind`: 1 Keyboard, 2 Mouse, 3 Command.
 * Отсутствие поля — источник не распознан (upstream объявляет `kind`
 * опциональным), см. `editor/common/core/cursorChangeSource.ts`.
 */
export type WireSelectionChangeKind = 1 | 2 | 3;

/** Переводит источник жеста ядра в вид смены выделения для расширения. */
export function selectionChangeKindOf(source: CursorChangeSource | undefined): WireSelectionChangeKind | undefined {
    switch (source) {
        case "keyboard":
            return 1;
        case "mouse":
            return 2;
        case "command":
            return 3;
        // Stryker disable next-line ConditionalExpression: мутант сносит `default`,
        // но функция и без него возвращает undefined, вывалившись из switch —
        // эквивалентный мутант, отличить его тестом нельзя.
        default:
            return undefined;
    }
}

/** Валидирует `kind` из провода; всё непонятное — «источник не распознан». */
export function parseWireSelectionChangeKind(raw: unknown): WireSelectionChangeKind | undefined {
    return raw === 1 || raw === 2 || raw === 3 ? raw : undefined;
}

export function parseWireSelections(raw: unknown): IWireSelection[] {
    if (!Array.isArray(raw)) return [];
    const result: IWireSelection[] = [];
    for (const item of raw) {
        const parsed = parseWireSelection(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

// ─── Workspace edit (workspace.applyEdit, #196) ──────────────────────────────

/** Текстовые правки одного ресурса внутри workspace edit. */
export interface IWireResourceTextEdits {
    readonly resource: string;
    readonly edits: readonly IWireEditorEdit[];
}

/**
 * Одна операция workspace edit'а в проводе. Порядок в массиве значим: «Move to
 * a new file» создаёт файл и тут же пишет в него, rename-рефакторинг
 * переименовывает файл и правит импорты уже по новому пути.
 *
 * Опции — дословно из `vscode.WorkspaceEdit`: `overwrite` бьёт
 * `ignoreIfExists`, без них коллизия отбивает edit целиком. `contents`
 * создаваемого файла едет строкой (байты расширения декодируются как UTF-8:
 * создаём мы текстовый файл).
 */
export type IWireWorkspaceEditOp =
    | ({ readonly kind: "text" } & IWireResourceTextEdits)
    | {
          readonly kind: "create";
          readonly resource: string;
          readonly contents?: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      }
    | { readonly kind: "delete"; readonly resource: string; readonly ignoreIfNotExists?: boolean }
    | {
          readonly kind: "rename";
          readonly from: string;
          readonly to: string;
          readonly overwrite?: boolean;
          readonly ignoreIfExists?: boolean;
      };

/**
 * Параметры `workspace.applyEdit` (subprocess → host): упорядоченный набор
 * текстовых правок и файловых операций.
 */
export interface IWireApplyWorkspaceEditParams {
    readonly ops: readonly IWireWorkspaceEditOp[];
}

// ─── Decorations (Chunk 4 — host-bridge) ─────────────────────────────────────

/**
 * Wire-форма `vscode.ThemeColor` — цвет из реестра темы, резолвится в конкретный
 * packed-RGB на стороне host'а. Голый `string` в тех же полях — CSS-цвет, который
 * host игнорирует (у нас нет hex-парсинга инлайн-цветов декораций).
 */
export interface ISerializedThemeColor {
    readonly $themeColor: string;
}

/** Значение цвета в сериализованных опциях декорации: CSS-строка или ThemeColor. */
export type SerializedColor = string | ISerializedThemeColor;

/**
 * Сериализованные `vscode.DecorationRenderOptions` (subprocess → host). Несём
 * только поля, которые host умеет спроецировать на свои поверхности: наличие
 * `overviewRulerColor` делает тип «gutter change-bar», `isWholeLine` — метаданные
 * реестра. Прочие CSS-поля декораций в TUI не рендерятся и не передаются.
 */
export interface SerializedDecorationRenderOptions {
    readonly isWholeLine?: boolean;
    readonly overviewRulerLane?: number;
    readonly backgroundColor?: SerializedColor;
    readonly color?: SerializedColor;
    readonly overviewRulerColor?: SerializedColor;
}

/** Параметры нотификации `window.createTextEditorDecorationType`. */
export interface IWireCreateDecorationType {
    readonly key: number;
    readonly options: SerializedDecorationRenderOptions;
}

/** Параметры нотификации `editor.setDecorations`. */
export interface IWireSetDecorations {
    readonly key: number;
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly ranges: readonly IRange[];
    /** Группа редактора; хост пока красит ресурс во всех группах и поле не читает. */
    readonly groupId: number;
}

/** Одна изменившаяся файловая декорация (`window.fileDecorationsChanged`). */
export interface IWireFileDecoration {
    readonly uri: string;
    readonly badge?: string;
    readonly colorId?: string;
    readonly propagate?: boolean;
}

/** Параметры нотификации `window.disposeTextEditorDecorationType`. */
export interface IWireDisposeDecorationType {
    readonly key: number;
}

/** Параметры нотификации `window.fileDecorationsChanged`. */
export interface IWireFileDecorationsChanged {
    readonly decorations: readonly IWireFileDecoration[];
}

/**
 * Валидирует один сырой диапазон в {@link IRange} (nested `start`/`end`). `null`,
 * если форма не распознана (drop+skip, как остальные wire-парсеры). Единственный
 * разбор диапазона провода: декорации, правки, дельты документа, маркеры.
 */
export function parseRange(raw: unknown): IRange | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { start?: unknown; end?: unknown };
    const start = r.start as { line?: unknown; character?: unknown } | undefined;
    const end = r.end as { line?: unknown; character?: unknown } | undefined;
    if (
        start == null ||
        end == null ||
        !isFiniteNumber(start.line) ||
        !isFiniteNumber(start.character) ||
        !isFiniteNumber(end.line) ||
        !isFiniteNumber(end.character)
    ) {
        return null;
    }
    return createRange(start.line, start.character, end.line, end.character);
}

// ── workspace.fs: чтение ресурса провайдером расширения ──────────────────────

/**
 * Ответ субпроцесса на `workspace.fs.readFile`. Содержимое едет base64-строкой:
 * канал RPC — JSON, а бинарный `Uint8Array` в нём не переживает round-trip
 * (превратился бы в объект с числовыми ключами).
 */
export interface IWireReadFileResult {
    content: string;
}

// ── workspace.registerTextDocumentContentProvider: содержимое недисковых ─────

/**
 * Ответ субпроцесса на `workspace.provideTextDocumentContent`. В отличие от
 * `workspace.fs.readFile` содержимое едет обычной строкой: провайдер отдаёт
 * ТЕКСТ, а не байты, и кодировать его в base64 незачем. `null` — провайдер
 * схемы есть, но этот ресурс отдать отказался (`ProviderResult` разрешает
 * `undefined`/`null`).
 */
export interface IWireTextContentResult {
    content: string | null;
}

/** Схемы провайдеров (`workspace.*ProvidersChanged`, subprocess → host). */
export interface IWireSchemes {
    readonly schemes: readonly string[];
}

/** Ресурсы провайдера ФС, изменившиеся снаружи (`workspace.fs.didChangeFile`, subprocess → host). */
export interface IWireChangedFiles {
    readonly uris: readonly string[];
}

// ── workspace.createFileSystemWatcher: файловые watcher'ы расширений ─────────

/**
 * Запрос субпроцесса на создание watcher'а (`workspace.watcher.create`).
 * `base` — абсолютный путь каталога, `pattern` — glob **относительно** него:
 * ровно пара `RelativePattern`. Строковый `GlobPattern` субпроцесс сам
 * приводит к этой паре, подставляя папку воркспейса как базу, — host не должен
 * гадать, откуда взялся шаблон.
 */
export interface IWireWatcherCreate {
    readonly id: number;
    readonly base: string;
    readonly pattern: string;
    readonly ignoreCreateEvents: boolean;
    readonly ignoreChangeEvents: boolean;
    readonly ignoreDeleteEvents: boolean;
}

/** Снятие watcher'а (`workspace.watcher.dispose`, subprocess → host). */
export interface IWireWatcherDispose {
    readonly id: number;
}

/** Одно файловое событие в сторону субпроцесса: тип + ресурс как `uri.toString()`. */
export interface IWireWatcherEvent {
    readonly type: "created" | "changed" | "deleted";
    readonly uri: string;
}

/** Пачка событий одного watcher'а (`workspace.watcher.events`, host → subprocess). */
export interface IWireWatcherEvents {
    readonly id: number;
    readonly events: readonly IWireWatcherEvent[];
}

/** Разбирает `workspace.watcher.events`; мусорные записи молча отбрасываются. */
export function parseWireWatcherEvents(raw: unknown): IWireWatcherEvents | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { id?: unknown; events?: unknown };
    if (typeof p.id !== "number" || !Array.isArray(p.events)) return null;
    const events: IWireWatcherEvent[] = [];
    for (const item of p.events) {
        if (typeof item !== "object" || item === null) continue;
        const e = item as { type?: unknown; uri?: unknown };
        if (e.type !== "created" && e.type !== "changed" && e.type !== "deleted") continue;
        if (typeof e.uri !== "string" || e.uri === "") continue;
        events.push({ type: e.type, uri: e.uri });
    }
    return { id: p.id, events };
}

// ─── Активная тема (window.activeColorTheme) ─────────────────────────────────

/**
 * Активная тема окна (`window.themeChanged`, host → subprocess). В проводе
 * едет только `kind`: `vscode.ColorTheme` из ничего другого и не состоит, а имя
 * темы расширению не обещано. Сообщение приходит и на handshake (семя ДО первой
 * активации — `activeColorTheme` обязан быть верным уже в `activate()`), и на
 * каждую настоящую смену темы.
 */
export interface IWireColorTheme {
    /** `vscode.ColorThemeKind`: 1 Light, 2 Dark, 3 HighContrast, 4 HighContrastLight. */
    readonly kind: 1 | 2 | 3 | 4;
}

/** Валидирует `window.themeChanged`; `null` — форма не распознана (тему не трогаем). */
export function parseWireColorTheme(raw: unknown): IWireColorTheme | null {
    if (typeof raw !== "object" || raw === null) return null;
    const kind = (raw as Record<string, unknown>).kind;
    if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4) return null;
    return { kind };
}

// ─── Quick input (window.showInputBox / window.showQuickPick) ────────────────
// Расширение просит у человека строку или выбор; UI поднимает хост на общем
// QuickInput-оверлее. Сессия адресуется `handle` (уникален в рамках subprocess'а,
// как у window.progress.*): по нему расширение отменяет показ своим токеном, а
// хост спрашивает валидацию.

/** Строгость сообщения валидации на проводе (= `vscode.InputBoxValidationSeverity`). */
export type WireValidationSeverity = "error" | "warning" | "info";

/** Просьба показать поле ввода (`window.showInputBox`, subprocess → host). */
export interface IWireInputBoxRequest {
    readonly handle: number;
    readonly title?: string;
    readonly prompt?: string;
    readonly placeHolder?: string;
    readonly value?: string;
    /** Поле пароля: набранное закрывается маской (`InputBoxOptions.password`). */
    readonly password: boolean;
    /**
     * У расширения есть `validateInput` — хост обязан спрашивать его на каждое
     * изменение значения (`window.inputBox.validate`). Без флага раунд-трипа не
     * будет вовсе: спрашивать некого.
     */
    readonly validates: boolean;
}

/** Строка списка на проводе: только то, что наш однострочный ряд умеет показать. */
export interface IWireQuickPickItem {
    readonly label: string;
    readonly description?: string;
}

/** Просьба показать список (`window.showQuickPick`, subprocess → host). */
export interface IWireQuickPickRequest {
    readonly handle: number;
    readonly title?: string;
    readonly placeHolder?: string;
    readonly canPickMany: boolean;
    readonly items: readonly IWireQuickPickItem[];
    /** Индексы предотмеченных пунктов (`QuickPickItem.picked`); пусто без `canPickMany`. */
    readonly picked: readonly number[];
}

/** Сообщение валидации в ответ на `window.inputBox.validate` (subprocess → host). */
export interface IWireValidationMessage {
    readonly message: string;
    readonly severity: WireValidationSeverity;
}

/** Запрос валидации значения поля ввода (`window.inputBox.validate`, host → subprocess). */
export interface IWireInputBoxValidate {
    readonly handle: number;
    readonly value: string;
}

/** Снятие показа quick input'а токеном расширения (`window.quickInput.cancel`). */
export interface IWireQuickInputCancel {
    readonly handle: number;
}

/** Ответ хоста на `window.showInputBox`: `value: null` — человек отменил. */
export interface IWireInputBoxResult {
    readonly value: string | null;
}

/**
 * Ответ хоста на `window.showQuickPick`: индексы выбранных пунктов в том же
 * массиве `items`, что прислало расширение (`null` — человек отменил).
 * Индексами, а не предметами: расширение обязано получить обратно СВОИ объекты
 * (`showQuickPick<T>` возвращает `T`), а пересобранный по проводу предмет ими
 * не был бы.
 */
export interface IWireQuickPickResult {
    readonly indices: readonly number[] | null;
}

/** Разбирает ответ хоста на `window.showInputBox` (host → subprocess). */
export function parseWireInputBoxResult(raw: unknown): IWireInputBoxResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { value: null };
    const { value } = raw as { value?: unknown };
    return { value: typeof value === "string" ? value : null };
}

/** Разбирает ответ хоста на `window.showQuickPick` (host → subprocess). */
export function parseWireQuickPickResult(raw: unknown): IWireQuickPickResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { indices: null };
    const { indices } = raw as { indices?: unknown };
    if (!Array.isArray(indices)) return { indices: null };
    return { indices: indices.filter((i): i is number => Number.isInteger(i) && i >= 0) };
}

// ─── Сообщения расширения (window.show{Information,Warning,Error}Message) ────
// Сообщение — ЗАПРОС, а не уведомление: перегрузка с кнопками обязана вернуть
// расширению выбранное, поэтому ответа ждут все показы с кнопками. Адреса показа
// на проводе нет (в отличие от quick input'а): отменять показ расширение не
// умеет — у `show*Message` нет токена, — а «погасить при смерти субпроцесса»
// решается handle'ом, который минтит сам хост.

/** Строгость сообщения на проводе (`error`/`warn`/`info`). */
export type WireMessageSeverity = "error" | "warn" | "info";

/** Кнопка сообщения на проводе (`string` | `MessageItem` расширения). */
export interface IWireMessageItem {
    readonly title: string;
    /**
     * `MessageItem.isCloseAffordance` — эту кнопку возвращают, когда модальное
     * сообщение закрыли Escape'ом. У немодального игнорируется (так в эталоне).
     */
    readonly isCloseAffordance: boolean;
}

/** Просьба показать сообщение (`window.show*Message`, subprocess → host). */
export interface IWireShowMessageRequest {
    readonly severity: WireMessageSeverity;
    readonly message: string;
    /** `MessageOptions.detail` — приглушённая строка; только у модального. */
    readonly detail?: string;
    /** `MessageOptions.modal` — центральный диалог вместо тоста. */
    readonly modal: boolean;
    readonly items: readonly IWireMessageItem[];
}

/**
 * Ответ хоста на `window.showMessage`: индекс нажатой кнопки в том же массиве
 * `items`, что прислало расширение (`null` — закрыли, не выбрав). Индексом, а
 * не предметом: `showInformationMessage<T extends MessageItem>` обязан вернуть
 * расширению ЕГО объект, а пересобранный по проводу предмет им не был бы.
 */
export interface IWireShowMessageResult {
    readonly index: number | null;
}

/** Разбирает ответ хоста на `window.showMessage` (host → subprocess). */
export function parseWireShowMessageResult(raw: unknown): IWireShowMessageResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { index: null };
    const { index } = raw as { index?: unknown };
    if (!Number.isInteger(index)) return { index: null };
    const value = index as number;
    return { index: value >= 0 ? value : null };
}

// ─── Буфер обмена и внешние ссылки (env.clipboard / env.openExternal) ─────────
// Буфер и открытие ссылки живут на хосте: у него терминал (OSC 52) и право
// запускать системный обработчик. Субпроцесс ходит туда запросами.

/** Ответ хоста на `env.clipboard.readText`. */
export interface IWireClipboardText {
    readonly text: string;
}

/** Разбирает ответ хоста на `env.clipboard.readText`; мусор — пустой буфер. */
export function parseWireClipboardText(raw: unknown): IWireClipboardText {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { text: "" };
    const { text } = raw as { text?: unknown };
    return { text: typeof text === "string" ? text : "" };
}

/** Ответ хоста на `env.openExternal` (запрос — {@link IWireUriParams}). */
export interface IWireOpenExternalResult {
    readonly opened: boolean;
}

/** Ответ хоста на `env.openExternal`: удалось ли отдать ссылку пользователю. */
export function parseWireOpenExternalResult(raw: unknown): boolean {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return false;
    return (raw as { opened?: unknown }).opened === true;
}

// ─── Секреты расширения (ExtensionContext.secrets) ───────────────────────────
// Хранилище живёт на хосте (он владеет раскладкой user-data), субпроцесс ходит
// в него запросами. Адрес секрета — пара «id расширения + ключ»: у каждого
// расширения свой лоток, как в эталоне.

/** Адрес секрета: чей и какой. Общая форма запросов `secrets.get`/`secrets.delete`. */
export interface IWireSecretRef {
    readonly extensionId: string;
    readonly key: string;
}

/** Запрос `secrets.store` — тот же адрес плюс значение. */
export interface IWireSecretWrite extends IWireSecretRef {
    readonly value: string;
}

/** Разбирает адрес секрета (`secrets.get`/`secrets.delete`/`secrets.changed`); `null` — форма чужая. */
export function parseWireSecretRef(raw: unknown): IWireSecretRef | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеют проверки полей ниже
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { extensionId?: unknown; key?: unknown };
    if (typeof p.extensionId !== "string" || p.extensionId === "") return null;
    if (typeof p.key !== "string" || p.key === "") return null;
    return { extensionId: p.extensionId, key: p.key };
}

/** Запрос `secrets.keys`: ключи какого расширения. */
export interface IWireSecretKeysRequest {
    readonly extensionId: string;
}

/** Ответ хоста на `secrets.keys`. */
export interface IWireSecretKeys {
    readonly keys: readonly string[];
}

/** Ответ хоста на `secrets.get`: `null` — секрета нет (JSON не возит `undefined`). */
export interface IWireSecretValue {
    readonly value: string | null;
}

/**
 * Запрос `memento.update` (subprocess → host): словарь memento расширения
 * целиком. `shared` — `globalState`, иначе `workspaceState`.
 */
export interface IWireMementoUpdate {
    readonly extensionId: string;
    readonly shared: boolean;
    readonly value: Readonly<Record<string, unknown>>;
}

/**
 * Словарь memento в проводе: plain-объект. Иное (массив, примитив, отсутствие)
 * — пустой словарь: без сохранённого memento расширение начинает с чистого.
 */
export function parseWireMementoValue(raw: unknown): Readonly<Record<string, unknown>> {
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/**
 * Разбирает ответ хоста на `secrets.get` (host → subprocess). `undefined` —
 * секрета нет; `null` в проводе означает ровно это (JSON не возит `undefined`).
 */
export function parseWireSecretValue(raw: unknown): string | undefined {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return undefined;
    const { value } = raw as { value?: unknown };
    return typeof value === "string" ? value : undefined;
}

/** Разбирает ответ хоста на `secrets.keys` (host → subprocess). */
export function parseWireSecretKeys(raw: unknown): string[] {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return [];
    const { keys } = raw as { keys?: unknown };
    if (!Array.isArray(keys)) return [];
    return keys.filter((k): k is string => typeof k === "string");
}

// ─── Каталог расширений (vscode.extensions) ──────────────────────────────────

/**
 * Одно расширение в каталоге, который хост раздаёт субпроцессу
 * (`extensions.catalog`). Поля — ровно то, из чего субпроцесс собирает
 * `vscode.Extension`: `exports` берутся у себя (это возвращённое значение
 * `activate()`, оно по проводу не ездит), а `extensionKind` не едет потому, что
 * без удалённого extension host'а он по контракту `vscode.d.ts` всегда
 * `ExtensionKind.UI` — константа стороны субпроцесса, а не знание хоста.
 */
export interface IWireExtensionDescription {
    readonly id: string;
    /** Корень установки: `Extension.extensionPath` и база `extensionUri`. */
    readonly extensionPath: string;
    /** Разобранный `package.json` расширения (`Extension.packageJSON`). */
    readonly packageJSON: Readonly<Record<string, unknown>>;
    readonly isActive: boolean;
}

/** Полный состав каталога (`extensions.catalog`, host → subprocess). */
export interface IWireExtensionCatalog {
    readonly extensions: readonly IWireExtensionDescription[];
}

/**
 * Разбирает `extensions.catalog`; `null` — форма чужая (каталог не трогаем).
 * Отдельные негодные записи выбрасываются, а не роняют весь каталог: состав —
 * не транзакция, и потерять одного соседа лучше, чем всех.
 */
export function parseWireExtensionCatalog(raw: unknown): IWireExtensionCatalog | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return null;
    const { extensions } = raw as { extensions?: unknown };
    if (!Array.isArray(extensions)) return null;
    const parsed: IWireExtensionDescription[] = [];
    for (const entry of extensions) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as { id?: unknown; extensionPath?: unknown; packageJSON?: unknown; isActive?: unknown };
        if (typeof e.id !== "string" || e.id === "") continue;
        if (typeof e.extensionPath !== "string" || e.extensionPath === "") continue;
        const packageJSON =
            typeof e.packageJSON === "object" && e.packageJSON !== null
                ? (e.packageJSON as Record<string, unknown>)
                : {};
        parsed.push({ id: e.id, extensionPath: e.extensionPath, packageJSON, isActive: e.isActive === true });
    }
    return { extensions: parsed };
}

/** Разбирает `extensions.activated` (id расширения, которое только что ожило). */
export function parseWireExtensionActivated(raw: unknown): string | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return null;
    const { id } = raw as { id?: unknown };
    return typeof id === "string" && id !== "" ? id : null;
}

/**
 * Id расширения в проводе: `extensions.activated` (host → subprocess, расширение
 * только что ожило) и `host.deactivateExtension` (снять его).
 */
export interface IWireExtensionId {
    readonly id: string;
}

// ─── Жизненный цикл расширения (host.*) ──────────────────────────────────────

/**
 * Запрос `host.activateExtension` (host → subprocess): что грузить и куда
 * класть состояние. Ровно одно из `mainPath`/`source` (у `source` — ещё и
 * `filename`); проверяет это получатель.
 */
export interface IWireActivateExtensionParams {
    readonly id: string;
    readonly mainPath?: string;
    readonly source?: string;
    readonly filename?: string;
    /**
     * `"type"` из package.json как есть — хост его не нормализует, это делает
     * одна сторона, разбирающая параметры.
     */
    readonly moduleType: unknown;
    readonly extensionPath?: string;
    readonly globalStoragePath: string;
    /** `null` — папка не открыта (`storageUri` у расширения отсутствует). */
    readonly storagePath: string | null;
    readonly logPath: string;
    /** Memento с прошлых запусков: `get` у расширения синхронный. */
    readonly globalState: Readonly<Record<string, unknown>>;
    readonly workspaceState: Readonly<Record<string, unknown>>;
}

// ─── Команды (vscode.commands) ───────────────────────────────────────────────

/**
 * Запрос `commands.executeCommand` — в обе стороны: субпроцесс просит хост
 * исполнить команду ядра, хост — исполнить команду, заведённую расширением.
 */
export interface IWireExecuteCommandParams {
    readonly id: string;
    readonly args: readonly unknown[];
}

/** Нотификации `commands.registerCommand` / `commands.unregisterCommand`. */
export interface IWireCommandId {
    readonly id: string;
}

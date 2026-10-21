import { Uri } from "../../../base/common/uri.ts";
import type { CursorChangeSource } from "../../../editor/common/core/cursorChangeSource.ts";
import type { IPosition } from "../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { CompletionTriggerKind } from "../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreSignatureHelp,
    SignatureHelpTriggerKind,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IConfigurationData } from "../../../platform/configuration/common/iConfigurationService.ts";
import type { ILanguageConfiguration } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import type {
    EnvironmentVariableMutatorType,
    IEnvironmentVariableCollectionDescription,
    IEnvironmentVariableMutator,
    IEnvironmentVariableScope,
    SerializableEnvironmentDescriptionMap,
    SerializableEnvironmentVariableCollection,
} from "../../../platform/terminal/common/environmentVariable.ts";

/** `setEndOfLine` — `vscode.EndOfLine` всего документа: 1=LF, 2=CRLF. */
export type WireTextEdit = ITextEdit | { readonly setEndOfLine: 1 | 2 };

export interface IWireWillSaveParams {
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
    readonly isDirty: boolean;
    /** `vscode.TextDocumentSaveReason` (1=Manual, 2=AfterDelay, 3=FocusOut). */
    readonly reason: number;
    /** `vscode.EndOfLine`: 1=LF, 2=CRLF. */
    readonly eol: number;
    /** id из SUPPORTED_ENCODINGS ("windows1251"). */
    readonly encoding?: string;
}

export interface IWireDidSaveParams {
    readonly uri: string;
    readonly languageId: string;
}

/** Без слушателей хост не гоняет will/did-save и document sync по RPC. */
export interface IWireSubscriptions {
    readonly willSave: boolean;
    readonly didSave: boolean;
    readonly documentSync: boolean;
}

export interface IWireWorkspaceFolder {
    readonly uri: string;
    readonly name: string;
    readonly index: number;
}

export interface IWireWorkspaceInitialize {
    readonly configuration: IConfigurationData;
    readonly workspaceFolders: readonly IWireWorkspaceFolder[];
    /** Нет поля — окно не из `.code-workspace`. */
    readonly workspaceFile?: string;
}

export interface IWireConfigurationChanged {
    readonly configuration: IConfigurationData;
    readonly affectedKeys: readonly string[];
}

/** `ConfigurationTarget` эталона; нет поля — цель выводит хост (`deriveConfigurationTarget`). */
export type WireConfigurationTarget = "user" | "workspace" | "workspaceFolder";

/**
 * `key` — полный dotted; нет `value` — снять ключ (`$removeConfigurationOption`).
 * `resource` — scope `getConfiguration`: по нему цель `workspaceFolder` ищет папку.
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

export interface IWireUriParams {
    readonly uri: string;
}

/** `editor.didOpen` и flush (замена содержимого целиком); обычные правки едут дельтой. */
export interface IWireDocumentSyncSnapshot {
    readonly uri: string;
    readonly languageId: string;
    /** Монотонна per-document — требование LSP (`TextDocumentItem.version`). */
    readonly version: number;
    /** LF-канонический. */
    readonly text: string;
    readonly isDirty?: boolean;
}

/** `range` — в координатах документа ДО этой правки. */
export interface IWireDocumentContentChange {
    readonly range: IRange;
    readonly text: string;
}

/**
 * Батч модели целиком, в порядке применения (по убыванию); `version` — после
 * батча, как `$acceptModelChanged` эталона.
 */
export interface IWireDocumentChangedEvent {
    readonly uri: string;
    readonly version: number;
    readonly changes: readonly IWireDocumentContentChange[];
    readonly isDirty?: boolean;
}

/** Одна битая правка отбрасывает весь батч: применённый частично, он испортил бы зеркало. */
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

/** `selections` — только у активной вкладки группы: из них сеется `visibleTextEditors[i].selection`. */
export interface IWireTabSnapshot {
    readonly uri: string;
    readonly label: string;
    /** Активна в СВОЕЙ группе. */
    readonly isActive: boolean;
    readonly isDirty: boolean;
    /** `unknown` — вкладка не текстового и не дифф-вида (Keyboard Shortcuts, страница расширения). */
    readonly kind: "text" | "diff" | "unknown";
    readonly original?: string;
    readonly modified?: string;
    /**
     * Документы сторон-моделей — `visibleTextEditors`, как два редактора диффа
     * эталона; сторона-снимок (git-ревизия) своего документа не имеет и не входит.
     */
    readonly sideEditors?: readonly string[];
    readonly languageId?: string;
    readonly selections?: readonly IWireSelection[];
}

export interface IWireTabGroupSnapshot {
    readonly groupId: number;
    readonly viewColumn: number;
    readonly isActive: boolean;
    readonly tabs: readonly IWireTabSnapshot[];
}

/**
 * Гранулярных событий в проводе нет: субпроцесс диффит снимок с прошлым и сам
 * производит события API — состояние восстановимо идемпотентно.
 */
export interface IWireEditorLayout {
    readonly groups: readonly IWireTabGroupSnapshot[];
}

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
            const sideEditors = parseWireStringArray(t.sideEditors);
            tabs.push({
                uri: t.uri,
                label: t.label,
                isActive: t.isActive,
                isDirty: t.isDirty,
                kind: t.kind,
                ...(typeof t.original === "string" ? { original: t.original } : {}),
                ...(typeof t.modified === "string" ? { modified: t.modified } : {}),
                ...(sideEditors !== undefined ? { sideEditors } : {}),
                ...(typeof t.languageId === "string" ? { languageId: t.languageId } : {}),
                ...(Array.isArray(t.selections) ? { selections: parseWireSelections(t.selections) } : {}),
            });
        }
        groups.push({ groupId: g.groupId, viewColumn: g.viewColumn, isActive: g.isActive, tabs });
    }
    return { groups };
}

export interface IWireShowTextDocumentParams {
    readonly uri: string;
    /** `vscode.ViewColumn`: -1 Active (дефолт), -2 Beside, 1..9. */
    readonly viewColumn?: number;
    readonly preserveFocus?: boolean;
    readonly selection?: IWireSelection;
}

/** `$tryCreateDocument` эталона: безымянный документ без вкладки; ответ — {@link IWireUriParams}. */
export interface IWireCreateUntitledParams {
    readonly content?: string;
    readonly language?: string;
    readonly encoding?: string;
}

export interface IWireShowTextDocumentResult {
    readonly uri: string;
    readonly groupId: number;
    readonly viewColumn: number;
}

export interface IWireCloseTabsParams {
    readonly tabs: readonly { readonly groupId: number; readonly uri: string }[];
}

export interface IWireCloseGroupsParams {
    readonly groupIds: readonly number[];
}

/** `vscode.Uri` приезжает компонентами своего `toJSON()` (`{$mid: 1, scheme, …}`); строка тоже принимается. */
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

/**
 * Текст не едет: субпроцесс берёт его из своего зеркала той же версии.
 * Ресурсы на проводе (здесь и во всём файле) — `uri.toString()`. Получатель читает параметры как {@link Received}.
 */
export interface IWireDocumentParams {
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
}

/** Позиция 0-based. */
export interface IWirePositionParams extends IWireDocumentParams {
    readonly line: number;
    readonly character: number;
}

export interface IWireProviderHandle {
    readonly handle: number;
}

/** Ответ — массив, выровненный по `handles`. */
export interface IWireProviderHandles {
    readonly handles: readonly number[];
}

/**
 * Глазами получателя обязательны только `uri` и `K`: дефолты получателя —
 * обработка недоехавшего поля, а не украшение.
 */
export type Received<T extends IWireDocumentParams, K extends keyof T = never> = Pick<T, "uri" | K> & Partial<T>;

export interface IWireCompletionParams extends IWirePositionParams, IWireProviderHandles {
    /** Чем спровоцирован запрос; по умолчанию `Invoke`. */
    readonly triggerKind?: CompletionTriggerKind;
    readonly triggerCharacter?: string;
}

export interface IWireInlineCompletionParams extends IWirePositionParams, IWireProviderHandles {
    /** `InlineCompletionTriggerKind`: 0 — Invoke, 1 — Automatic. */
    readonly triggerKind: number;
}

/** `start`/`end` — 0-based строки; `kind` ядро пока игнорирует. */
export interface WireFoldingRange {
    readonly start: number;
    readonly end: number;
    readonly kind?: number;
}

export type IWireFoldingParams = IWireDocumentParams & IWireProviderHandles;

/** Едет метаданными регистрации — ядро стилизует токены без RPC. */
export interface IWireSemanticTokensLegend {
    readonly tokenTypes: readonly string[];
    readonly tokenModifiers: readonly string[];
}

/** `previousResultId` 0 — прошлого ответа нет; иначе субпроцесс отвечает дельтой. */
export interface IWireDocumentSemanticTokensParams extends IWireDocumentParams, IWireProviderHandle {
    readonly previousResultId: number;
}

export interface IWireRangeSemanticTokensParams extends IWireDocumentParams, IWireProviderHandle {
    readonly range: IRange;
}

/** Правка прошлого ответа: индексы — в массиве `data` (по 5 чисел на токен), не в токенах. */
export interface IWireSemanticTokensEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly data?: readonly number[];
}

/**
 * `SemanticTokensDto` эталона, но JSON. `id` 0 у range-провайдера (дельт к нему
 * нет); `data` — пятёрки deltaLine, deltaStartChar, length, tokenType, tokenModifiers.
 */
export type WireSemanticTokensResult =
    | { readonly id: number; readonly type: "full"; readonly data: readonly number[] }
    | { readonly id: number; readonly type: "delta"; readonly deltas: readonly IWireSemanticTokensEdit[] };

/** `$releaseDocumentSemanticTokens` эталона. */
export interface IWireReleaseSemanticTokens extends IWireProviderHandle {
    readonly resultId: number;
}

/** Ответ — `IRange[][]` по `positions`, цепочка `parent` развёрнута изнутри наружу. */
export interface IWireSelectionRangeParams extends IWireDocumentParams, IWireProviderHandle {
    readonly positions: readonly IPosition[];
}

export type IWireDefinitionParams = IWirePositionParams & IWireProviderHandle;

export type IWireHoverParams = IWirePositionParams & IWireProviderHandle;

/** Аналог `$registerXxxProvider(handle, selector)` + `$unregister(handle)` эталона. */
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
    "selectionRange",
    "semanticTokens",
    "rangeSemanticTokens",
] as const;
export type WireLanguageFeatureKind = (typeof WIRE_LANGUAGE_FEATURE_KINDS)[number];

/** Строковый селектор субпроцесс разворачивает в `{ language }`, `RelativePattern` — в `{ base: fsPath, pattern }`. */
export interface IWireLanguageFilter {
    readonly language?: string;
    readonly scheme?: string;
    readonly pattern?: string | { readonly base: string; readonly pattern: string };
    readonly notebookType?: string;
    readonly exclusive?: boolean;
}

/** Едут с регистрацией: ядро читает их у подошедших провайдеров без RPC. */
export interface IWireLanguageProviderMetadata {
    readonly triggerCharacters?: readonly string[];
    /** Символы, перезапрашивающие подсказку, пока она показана (signature help). */
    readonly retriggerCharacters?: readonly string[];
    /** Ядро не спрашивает провайдера, чьи виды не пересекаются с запрошенным `only`. */
    readonly providedCodeActionKinds?: readonly string[];
    readonly legend?: IWireSemanticTokensLegend;
    /** Событие придёт нотификацией `languages.didChangeSemanticTokens`. */
    readonly hasOnDidChange?: boolean;
}

export interface IWireLanguageProviderRegistration extends IWireLanguageProviderMetadata {
    readonly handle: number;
    readonly kind: WireLanguageFeatureKind;
    readonly selector: readonly IWireLanguageFilter[];
}

/** Слой поверх `language-configuration.json`; снятие — `languages.unsetLanguageConfiguration` с тем же `handle`. */
export interface IWireLanguageConfiguration {
    readonly handle: number;
    readonly languageId: string;
    /** Только секции, которые ядро умеет применить, в формате файла (`notIn` — строками). */
    readonly configuration: ILanguageConfiguration;
}

export interface IWireLanguageProviderUnregistration {
    readonly handle: number;
}

export interface IWireReferenceParams extends IWirePositionParams, IWireProviderHandle {
    readonly includeDeclaration: boolean;
}

/** `activeSignatureHelp` — что показано сейчас: по нему сервер удерживает выбранную перегрузку. */
export interface IWireSignatureHelpParams extends IWirePositionParams, IWireProviderHandle {
    readonly triggerKind: SignatureHelpTriggerKind;
    readonly triggerCharacter?: string;
    readonly isRetrigger: boolean;
    readonly activeSignatureHelp?: ICoreSignatureHelp;
}

/** С `range` — range-провайдер (Format Selection), без — документный. */
export interface IWireFormattingParams extends IWireDocumentParams {
    readonly handle: number;
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    readonly range?: IRange;
}

/**
 * Диагностики контекста не едут: субпроцесс собирает их из своих
 * DiagnosticCollection, чтобы провайдер получил те же объекты, что публиковал сервер.
 */
export interface IWireCodeActionParams extends IWireDocumentParams, IWireProviderHandle {
    readonly range: IRange;
    readonly only?: string;
}

/** Правки остаются в кэше субпроцесса. */
export interface WireCodeAction {
    /** `"<cacheId>.<index>"` для `languages.applyCodeAction`. */
    readonly id: string;
    readonly title: string;
    readonly kind?: string;
    readonly isPreferred?: boolean;
    /** Действие видно, но не применяется. */
    readonly disabled?: string;
}

export type IWirePrepareRenameParams = IWirePositionParams & IWireProviderHandle;

export interface IWireRenameParams extends IWirePositionParams, IWireProviderHandle {
    readonly newName: string;
}

/** Оба поля отсутствуют — провайдеру сказать нечего. */
export interface WireRenamePrepare {
    readonly placeholder?: string;
    readonly rejectReason?: string;
}

export interface WireRenameResult {
    readonly applied: boolean;
    readonly error?: string;
}

export interface IWireProgressStart {
    readonly handle: number;
    readonly title: string;
}

export interface IWireProgressReport {
    readonly handle: number;
    readonly message?: string;
    /** Проценты; суммируются потребителем с клампом 0–100. */
    readonly increment?: number;
}

export interface IWireProgressEnd {
    readonly handle: number;
}

/**
 * Upsert полного состояния на `show()` и на каждую правку ПОКАЗАННОГО пункта;
 * созданный, но не показанный пункт в проводе не появляется.
 */
export interface IWireStatusBarItem {
    readonly handle: number;
    /** Хост добавляет свой префикс, чтобы пункт расширения не столкнулся со встроенным сегментом. */
    readonly id: string;
    readonly alignment: "left" | "right";
    /** Выше — левее; `undefined` встаёт правее всех приоритетных, как в VS Code. */
    readonly priority?: number;
    /** С разметкой значков `$(name)`. */
    readonly text: string;
    /** Без него пункт в меню видимости полосы не показывается. */
    readonly name?: string;
    readonly command?: string;
    readonly arguments?: readonly unknown[];
}

/** Он же `hide()`. */
export interface IWireStatusBarItemDispose {
    readonly handle: number;
}

export type WireOutputLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface IWireOutputAppend {
    readonly channel: string;
    /** Канал регистрируется лениво — по первой строке. */
    readonly label: string;
    readonly level: WireOutputLevel;
    readonly value: string;
}

export interface IWireOutputShow {
    readonly channel: string;
    /** `show` мог прийти до первой строки, канал регистрируется лениво. */
    readonly label: string;
}

// Хост минтит `id` каждого инстанса терминала, субпроцесс — `extHostId` своих
// (`extHostTerminalId` эталона); пока `terminal.opened` не пришёл, субпроцесс
// адресует свой терминал по `extHostId`.

export type IWireTerminalRef = { readonly id: number } | { readonly extHostId: number };

/** Строковые `shellArgs` (Windows-форма) сюда не доезжают — субпроцесс режет их по пробелам. */
export interface IWireTerminalCreate {
    readonly extHostId: number;
    /**
     * Процессом владеет расширение (`ExtensionTerminalOptions.pty`): хост держит
     * только эмулятор, байты ходят `terminal.pty.*`, шелловые опции не шлются.
     */
    readonly pty?: true;
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    /** `null` — снять переменную из окружения шелла (семантика `TerminalOptions.env`). */
    readonly env?: Readonly<Record<string, string | null>>;
    readonly strictEnv?: boolean;
    readonly hideFromUser?: boolean;
    readonly message?: string;
    /** Без поля — `terminal.integrated.defaultLocation`. */
    readonly location?: IWireTerminalLocation;
}

/**
 * `_serializeParentTerminal` эталона: 1 — панель, 2 — редакторы (`vscode.TerminalLocation`);
 * `viewColumn` — `vscode.ViewColumn`.
 */
export type IWireTerminalLocation =
    | 1
    | 2
    | { readonly viewColumn: number; readonly preserveFocus?: true }
    | { readonly parentTerminal: IWireTerminalRef };

export interface IWireTerminalShow {
    readonly terminal: IWireTerminalRef;
    readonly preserveFocus: boolean;
}

export interface IWireTerminalTarget {
    readonly terminal: IWireTerminalRef;
}

/** Enter нормализует хост. */
export interface IWireTerminalSendText {
    readonly terminal: IWireTerminalRef;
    readonly text: string;
    readonly shouldExecute: boolean;
}

/** `creationOptions` терминала, которого субпроцесс не заводил. */
export interface IWireTerminalLaunch {
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | null>>;
    readonly hideFromUser?: boolean;
}

/** `extHostId` — у терминала этого субпроцесса; `pid` — только у настоящего шелла. */
export interface IWireTerminalOpened {
    readonly id: number;
    readonly extHostId?: number;
    readonly name: string;
    readonly pid?: number;
    readonly launch: IWireTerminalLaunch;
}

export interface IWireTerminalPtyData {
    readonly terminal: IWireTerminalRef;
    readonly data: string;
}

export interface IWireTerminalPtyExit {
    readonly terminal: IWireTerminalRef;
    readonly code?: number | undefined;
}

/** `terminal.pty.start` — эмулятор подключён, пора звать `pty.open`; `terminal.pty.resize` — `pty.setDimensions`. */
export interface IWireTerminalPtyDimensions {
    readonly id: number;
    readonly cols: number;
    readonly rows: number;
}

export interface IWireTerminalPtyInput {
    readonly id: number;
    readonly data: string;
}

export type WireTerminalExitReason = "unknown" | "shutdown" | "process" | "user" | "extension";

export interface IWireTerminalClosed {
    readonly id: number;
    readonly code?: number;
    readonly reason: WireTerminalExitReason;
}

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

export function parseWireStringRecord(raw: unknown): Record<string, string | null> | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const out: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string" || value === null) out[key] = value;
    }
    return out;
}

export function parseWireStringArray(raw: unknown): string[] | undefined {
    return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : undefined;
}

/** Поля читаются опциональной цепочкой: у примитива их нет так же, как у `null`. */
type WireEnvelope = Readonly<Record<string, unknown>> | null | undefined;

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

/** Незнакомая причина (хост новее) — `unknown`. */
export function parseWireTerminalClosed(raw: unknown): IWireTerminalClosed | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number") return null;
    const reason = WIRE_TERMINAL_EXIT_REASONS.find((r) => r === p.reason) ?? "unknown";
    return { id: p.id, ...(typeof p.code === "number" ? { code: p.code } : {}), reason };
}

export function parseWireTerminalPtyDimensions(raw: unknown): IWireTerminalPtyDimensions | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || !isPositiveInteger(p.cols) || !isPositiveInteger(p.rows)) return null;
    return { id: p.id, cols: p.cols, rows: p.rows };
}

function isPositiveInteger(v: unknown): v is number {
    return Number.isInteger(v) && (v as number) > 0;
}

export function parseWireTerminalPtyInput(raw: unknown): IWireTerminalPtyInput | null {
    const p = raw as WireEnvelope;
    if (typeof p?.id !== "number" || typeof p.data !== "string") return null;
    return { id: p.id, data: p.data };
}

export function parseWireTerminalActive(raw: unknown): IWireTerminalActive {
    const id = (raw as WireEnvelope)?.id;
    return { id: typeof id === "number" ? id : null };
}

/** `severity` — `vscode.DiagnosticSeverity` (0=Error…3=Hint); в `MarkerSeverity` маппит потребитель sink'а. */
export interface WireMarker {
    readonly severity: number;
    readonly range: IRange;
    readonly message: string;
    readonly code?: string;
    readonly source?: string;
}

export interface IWireDiagnosticsPublish {
    readonly owner: string;
    readonly resource: string;
    readonly markers: readonly WireMarker[];
}

/** Маркеры не из коллекций субпроцесса (настройки, задачи): полный набор на замену, пустой — их не осталось. */
export interface IWireForeignMarkers {
    readonly resource: string;
    readonly markers: readonly WireMarker[];
}

/** `$acceptMarkersChange` эталона. */
export interface IWireMarkersChanged {
    readonly entries: readonly IWireForeignMarkers[];
}

/** 0-based; anchor — якорь, active — курсор. */
export interface IWireSelection {
    readonly anchorLine: number;
    readonly anchorCharacter: number;
    readonly activeLine: number;
    readonly activeCharacter: number;
}

export type IWireEditorEdit = ITextEdit;

export interface IWireApplyEditParams {
    readonly uri: string;
    readonly edits: readonly IWireEditorEdit[];
}

export interface IWireSetSelectionParams {
    readonly uri: string;
    readonly selections: readonly IWireSelection[];
    /** `TextEditor` адресуется парой группа + документ. */
    readonly groupId: number;
}

/** Нормализованный патч `TextEditor.options`; `indentSize` — алиас `tabSize`. */
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

/** `vscode.TextEditorSelectionChangeKind`; нет поля — источник не распознан (у upstream `kind` опционален). */
export type WireSelectionChangeKind = 1 | 2 | 3;

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

export interface IWireResourceTextEdits {
    readonly resource: string;
    readonly edits: readonly IWireEditorEdit[];
}

/**
 * Порядок значим: «Move to a new file» создаёт файл и тут же пишет в него. Без
 * `overwrite`/`ignoreIfExists` коллизия отбивает edit целиком; `contents` — UTF-8.
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

export interface IWireApplyWorkspaceEditParams {
    readonly ops: readonly IWireWorkspaceEditOp[];
    /** После применения затронутые файлы сохраняются по `files.refactoring.autoSave`. */
    readonly isRefactoring?: boolean;
}

export interface IWireSaveAllParams {
    readonly includeUntitled?: boolean;
}

/** `null` — не открыт или не сохранился (`undefined` эталона). */
export type IWireSaveResult = IWireUriParams | null;

/** Голый `string` в тех же полях — CSS-цвет, который хост игнорирует: hex инлайн-цветов не парсим. */
export interface ISerializedThemeColor {
    readonly $themeColor: string;
}

export type SerializedColor = string | ISerializedThemeColor;

/**
 * Только поля, которые хост проецирует: `overviewRulerColor` делает тип
 * «gutter change-bar»; прочие CSS-поля в TUI не рендерятся.
 */
export interface SerializedDecorationRenderOptions {
    readonly isWholeLine?: boolean;
    readonly overviewRulerLane?: number;
    readonly backgroundColor?: SerializedColor;
    readonly color?: SerializedColor;
    readonly overviewRulerColor?: SerializedColor;
}

export interface IWireCreateDecorationType {
    readonly key: number;
    readonly options: SerializedDecorationRenderOptions;
}

export interface IWireSetDecorations {
    readonly key: number;
    readonly uri: string;
    readonly ranges: readonly IRange[];
    /** Хост пока красит ресурс во всех группах и поле не читает. */
    readonly groupId: number;
}

export interface IWireFileDecoration {
    readonly uri: string;
    readonly badge?: string;
    readonly colorId?: string;
    readonly propagate?: boolean;
}

export interface IWireDisposeDecorationType {
    readonly key: number;
}

export interface IWireFileDecorationsChanged {
    readonly decorations: readonly IWireFileDecoration[];
}

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

/** Base64: `Uint8Array` не переживает JSON round-trip. */
export interface IWireReadFileResult {
    content: string;
}

/** `content` — base64. */
export interface IWireWriteFileParams {
    readonly uri: string;
    readonly content: string;
}

/** `vscode.FileStat` без `permissions`. */
export interface IWireFileStat {
    readonly type: number;
    readonly ctime: number;
    readonly mtime: number;
    readonly size: number;
}

/** `readonly` — подмножество `schemes` без записи (`isReadonly` или нет `writeFile`). */
export interface IWireFileSystemSchemes extends IWireSchemes {
    readonly readonly?: readonly string[];
}

/** Строкой, не base64: провайдер отдаёт текст. `null` — провайдер схемы отказался отдать ресурс. */
export interface IWireTextContentResult {
    content: string | null;
}

export interface IWireSchemes {
    readonly schemes: readonly string[];
}

export interface IWireChangedFiles {
    readonly uris: readonly string[];
}

/**
 * `pattern` — glob относительно `base` (пара `RelativePattern`): строковый
 * `GlobPattern` субпроцесс приводит к ней сам, подставляя папку воркспейса.
 */
export interface IWireWatcherCreate {
    readonly id: number;
    readonly base: string;
    readonly pattern: string;
    readonly ignoreCreateEvents: boolean;
    readonly ignoreChangeEvents: boolean;
    readonly ignoreDeleteEvents: boolean;
}

export interface IWireWatcherDispose {
    readonly id: number;
}

export interface IWireWatcherEvent {
    readonly type: "created" | "changed" | "deleted";
    readonly uri: string;
}

export interface IWireWatcherEvents {
    readonly id: number;
    readonly events: readonly IWireWatcherEvent[];
}

/** Мусорные записи молча отбрасываются. */
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

/**
 * Едет только `kind`: имя темы расширению не обещано. Сеется и на handshake —
 * `activeColorTheme` обязан быть верным уже в `activate()`.
 */
export interface IWireColorTheme {
    /** `vscode.ColorThemeKind`: 1 Light, 2 Dark, 3 HighContrast, 4 HighContrastLight. */
    readonly kind: 1 | 2 | 3 | 4;
}

export function parseWireColorTheme(raw: unknown): IWireColorTheme | null {
    if (typeof raw !== "object" || raw === null) return null;
    const kind = (raw as Record<string, unknown>).kind;
    if (kind !== 1 && kind !== 2 && kind !== 3 && kind !== 4) return null;
    return { kind };
}

// Сессия quick input адресуется `handle` (общий счётчик с window.progress.*): по
// нему расширение отменяет показ своим токеном, а хост спрашивает валидацию.

export type WireValidationSeverity = "error" | "warning" | "info";

export interface IWireInputBoxRequest {
    readonly handle: number;
    readonly title?: string;
    readonly prompt?: string;
    readonly placeHolder?: string;
    readonly value?: string;
    readonly password: boolean;
    /** Без флага хост не гоняет раунд-трип `window.inputBox.validate`. */
    readonly validates: boolean;
}

/** Только то, что однострочный ряд умеет показать. */
export interface IWireQuickPickItem {
    readonly label: string;
    readonly description?: string;
}

export interface IWireQuickPickRequest {
    readonly handle: number;
    readonly title?: string;
    readonly placeHolder?: string;
    readonly canPickMany: boolean;
    readonly items: readonly IWireQuickPickItem[];
    /** Пусто без `canPickMany`. */
    readonly picked: readonly number[];
}

export interface IWireValidationMessage {
    readonly message: string;
    readonly severity: WireValidationSeverity;
}

export interface IWireInputBoxValidate {
    readonly handle: number;
    readonly value: string;
}

export interface IWireQuickInputCancel {
    readonly handle: number;
}

/** `null` — человек отменил. */
export interface IWireInputBoxResult {
    readonly value: string | null;
}

/**
 * Индексы в `items` расширения, а не предметы: `showQuickPick<T>` обязан вернуть
 * СВОИ объекты. `null` — отмена.
 */
export interface IWireQuickPickResult {
    readonly indices: readonly number[] | null;
}

export function parseWireInputBoxResult(raw: unknown): IWireInputBoxResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { value: null };
    const { value } = raw as { value?: unknown };
    return { value: typeof value === "string" ? value : null };
}

export function parseWireQuickPickResult(raw: unknown): IWireQuickPickResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { indices: null };
    const { indices } = raw as { indices?: unknown };
    if (!Array.isArray(indices)) return { indices: null };
    return { indices: indices.filter((i): i is number => Number.isInteger(i) && i >= 0) };
}

// Форма эталона (`$createOrUpdate`/`$onDid*`): свойства едут ДИФФОМ, действия
// человека — событиями; `handle` — общий счётчик с показами `showQuickPick`.

/**
 * `handle` — индекс в `items` расширения: разделители не едут, и позиции расходятся.
 * `detail` нужен поиску (`matchOnDetail`), даже когда на экране его не видно.
 */
export interface IWireQuickPickSessionItem {
    readonly handle: number;
    readonly label: string;
    readonly description?: string;
    readonly detail?: string;
    readonly alwaysShow?: boolean;
}

/** Нет поля — «не трогали», `null` — «сбросили в `undefined`» (`_pendingUpdate` эталона). */
export interface IWireQuickPickUpdate {
    readonly handle: number;
    readonly visible?: boolean;
    readonly title?: string | null;
    readonly step?: number | null;
    readonly totalSteps?: number | null;
    readonly placeholder?: string | null;
    readonly prompt?: string | null;
    readonly value?: string;
    readonly canSelectMany?: boolean;
    readonly matchOnDescription?: boolean;
    readonly matchOnDetail?: boolean;
    readonly keepScrollPosition?: boolean;
    readonly items?: readonly IWireQuickPickSessionItem[];
    /** Handle'ы пунктов. */
    readonly activeItems?: readonly number[];
    /** Handle'ы пунктов. */
    readonly selectedItems?: readonly number[];
}

export interface IWireQuickPickDispose {
    readonly handle: number;
}

/** `$onDid*` эталона одной нотификацией. */
export type IWireQuickPickEvent =
    | { readonly handle: number; readonly kind: "changeValue"; readonly value: string }
    | { readonly handle: number; readonly kind: "accept" }
    | { readonly handle: number; readonly kind: "changeActive"; readonly items: readonly number[] }
    | { readonly handle: number; readonly kind: "changeSelection"; readonly items: readonly number[] }
    | { readonly handle: number; readonly kind: "hide" };

export function parseWireQuickPickEvent(raw: unknown): IWireQuickPickEvent | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { handle?: unknown; kind?: unknown; value?: unknown; items?: unknown };
    if (typeof p.handle !== "number") return null;
    const handle = p.handle;
    switch (p.kind) {
        case "changeValue":
            return typeof p.value === "string" ? { handle, kind: "changeValue", value: p.value } : null;
        case "accept":
        case "hide":
            return { handle, kind: p.kind };
        case "changeActive":
        case "changeSelection":
            if (!Array.isArray(p.items)) return null;
            return { handle, kind: p.kind, items: p.items.filter((i): i is number => Number.isInteger(i)) };
        default:
            return null;
    }
}

/** Фильтр диалога: `{ "Images": ["png", "jpg"] }` расширения — массивом пар. */
export interface IWireDialogFilter {
    readonly name: string;
    readonly extensions: readonly string[];
}

export interface IWireOpenDialogRequest {
    readonly defaultUri?: string;
    readonly openLabel?: string;
    readonly canSelectFiles?: boolean;
    readonly canSelectFolders?: boolean;
    readonly canSelectMany?: boolean;
    readonly filters?: readonly IWireDialogFilter[];
    readonly title?: string;
}

export interface IWireSaveDialogRequest {
    readonly defaultUri?: string;
    readonly saveLabel?: string;
    readonly filters?: readonly IWireDialogFilter[];
    readonly title?: string;
}

export interface IWireOpenDialogResult {
    readonly uris: readonly string[] | null;
}

export interface IWireSaveDialogResult {
    readonly uri: string | null;
}

export function parseWireOpenDialogResult(raw: unknown): IWireOpenDialogResult {
    const uris = (raw as { uris?: unknown } | null | undefined)?.uris;
    if (!Array.isArray(uris)) return { uris: null };
    return { uris: uris.filter((uri): uri is string => typeof uri === "string") };
}

export function parseWireSaveDialogResult(raw: unknown): IWireSaveDialogResult {
    const uri = (raw as { uri?: unknown } | null | undefined)?.uri;
    return { uri: typeof uri === "string" ? uri : null };
}

/** Проверки эталона уже прошли; `folders` — итоговый набор `fsPath`, хост открывает его, только если папка одна. */
export interface IWireUpdateWorkspaceFolders {
    readonly extensionId: string | null;
    readonly folders: readonly string[];
}

// Сообщение с кнопками — запрос: ждёт выбора. Адреса показа нет: у `show*Message`
// нет токена отмены.

export type WireMessageSeverity = "error" | "warn" | "info";

export interface IWireMessageItem {
    readonly title: string;
    /** Возвращается, когда модальное сообщение закрыли Escape'ом; у немодального игнорируется (как в эталоне). */
    readonly isCloseAffordance: boolean;
}

export interface IWireShowMessageRequest {
    readonly severity: WireMessageSeverity;
    readonly message: string;
    /** Только у модального. */
    readonly detail?: string;
    readonly modal: boolean;
    readonly items: readonly IWireMessageItem[];
}

/** Индекс в `items`, а не предмет: расширению вернётся ЕГО объект. `null` — закрыли, не выбрав. */
export interface IWireShowMessageResult {
    readonly index: number | null;
}

export function parseWireShowMessageResult(raw: unknown): IWireShowMessageResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { index: null };
    const { index } = raw as { index?: unknown };
    if (!Number.isInteger(index)) return { index: null };
    const value = index as number;
    return { index: value >= 0 ? value : null };
}

// Буфер и ссылки — на хосте: у него терминал (OSC 52) и право запускать системный обработчик.

export interface IWireClipboardText {
    readonly text: string;
}

export function parseWireClipboardText(raw: unknown): IWireClipboardText {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return { text: "" };
    const { text } = raw as { text?: unknown };
    return { text: typeof text === "string" ? text : "" };
}

/** Приходит до первой активации: `env.machineId` и `env.shell` синхронны и читаются уже в `activate()`. */
export interface IWireEnvInitialize {
    readonly machineId: string;
    readonly shell: string;
}

/** Не-строка — пустая строка, как «неизвестно» у эталона. */
export function parseWireEnvInitialize(raw: unknown): IWireEnvInitialize {
    const { machineId, shell } = (typeof raw === "object" && raw !== null ? raw : {}) as {
        machineId?: unknown;
        shell?: unknown;
    };
    return {
        machineId: typeof machineId === "string" ? machineId : "",
        shell: typeof shell === "string" ? shell : "",
    };
}

export interface IWireEnvironmentVariableCollections {
    readonly collections: readonly (readonly [string, SerializableEnvironmentVariableCollection])[];
}

/** Без `collection` — пустая. */
export interface IWireSetEnvironmentVariableCollection {
    readonly extensionId: string;
    readonly persistent: boolean;
    readonly collection?: SerializableEnvironmentVariableCollection;
    readonly description: SerializableEnvironmentDescriptionMap;
}

/** Replace, Append, Prepend числами: enum потянул бы модуль слияния в бандл субпроцесса (бюджет ленивых кусков). */
const MUTATOR_TYPES: readonly number[] = [1, 2, 3];

function parseWireEnvironmentScope(raw: unknown): IEnvironmentVariableScope | undefined | null {
    if (raw === undefined) return undefined;
    if (typeof raw !== "object" || raw === null) return null;
    const folder = (raw as { workspaceFolder?: unknown }).workspaceFolder;
    if (folder === undefined) return {};
    const { uri, name, index } = (typeof folder === "object" && folder !== null ? folder : {}) as {
        uri?: unknown;
        name?: unknown;
        index?: unknown;
    };
    if (typeof uri !== "string" || typeof name !== "string" || typeof index !== "number") return null;
    return { workspaceFolder: { uri, name, index } };
}

export function parseWireEnvironmentVariableMutator(raw: unknown): IEnvironmentVariableMutator | null {
    const { variable, value, type, options, scope } = (raw ?? {}) as Record<string, unknown>;
    if (typeof variable !== "string" || typeof value !== "string") return null;
    if (!MUTATOR_TYPES.includes(type as number)) return null;
    const parsedScope = parseWireEnvironmentScope(scope);
    if (parsedScope === null) return null;
    const { applyAtProcessCreation, applyAtShellIntegration } = (
        typeof options === "object" && options !== null ? options : {}
    ) as { applyAtProcessCreation?: unknown; applyAtShellIntegration?: unknown };
    return {
        variable,
        value,
        type: type as EnvironmentVariableMutatorType,
        options: {
            ...(typeof applyAtProcessCreation === "boolean" ? { applyAtProcessCreation } : {}),
            ...(typeof applyAtShellIntegration === "boolean" ? { applyAtShellIntegration } : {}),
        },
        ...(parsedScope === undefined ? {} : { scope: parsedScope }),
    };
}

export function parseWireEnvironmentVariableEntries(raw: unknown): [string, IEnvironmentVariableMutator][] {
    if (!Array.isArray(raw)) return [];
    const entries: [string, IEnvironmentVariableMutator][] = [];
    for (const entry of raw as unknown[]) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        const mutator = parseWireEnvironmentVariableMutator(entry[1]);
        if (mutator !== null) entries.push([entry[0], mutator]);
    }
    return entries;
}

export function parseWireEnvironmentVariableCollections(
    raw: unknown,
): [string, [string, IEnvironmentVariableMutator][]][] {
    const collections = (raw as { collections?: unknown } | null)?.collections;
    if (!Array.isArray(collections)) return [];
    const result: [string, [string, IEnvironmentVariableMutator][]][] = [];
    for (const entry of collections as unknown[]) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        result.push([entry[0], parseWireEnvironmentVariableEntries(entry[1])]);
    }
    return result;
}

export function parseWireEnvironmentDescriptions(raw: unknown): [string, IEnvironmentVariableCollectionDescription][] {
    if (!Array.isArray(raw)) return [];
    const result: [string, IEnvironmentVariableCollectionDescription][] = [];
    for (const entry of raw as unknown[]) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
        const { description, scope } = (typeof entry[1] === "object" && entry[1] !== null ? entry[1] : {}) as {
            description?: unknown;
            scope?: unknown;
        };
        const parsedScope = parseWireEnvironmentScope(scope);
        if (parsedScope === null) continue;
        result.push([
            entry[0],
            { description: typeof description === "string" ? description : undefined, scope: parsedScope },
        ]);
    }
    return result;
}

export interface IWireUriHandlerRegistration {
    readonly extensionId: string;
}

export interface IWireHandleUri {
    readonly extensionId: string;
    readonly uri: string;
}

export function parseWireHandleUri(raw: unknown): IWireHandleUri {
    const { extensionId, uri } = (typeof raw === "object" && raw !== null ? raw : {}) as {
        extensionId?: unknown;
        uri?: unknown;
    };
    if (typeof extensionId !== "string" || typeof uri !== "string") {
        throw new Error("window.handleUri: extensionId and uri must be strings");
    }
    return { extensionId, uri };
}

export interface IWireOpenExternalResult {
    readonly opened: boolean;
}

export function parseWireOpenExternalResult(raw: unknown): boolean {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return false;
    return (raw as { opened?: unknown }).opened === true;
}

// Адрес секрета — «id расширения + ключ»: у каждого расширения свой лоток, как в эталоне.

export interface IWireSecretRef {
    readonly extensionId: string;
    readonly key: string;
}

export interface IWireSecretWrite extends IWireSecretRef {
    readonly value: string;
}

export function parseWireSecretRef(raw: unknown): IWireSecretRef | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеют проверки полей ниже
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { extensionId?: unknown; key?: unknown };
    if (typeof p.extensionId !== "string" || p.extensionId === "") return null;
    if (typeof p.key !== "string" || p.key === "") return null;
    return { extensionId: p.extensionId, key: p.key };
}

export interface IWireSecretKeysRequest {
    readonly extensionId: string;
}

export interface IWireSecretKeys {
    readonly keys: readonly string[];
}

export interface IWireSecretValue {
    readonly value: string | null;
}

/** Словарь целиком; `shared` — `globalState`, иначе `workspaceState`. */
export interface IWireMementoUpdate {
    readonly extensionId: string;
    readonly shared: boolean;
    readonly value: Readonly<Record<string, unknown>>;
}

export function parseWireMementoValue(raw: unknown): Readonly<Record<string, unknown>> {
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function parseWireSecretValue(raw: unknown): string | undefined {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return undefined;
    const { value } = raw as { value?: unknown };
    return typeof value === "string" ? value : undefined;
}

export function parseWireSecretKeys(raw: unknown): string[] {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return [];
    const { keys } = raw as { keys?: unknown };
    if (!Array.isArray(keys)) return [];
    return keys.filter((k): k is string => typeof k === "string");
}

/**
 * `exports` по проводу не ездят (их даёт `activate()` в субпроцессе); `extensionKind`
 * без удалённого extension host'а — всегда `UI`, константа субпроцесса.
 */
export interface IWireExtensionDescription {
    readonly id: string;
    readonly extensionPath: string;
    readonly packageJSON: Readonly<Record<string, unknown>>;
    readonly isActive: boolean;
}

export interface IWireExtensionCatalog {
    readonly extensions: readonly IWireExtensionDescription[];
}

/** Негодные записи выбрасываются поштучно: потерять одного соседа лучше, чем всех. */
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

export function parseWireExtensionActivated(raw: unknown): string | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return null;
    const { id } = raw as { id?: unknown };
    return typeof id === "string" && id !== "" ? id : null;
}

export interface IWireExtensionId {
    readonly id: string;
}

/** Ровно одно из `mainPath`/`source` (у `source` — ещё `filename`); проверяет получатель. */
export interface IWireActivateExtensionParams {
    readonly id: string;
    readonly mainPath?: string;
    readonly source?: string;
    readonly filename?: string;
    /** `"type"` из package.json как есть: нормализует сторона, разбирающая параметры. */
    readonly moduleType: unknown;
    readonly extensionPath?: string;
    readonly globalStoragePath: string;
    /** `null` — папка не открыта. */
    readonly storagePath: string | null;
    readonly logPath: string;
    /** `get` у расширения синхронный. */
    readonly globalState: Readonly<Record<string, unknown>>;
    readonly workspaceState: Readonly<Record<string, unknown>>;
}

/** В обе стороны: хост тоже исполняет команды, заведённые расширением. */
export interface IWireExecuteCommandParams {
    readonly id: string;
    readonly args: readonly unknown[];
}

export interface IWireCommandId {
    readonly id: string;
}

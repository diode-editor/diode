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

/** `setEndOfLine` is the whole document's `vscode.EndOfLine`: 1=LF, 2=CRLF. */
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
    /** An id from SUPPORTED_ENCODINGS ("windows1251"). */
    readonly encoding?: string;
}

export interface IWireDidSaveParams {
    readonly uri: string;
    readonly languageId: string;
}

/** Without listeners the host skips will/did-save over RPC. */
export interface IWireSubscriptions {
    readonly willSave: boolean;
    readonly didSave: boolean;
}

export interface IWireWorkspaceFolder {
    readonly uri: string;
    readonly name: string;
    readonly index: number;
}

export interface IWireWorkspaceInitialize {
    readonly configuration: IConfigurationData;
    readonly workspaceFolders: readonly IWireWorkspaceFolder[];
    /** Absent when the window is not opened from a `.code-workspace`. */
    readonly workspaceFile?: string;
}

export interface IWireConfigurationChanged {
    readonly configuration: IConfigurationData;
    readonly affectedKeys: readonly string[];
}

/** Upstream `ConfigurationTarget`; when absent, the host derives the target (`deriveConfigurationTarget`). */
export type WireConfigurationTarget = "user" | "workspace" | "workspaceFolder";

/**
 * `key` is the full dotted key; no `value` removes the key (`$removeConfigurationOption`).
 * `resource` is the `getConfiguration` scope: the `workspaceFolder` target finds its folder by it.
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

/** `editor.didOpen` and flush (full content replacement); regular edits travel as deltas. */
export interface IWireDocumentSyncSnapshot {
    readonly uri: string;
    readonly languageId: string;
    /** Monotonic per document — an LSP requirement (`TextDocumentItem.version`). */
    readonly version: number;
    /** LF-normalized. */
    readonly text: string;
    readonly isDirty?: boolean;
    /** 1=LF, 2=CRLF: the text is normalized, so the line ending travels on its own. */
    readonly eol?: 1 | 2;
    readonly encoding?: string;
}

/** Upstream `$acceptDirtyStateChanged` + `$acceptModelEOLChanged`: a save or an EOL change moves no text. */
export interface IWireDocumentStateChanged {
    readonly uri: string;
    /** An EOL change is a new version with no content change. */
    readonly version: number;
    readonly isDirty: boolean;
    readonly eol: 1 | 2;
}

/** `range` is in document coordinates BEFORE this edit. */
export interface IWireDocumentContentChange {
    readonly range: IRange;
    readonly text: string;
}

/**
 * The whole model batch, in application order (descending); `version` is after
 * the batch, as in upstream `$acceptModelChanged`.
 */
export interface IWireDocumentChangedEvent {
    readonly uri: string;
    readonly version: number;
    readonly changes: readonly IWireDocumentContentChange[];
    readonly isDirty?: boolean;
}

/** One malformed change drops the whole batch: applied partially, it would corrupt the mirror. */
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
        ...(obj.eol === 1 || obj.eol === 2 ? { eol: obj.eol } : {}),
        ...(typeof obj.encoding === "string" ? { encoding: obj.encoding } : {}),
    };
}

/** `selections` only on the group's active tab: they seed `visibleTextEditors[i].selection`. */
export interface IWireTabSnapshot {
    readonly uri: string;
    readonly label: string;
    /** Active within ITS OWN group. */
    readonly isActive: boolean;
    readonly isDirty: boolean;
    /** `unknown` is a tab that is neither text nor diff (Keyboard Shortcuts, extension page). */
    readonly kind: "text" | "diff" | "unknown";
    readonly original?: string;
    readonly modified?: string;
    /**
     * Documents of the model-backed sides are `visibleTextEditors`, like upstream's two
     * diff editors; a snapshot side (git revision) has no document of its own and is left out.
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
 * No granular events over the wire: the subprocess diffs the snapshot against the previous
 * one and produces API events itself — state is idempotently recoverable.
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
    /** `vscode.ViewColumn`: -1 Active (default), -2 Beside, 1..9. */
    readonly viewColumn?: number;
    readonly preserveFocus?: boolean;
    readonly selection?: IWireSelection;
}

/** Upstream `$tryCreateDocument`: an untitled document without a tab; the reply is {@link IWireUriParams}. */
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

/** `vscode.Uri` arrives as the components of its `toJSON()` (`{$mid: 1, scheme, …}`); a string is accepted too. */
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
 * Text is not sent: the subprocess takes it from its own mirror of the same version.
 * Resources on the wire (here and throughout this file) are `uri.toString()`. The receiver reads params as {@link Received}.
 */
export interface IWireDocumentParams {
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
}

/** 0-based position. */
export interface IWirePositionParams extends IWireDocumentParams {
    readonly line: number;
    readonly character: number;
}

export interface IWireProviderHandle {
    readonly handle: number;
}

/** The reply is an array aligned with `handles`. */
export interface IWireProviderHandles {
    readonly handles: readonly number[];
}

/**
 * From the receiver's side only `uri` and `K` are required: the receiver's defaults
 * handle a field that did not arrive, they are not decoration.
 */
export type Received<T extends IWireDocumentParams, K extends keyof T = never> = Pick<T, "uri" | K> & Partial<T>;

export interface IWireCompletionParams extends IWirePositionParams, IWireProviderHandles {
    /** What triggered the request; defaults to `Invoke`. */
    readonly triggerKind?: CompletionTriggerKind;
    readonly triggerCharacter?: string;
}

export interface IWireInlineCompletionParams extends IWirePositionParams, IWireProviderHandles {
    /** `InlineCompletionTriggerKind`: 0 = Invoke, 1 = Automatic. */
    readonly triggerKind: number;
}

/** `start`/`end` are 0-based lines; the core ignores `kind` for now. */
export interface WireFoldingRange {
    readonly start: number;
    readonly end: number;
    readonly kind?: number;
}

export type IWireFoldingParams = IWireDocumentParams & IWireProviderHandles;

/** Sent as registration metadata — the core styles tokens without RPC. */
export interface IWireSemanticTokensLegend {
    readonly tokenTypes: readonly string[];
    readonly tokenModifiers: readonly string[];
}

/** `previousResultId` 0 means no previous result; otherwise the subprocess replies with a delta. */
export interface IWireDocumentSemanticTokensParams extends IWireDocumentParams, IWireProviderHandle {
    readonly previousResultId: number;
}

export interface IWireRangeSemanticTokensParams extends IWireDocumentParams, IWireProviderHandle {
    readonly range: IRange;
}

/** An edit of the previous result: indices are into the `data` array (5 numbers per token), not into tokens. */
export interface IWireSemanticTokensEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly data?: readonly number[];
}

/**
 * Upstream `SemanticTokensDto`, but as JSON. `id` is 0 for a range provider (it has no
 * deltas); `data` is quintuples of deltaLine, deltaStartChar, length, tokenType, tokenModifiers.
 */
export type WireSemanticTokensResult =
    | { readonly id: number; readonly type: "full"; readonly data: readonly number[] }
    | { readonly id: number; readonly type: "delta"; readonly deltas: readonly IWireSemanticTokensEdit[] };

/** Upstream `$releaseDocumentSemanticTokens`. */
export interface IWireReleaseSemanticTokens extends IWireProviderHandle {
    readonly resultId: number;
}

/** The reply is `IRange[][]` per `positions`, with the `parent` chain unrolled from inside out. */
export interface IWireSelectionRangeParams extends IWireDocumentParams, IWireProviderHandle {
    readonly positions: readonly IPosition[];
}

/** Upstream `$provideDocumentColors`: the reply is `null` when the provider gave no colors. */
export type IWireDocumentColorParams = IWireDocumentParams & IWireProviderHandle;

export type IWireDefinitionParams = IWirePositionParams & IWireProviderHandle;

export type IWireHoverParams = IWirePositionParams & IWireProviderHandle;

/** Counterpart of upstream `$registerXxxProvider(handle, selector)` + `$unregister(handle)`. */
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
    "color",
    "semanticTokens",
    "rangeSemanticTokens",
] as const;
export type WireLanguageFeatureKind = (typeof WIRE_LANGUAGE_FEATURE_KINDS)[number];

/** The subprocess expands a string selector to `{ language }` and a `RelativePattern` to `{ base: fsPath, pattern }`. */
export interface IWireLanguageFilter {
    readonly language?: string;
    readonly scheme?: string;
    readonly pattern?: string | { readonly base: string; readonly pattern: string };
    readonly notebookType?: string;
    readonly exclusive?: boolean;
}

/** Sent with the registration: the core reads them from matching providers without RPC. */
export interface IWireLanguageProviderMetadata {
    readonly triggerCharacters?: readonly string[];
    /** Characters that re-request the hint while it is shown (signature help). */
    readonly retriggerCharacters?: readonly string[];
    /** The core skips a provider whose kinds do not intersect the requested `only`. */
    readonly providedCodeActionKinds?: readonly string[];
    readonly legend?: IWireSemanticTokensLegend;
    /** The event arrives as a `languages.didChangeSemanticTokens` notification. */
    readonly hasOnDidChange?: boolean;
}

export interface IWireLanguageProviderRegistration extends IWireLanguageProviderMetadata {
    readonly handle: number;
    readonly kind: WireLanguageFeatureKind;
    readonly selector: readonly IWireLanguageFilter[];
}

/** `vscode.LanguageStatusSeverity`: 0 Information, 1 Warning, 2 Error. */
export type WireLanguageStatusSeverity = 0 | 1 | 2;

/**
 * Full-state upsert on creation and on every change of a `vscode.LanguageStatusItem`, like upstream's
 * `$setLanguageStatus`; removed by `languages.statusItem.dispose` with the same `handle`.
 */
export interface IWireLanguageStatusItem {
    readonly handle: number;
    /** `<extension id>/<item id>`, as upstream's `fullyQualifiedId`. */
    readonly id: string;
    /** The owning extension's id: the second sort key after severity. */
    readonly source: string;
    readonly selector: readonly IWireLanguageFilter[];
    readonly name?: string;
    /** With `$(name)` icon markup. */
    readonly text: string;
    readonly detail?: string;
    readonly severity: WireLanguageStatusSeverity;
    readonly busy: boolean;
    readonly command?: IWireLanguageStatusCommand;
}

export interface IWireLanguageStatusCommand {
    readonly command: string;
    readonly title: string;
    readonly arguments?: readonly unknown[];
}

/** A layer over `language-configuration.json`; removed via `languages.unsetLanguageConfiguration` with the same `handle`. */
export interface IWireLanguageConfiguration {
    readonly handle: number;
    readonly languageId: string;
    /** Only the sections the core can apply, in file format (`notIn` as strings). */
    readonly configuration: ILanguageConfiguration;
}

export interface IWireLanguageProviderUnregistration {
    readonly handle: number;
}

export interface IWireReferenceParams extends IWirePositionParams, IWireProviderHandle {
    readonly includeDeclaration: boolean;
}

/** `activeSignatureHelp` is what is shown now: the server uses it to keep the selected overload. */
export interface IWireSignatureHelpParams extends IWirePositionParams, IWireProviderHandle {
    readonly triggerKind: SignatureHelpTriggerKind;
    readonly triggerCharacter?: string;
    readonly isRetrigger: boolean;
    readonly activeSignatureHelp?: ICoreSignatureHelp;
}

/** With `range` — a range provider (Format Selection); without — a document provider. */
export interface IWireFormattingParams extends IWireDocumentParams {
    readonly handle: number;
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    readonly range?: IRange;
}

/**
 * Context diagnostics are not sent: the subprocess collects them from its own
 * DiagnosticCollections so the provider gets the same objects the server published.
 */
export interface IWireCodeActionParams extends IWireDocumentParams, IWireProviderHandle {
    readonly range: IRange;
    readonly only?: string;
}

/** The edits stay in the subprocess cache. */
export interface WireCodeAction {
    /** `"<cacheId>.<index>"` for `languages.applyCodeAction`. */
    readonly id: string;
    readonly title: string;
    readonly kind?: string;
    readonly isPreferred?: boolean;
    /** The action is shown but cannot be applied. */
    readonly disabled?: string;
}

export type IWirePrepareRenameParams = IWirePositionParams & IWireProviderHandle;

export interface IWireRenameParams extends IWirePositionParams, IWireProviderHandle {
    readonly newName: string;
}

/** Both fields absent — the provider has nothing to say. */
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
    /** Percent; the consumer accumulates them, clamped to 0–100. */
    readonly increment?: number;
}

export interface IWireProgressEnd {
    readonly handle: number;
}

/**
 * Full-state upsert on `show()` and on every change to a SHOWN item;
 * an item created but never shown does not appear on the wire.
 */
export interface IWireStatusBarItem {
    readonly handle: number;
    /** The host adds its own prefix so an extension item cannot collide with a built-in segment. */
    readonly id: string;
    readonly alignment: "left" | "right";
    /** Higher goes further left; `undefined` goes right of all prioritized items, as in VS Code. */
    readonly priority?: number;
    /** With `$(name)` icon markup. */
    readonly text: string;
    /** Without it the item is not listed in the status bar visibility menu. */
    readonly name?: string;
    readonly command?: string;
    readonly arguments?: readonly unknown[];
}

/** Also sent for `hide()`. */
export interface IWireStatusBarItemDispose {
    readonly handle: number;
}

export type WireOutputLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface IWireOutputAppend {
    readonly channel: string;
    /** The channel registers lazily, on its first line. */
    readonly label: string;
    readonly level: WireOutputLevel;
    readonly value: string;
}

export interface IWireOutputShow {
    readonly channel: string;
    /** `show` may arrive before the first line; the channel registers lazily. */
    readonly label: string;
}

// The host mints the `id` of every terminal instance, the subprocess mints `extHostId` for
// its own (upstream `extHostTerminalId`); until `terminal.opened` arrives, the subprocess
// addresses its terminal by `extHostId`.

export type IWireTerminalRef = { readonly id: number } | { readonly extHostId: number };

/** String `shellArgs` (Windows form) never reach here — the subprocess splits them on spaces. */
export interface IWireTerminalCreate {
    readonly extHostId: number;
    /**
     * The extension owns the process (`ExtensionTerminalOptions.pty`): the host holds
     * only the emulator, bytes travel via `terminal.pty.*`, shell options are not sent.
     */
    readonly pty?: true;
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    /** `null` removes the variable from the shell environment (`TerminalOptions.env` semantics). */
    readonly env?: Readonly<Record<string, string | null>>;
    readonly strictEnv?: boolean;
    readonly hideFromUser?: boolean;
    readonly message?: string;
    /** Absent means `terminal.integrated.defaultLocation`. */
    readonly location?: IWireTerminalLocation;
}

/**
 * Upstream `_serializeParentTerminal`: 1 = panel, 2 = editor area (`vscode.TerminalLocation`);
 * `viewColumn` is a `vscode.ViewColumn`.
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

/** The host normalizes Enter. */
export interface IWireTerminalSendText {
    readonly terminal: IWireTerminalRef;
    readonly text: string;
    readonly shouldExecute: boolean;
}

/** `creationOptions` of a terminal the subprocess did not create. */
export interface IWireTerminalLaunch {
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | null>>;
    readonly hideFromUser?: boolean;
}

/** `extHostId` only for this subprocess's terminals; `pid` only for a real shell. */
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

/** `terminal.pty.start`: the emulator is attached, time to call `pty.open`; `terminal.pty.resize`: `pty.setDimensions`. */
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

/** Fields are read via optional chaining: a primitive lacks them just like `null` does. */
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

/** An unfamiliar reason (newer host) becomes `unknown`. */
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

/** `severity` is `vscode.DiagnosticSeverity` (0=Error…3=Hint); the sink's consumer maps it to `MarkerSeverity`. */
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

/** Markers not from the subprocess's collections (settings, tasks): a full replacement set; empty means none remain. */
export interface IWireForeignMarkers {
    readonly resource: string;
    readonly markers: readonly WireMarker[];
}

/** Upstream `$acceptMarkersChange`. */
export interface IWireMarkersChanged {
    readonly entries: readonly IWireForeignMarkers[];
}

/** 0-based; anchor is the selection anchor, active is the cursor. */
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
    /** Upstream `documentVersionId`: an edit built on another version of the document is refused. */
    readonly version?: number;
    readonly setEndOfLine?: 1 | 2;
    readonly undoStopBefore?: boolean;
    readonly undoStopAfter?: boolean;
}

export interface IWireSetSelectionParams {
    readonly uri: string;
    readonly selections: readonly IWireSelection[];
    /** A `TextEditor` is addressed by the group + document pair. */
    readonly groupId: number;
}

/** A normalized `TextEditor.options` patch; `indentSize` is an alias of `tabSize`. */
export interface IWireSetEditorOptionsParams {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
    readonly indentSize?: number;
    /** `vscode.TextEditorCursorStyle`, 1..6: applies to the editor at `uri` + `groupId`, not the active one. */
    readonly cursorStyle?: number;
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

/** `vscode.TextEditorSelectionChangeKind`; absent when the source is unrecognized (`kind` is optional upstream). */
export type WireSelectionChangeKind = 1 | 2 | 3;

export function selectionChangeKindOf(source: CursorChangeSource | undefined): WireSelectionChangeKind | undefined {
    switch (source) {
        case "keyboard":
            return 1;
        case "mouse":
            return 2;
        case "command":
            return 3;
        // Stryker disable next-line ConditionalExpression: the mutant removes `default`,
        // but the function still returns undefined by falling out of the switch —
        // an equivalent mutant that no test can distinguish.
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
 * Order matters: "Move to a new file" creates a file and immediately writes to it. Without
 * `overwrite`/`ignoreIfExists` a collision rejects the whole edit; `contents` is UTF-8.
 */
export type IWireWorkspaceEditOp =
    | ({ readonly kind: "text"; readonly setEndOfLine?: 1 | 2 } & IWireResourceTextEdits)
    | {
          readonly kind: "create";
          readonly resource: string;
          readonly contents?: string;
          /** Bytes that are not valid UTF-8 and would not survive {@link contents}. */
          readonly contentsBase64?: string;
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
    /** After applying, affected files are saved per `files.refactoring.autoSave`. */
    readonly isRefactoring?: boolean;
}

export interface IWireSaveAllParams {
    readonly includeUntitled?: boolean;
}

/** `null` when not open or not saved (upstream's `undefined`). */
export type IWireSaveResult = IWireUriParams | null;

/** A bare `string` in the same fields is a CSS color the host ignores: inline hex colors are not parsed. */
export interface ISerializedThemeColor {
    readonly $themeColor: string;
}

export type SerializedColor = string | ISerializedThemeColor;

/**
 * Only the fields the host projects: `overviewRulerColor` makes the type a
 * "gutter change-bar"; other CSS fields are not rendered in the TUI.
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
    /** The host currently decorates the resource in all groups and ignores this field. */
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

/** Base64: a `Uint8Array` does not survive a JSON round-trip. */
export interface IWireReadFileResult {
    content: string;
}

/** `content` is base64. */
export interface IWireWriteFileParams {
    readonly uri: string;
    readonly content: string;
}

/** `vscode.FileStat` without `permissions`. */
export interface IWireFileStat {
    readonly type: number;
    readonly ctime: number;
    readonly mtime: number;
    readonly size: number;
}

/** `readonly` is the subset of `schemes` without write support (`isReadonly` or no `writeFile`). */
export interface IWireFileSystemSchemes extends IWireSchemes {
    readonly readonly?: readonly string[];
}

/** A string, not base64: the provider returns text. `null` means the scheme provider declined to provide the resource. */
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
 * `pattern` is a glob relative to `base` (a `RelativePattern` pair): the subprocess converts
 * a string `GlobPattern` to it itself, substituting the workspace folder.
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

/** Malformed entries are silently dropped. */
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
 * Only `kind` is sent: the theme name is not promised to extensions. Also seeded at handshake —
 * `activeColorTheme` must be correct already in `activate()`.
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

// A quick input session is addressed by `handle` (a counter shared with window.progress.*):
// the extension uses it to cancel the prompt with its token, and the host to request validation.

export type WireValidationSeverity = "error" | "warning" | "info";

export interface IWireInputBoxRequest {
    readonly handle: number;
    readonly title?: string;
    readonly prompt?: string;
    readonly placeHolder?: string;
    readonly value?: string;
    readonly password: boolean;
    /** Without the flag the host skips the `window.inputBox.validate` round-trip. */
    readonly validates: boolean;
}

/** Only what a single-line row can show. */
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
    /** Empty without `canPickMany`. */
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

/** `null` means the user cancelled. */
export interface IWireInputBoxResult {
    readonly value: string | null;
}

/**
 * Indices into the extension's `items`, not the items: `showQuickPick<T>` must return
 * ITS OWN objects. `null` means cancelled.
 */
export interface IWireQuickPickResult {
    readonly indices: readonly number[] | null;
}

export function parseWireInputBoxResult(raw: unknown): IWireInputBoxResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the check below rejects a non-object anyway (it lacks the needed field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return { value: null };
    const { value } = raw as { value?: unknown };
    return { value: typeof value === "string" ? value : null };
}

export function parseWireQuickPickResult(raw: unknown): IWireQuickPickResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the check below rejects a non-object anyway (it lacks the needed field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return { indices: null };
    const { indices } = raw as { indices?: unknown };
    if (!Array.isArray(indices)) return { indices: null };
    return { indices: indices.filter((i): i is number => Number.isInteger(i) && i >= 0) };
}

// Upstream shape (`$createOrUpdate`/`$onDid*`): properties travel as a DIFF, user actions
// as events; `handle` is a counter shared with `showQuickPick` prompts.

/**
 * `handle` is an index into the extension's `items`: separators are not sent, so positions diverge.
 * `detail` is needed for filtering (`matchOnDetail`) even when it is not visible on screen.
 */
export interface IWireQuickPickSessionItem {
    readonly handle: number;
    readonly label: string;
    readonly description?: string;
    readonly detail?: string;
    readonly alwaysShow?: boolean;
}

/** Absent means "untouched", `null` means "reset to `undefined`" (upstream `_pendingUpdate`). */
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
    /** Item handles. */
    readonly activeItems?: readonly number[];
    /** Item handles. */
    readonly selectedItems?: readonly number[];
}

export interface IWireQuickPickDispose {
    readonly handle: number;
}

/** Upstream `$onDid*` as a single notification. */
export type IWireQuickPickEvent =
    | { readonly handle: number; readonly kind: "changeValue"; readonly value: string }
    | { readonly handle: number; readonly kind: "accept" }
    | { readonly handle: number; readonly kind: "changeActive"; readonly items: readonly number[] }
    | { readonly handle: number; readonly kind: "changeSelection"; readonly items: readonly number[] }
    | { readonly handle: number; readonly kind: "hide" };

export function parseWireQuickPickEvent(raw: unknown): IWireQuickPickEvent | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the check below rejects a non-object anyway (it lacks the needed field), so replacing the operand with `false` has no observable effect
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

/** Dialog filter: the extension's `{ "Images": ["png", "jpg"] }` as an array of pairs. */
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

/** Upstream checks have already passed; `folders` is the resulting `fsPath` set, the host opens it only if there is a single folder. */
export interface IWireUpdateWorkspaceFolders {
    readonly extensionId: string | null;
    readonly folders: readonly string[];
}

// A message with buttons is a request: it waits for a choice. There is no prompt address:
// `show*Message` has no cancellation token.

export type WireMessageSeverity = "error" | "warn" | "info";

export interface IWireMessageItem {
    readonly title: string;
    /** Returned when a modal message is dismissed with Escape; ignored for non-modal ones (as upstream). */
    readonly isCloseAffordance: boolean;
}

export interface IWireShowMessageRequest {
    readonly severity: WireMessageSeverity;
    readonly message: string;
    /** Modal only. */
    readonly detail?: string;
    readonly modal: boolean;
    readonly items: readonly IWireMessageItem[];
}

/** An index into `items`, not the item: the extension gets back ITS OWN object. `null` means dismissed without a choice. */
export interface IWireShowMessageResult {
    readonly index: number | null;
}

export function parseWireShowMessageResult(raw: unknown): IWireShowMessageResult {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the check below rejects a non-object anyway (it lacks the needed field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return { index: null };
    const { index } = raw as { index?: unknown };
    if (!Number.isInteger(index)) return { index: null };
    const value = index as number;
    return { index: value >= 0 ? value : null };
}

// Clipboard and links live on the host: it owns the terminal (OSC 52) and the right to launch the system handler.

export interface IWireClipboardText {
    readonly text: string;
}

export function parseWireClipboardText(raw: unknown): IWireClipboardText {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the check below rejects a non-object anyway (it lacks the needed field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return { text: "" };
    const { text } = raw as { text?: unknown };
    return { text: typeof text === "string" ? text : "" };
}

/** Arrives before the first activation: `env.machineId`, `env.shell` and `env.appRoot` are synchronous and read already in `activate()`. */
export interface IWireEnvInitialize {
    readonly machineId: string;
    readonly shell: string;
    readonly appRoot: string;
}

/** A non-string becomes an empty string, like upstream's "unknown". */
export function parseWireEnvInitialize(raw: unknown): IWireEnvInitialize {
    const { machineId, shell, appRoot } = (typeof raw === "object" && raw !== null ? raw : {}) as {
        machineId?: unknown;
        shell?: unknown;
        appRoot?: unknown;
    };
    return {
        machineId: typeof machineId === "string" ? machineId : "",
        shell: typeof shell === "string" ? shell : "",
        appRoot: typeof appRoot === "string" ? appRoot : "",
    };
}

export interface IWireEnvironmentVariableCollections {
    readonly collections: readonly (readonly [string, SerializableEnvironmentVariableCollection])[];
}

/** Without `collection` it is empty. */
export interface IWireSetEnvironmentVariableCollection {
    readonly extensionId: string;
    readonly persistent: boolean;
    readonly collection?: SerializableEnvironmentVariableCollection;
    readonly description: SerializableEnvironmentDescriptionMap;
}

/** Replace, Append, Prepend as numbers: the enum would pull the merge module into the subprocess bundle (lazy chunk budget). */
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
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the check below rejects a non-object anyway (it lacks the needed field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return false;
    return (raw as { opened?: unknown }).opened === true;
}

// A secret is addressed by "extension id + key": each extension has its own slot, as upstream.

export interface IWireSecretRef {
    readonly extensionId: string;
    readonly key: string;
}

export interface IWireSecretWrite extends IWireSecretRef {
    readonly value: string;
}

export function parseWireSecretRef(raw: unknown): IWireSecretRef | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the field checks below reject a non-object anyway
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

/** The whole dictionary; `shared` means `globalState`, otherwise `workspaceState`. */
export interface IWireMementoUpdate {
    readonly extensionId: string;
    readonly shared: boolean;
    readonly value: Readonly<Record<string, unknown>>;
}

export function parseWireMementoValue(raw: unknown): Readonly<Record<string, unknown>> {
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function parseWireSecretValue(raw: unknown): string | undefined {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the field check below rejects a non-object anyway
    if (typeof raw !== "object" || raw === null) return undefined;
    const { value } = raw as { value?: unknown };
    return typeof value === "string" ? value : undefined;
}

export function parseWireSecretKeys(raw: unknown): string[] {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the field check below rejects a non-object anyway
    if (typeof raw !== "object" || raw === null) return [];
    const { keys } = raw as { keys?: unknown };
    if (!Array.isArray(keys)) return [];
    return keys.filter((k): k is string => typeof k === "string");
}

/**
 * `exports` do not travel over the wire (`activate()` provides them in the subprocess); without
 * a remote extension host `extensionKind` is always `UI`, a subprocess constant.
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

/** Invalid entries are dropped one by one: losing one neighbor beats losing all. */
export function parseWireExtensionCatalog(raw: unknown): IWireExtensionCatalog | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the field check below rejects a non-object anyway
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
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast path; the field check below rejects a non-object anyway
    if (typeof raw !== "object" || raw === null) return null;
    const { id } = raw as { id?: unknown };
    return typeof id === "string" && id !== "" ? id : null;
}

export interface IWireExtensionId {
    readonly id: string;
}

/** Exactly one of `mainPath`/`source` (`source` also needs `filename`); the receiver validates. */
export interface IWireActivateExtensionParams {
    readonly id: string;
    readonly mainPath?: string;
    readonly source?: string;
    readonly filename?: string;
    /** `"type"` from package.json as is: the side parsing the params normalizes it. */
    readonly moduleType: unknown;
    readonly extensionPath?: string;
    readonly globalStoragePath: string;
    /** `null` when no folder is open. */
    readonly storagePath: string | null;
    readonly logPath: string;
    /** `get` is synchronous for the extension. */
    readonly globalState: Readonly<Record<string, unknown>>;
    readonly workspaceState: Readonly<Record<string, unknown>>;
}

/** Both directions: the host also executes commands registered by extensions. */
export interface IWireExecuteCommandParams {
    readonly id: string;
    readonly args: readonly unknown[];
}

export interface IWireCommandId {
    readonly id: string;
}

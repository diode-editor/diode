import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreRenameLocation } from "../../../../editor/common/languages/iRenameSource.ts";
import type {
    ISemanticTokens,
    ISemanticTokensEdits,
} from "../../../../editor/common/languages/iSemanticTokensSource.ts";
import { createFoldingRegion, type IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
import type { IStat } from "../../../../platform/files/common/files.ts";
import type {
    IEnvironmentVariableCollectionDescription,
    IEnvironmentVariableMutator,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import type {
    IWireShellQuotedString,
    IWireShellQuotingOptions,
    IWireTask,
    IWireTaskDefinition,
    IWireTaskExecutionId,
    IWireTaskFilter,
    IWireTaskPresentation,
    IWireTaskProviderHandle,
    IWireTaskProviderRegistration,
    WireTaskExecuteRequest,
    WireTaskExecutionKind,
} from "../../../api/common/taskWireTypes.ts";
import {
    isFiniteNumber,
    type IWireCloseGroupsParams,
    type IWireCloseTabsParams,
    type IWireConfigurationUpdate,
    type IWireCreateUntitledParams,
    type IWireDiagnosticsPublish,
    type IWireDialogFilter,
    type IWireEditorEdit,
    type IWireFileDecoration,
    type IWireInputBoxRequest,
    type IWireLanguageConfiguration,
    type IWireLanguageFilter,
    type IWireLanguageProviderRegistration,
    type IWireLanguageProviderUnregistration,
    type IWireLanguageStatusCommand,
    type IWireLanguageStatusItem,
    type IWireMementoUpdate,
    type IWireMessageItem,
    type IWireOpenDialogRequest,
    type IWireOutputAppend,
    type IWireOutputShow,
    type IWireProgressEnd,
    type IWireProgressReport,
    type IWireProgressStart,
    type IWireProviderHandle,
    type IWireQuickPickItem,
    type IWireQuickPickRequest,
    type IWireQuickPickSessionItem,
    type IWireQuickPickUpdate,
    type IWireSaveDialogRequest,
    type IWireSecretWrite,
    type IWireSemanticTokensLegend,
    type IWireShowMessageRequest,
    type IWireShowTextDocumentParams,
    type IWireStatusBarItem,
    type IWireStatusBarItemDispose,
    type IWireTerminalCreate,
    type IWireTerminalLocation,
    type IWireTerminalPtyData,
    type IWireTerminalPtyExit,
    type IWireTerminalRef,
    type IWireTerminalSendText,
    type IWireTerminalShow,
    type IWireTerminalTarget,
    type IWireUpdateWorkspaceFolders,
    type IWireValidationMessage,
    type IWireWatcherCreate,
    type IWireWorkspaceEditOp,
    parseRange,
    parseWireEnvironmentDescriptions,
    parseWireEnvironmentVariableEntries,
    parseWireSecretRef,
    parseWireSelections,
    parseWireStringArray,
    parseWireStringRecord,
    type SerializedColor,
    WIRE_LANGUAGE_FEATURE_KINDS,
    type WireConfigurationTarget,
    type WireFoldingRange,
    type WireLanguageFeatureKind,
    type WireLanguageStatusSeverity,
    type WireMarker,
    type WireMessageSeverity,
    type WireOutputLevel,
    type WireRenamePrepare,
    type WireSemanticTokensResult,
    type WireValidationSeverity,
} from "../../../api/common/wireTypes.ts";

export function parseWireShowTextDocumentParams(raw: unknown): IWireShowTextDocumentParams | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.uri !== "string" || obj.uri === "") return null;
    const selections = Array.isArray(obj.selection) ? null : obj.selection;
    return {
        uri: obj.uri,
        ...(isFiniteNumber(obj.viewColumn) ? { viewColumn: obj.viewColumn } : {}),
        ...(typeof obj.preserveFocus === "boolean" ? { preserveFocus: obj.preserveFocus } : {}),
        ...(typeof selections === "object" && selections !== null
            ? { selection: parseWireSelections([selections])[0] }
            : {}),
    };
}

/** A field of the wrong shape is dropped. */
export function parseWireCreateUntitledParams(raw: unknown): IWireCreateUntitledParams {
    // Primitives aren't rejected separately: their fields read as undefined.
    const obj = (raw ?? {}) as Record<string, unknown>;
    return {
        ...(typeof obj.content === "string" ? { content: obj.content } : {}),
        ...(typeof obj.language === "string" ? { language: obj.language } : {}),
        ...(typeof obj.encoding === "string" ? { encoding: obj.encoding } : {}),
    };
}

export function parseWireCloseTabsParams(raw: unknown): IWireCloseTabsParams | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.tabs)) return null;
    const tabs: { groupId: number; uri: string }[] = [];
    for (const rawTab of obj.tabs as unknown[]) {
        if (typeof rawTab !== "object" || rawTab === null) return null;
        const t = rawTab as Record<string, unknown>;
        if (!isFiniteNumber(t.groupId) || typeof t.uri !== "string") return null;
        tabs.push({ groupId: t.groupId, uri: t.uri });
    }
    return { tabs };
}

export function parseWireCloseGroupsParams(raw: unknown): IWireCloseGroupsParams | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.groupIds) || !(obj.groupIds as unknown[]).every((id) => isFiniteNumber(id))) return null;
    return { groupIds: obj.groupIds as number[] };
}

/** Regions arrive expanded: the merge by `startLine` in the editor restores `isCollapsed`. */
export function wireToCoreFoldingRegions(wire: readonly WireFoldingRange[]): IFoldingRegion[] {
    const regions: IFoldingRegion[] = [];
    for (const range of wire) {
        const start = Math.max(0, Math.floor(range.start));
        const end = Math.floor(range.end);
        if (end <= start) continue;
        regions.push(createFoldingRegion(start, end, false));
    }
    return regions;
}

function isWireLanguageFeatureKind(value: unknown): value is WireLanguageFeatureKind {
    return (WIRE_LANGUAGE_FEATURE_KINDS as readonly unknown[]).includes(value);
}

/** Validates one filter: fields of a foreign type are dropped rather than failing the whole selector. */
function parseWireLanguageFilter(raw: unknown): IWireLanguageFilter | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const pattern = obj.pattern;
    let wirePattern: IWireLanguageFilter["pattern"];
    if (typeof pattern === "string") {
        wirePattern = pattern;
    } else if (typeof pattern === "object" && pattern !== null) {
        const relative = pattern as Record<string, unknown>;
        if (typeof relative.base === "string" && typeof relative.pattern === "string") {
            wirePattern = { base: relative.base, pattern: relative.pattern };
        }
    }
    return {
        ...(typeof obj.language === "string" ? { language: obj.language } : {}),
        ...(typeof obj.scheme === "string" ? { scheme: obj.scheme } : {}),
        ...(wirePattern === undefined ? {} : { pattern: wirePattern }),
        ...(typeof obj.notebookType === "string" ? { notebookType: obj.notebookType } : {}),
        ...(obj.exclusive === true ? { exclusive: true } : {}),
    };
}

function isWireHandle(value: unknown): value is number {
    return Number.isInteger(value);
}

/** Sections aren't validated: the garbage-tolerant `resolveLanguageConfiguration` unpacks them. */
export function parseWireLanguageConfiguration(raw: unknown): IWireLanguageConfiguration | null {
    const p = raw as Partial<Record<keyof IWireLanguageConfiguration, unknown>> | null | undefined;
    const configuration = p?.configuration;
    if (!isWireHandle(p?.handle) || typeof p.languageId !== "string") return null;
    if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) return null;
    return { handle: p.handle, languageId: p.languageId, configuration };
}

export function parseWireLanguageProviderRegistration(raw: unknown): IWireLanguageProviderRegistration | null {
    // The handle check below filters primitives: their fields read as undefined.
    if (raw === null || raw === undefined) return null;
    const obj = raw as Record<string, unknown>;
    if (!isWireHandle(obj.handle) || !isWireLanguageFeatureKind(obj.kind) || !Array.isArray(obj.selector)) {
        return null;
    }
    return {
        handle: obj.handle,
        kind: obj.kind,
        selector: parseWireSelector(obj.selector),
        ...(Array.isArray(obj.triggerCharacters)
            ? { triggerCharacters: readWireCharacters(obj.triggerCharacters) }
            : {}),
        ...(Array.isArray(obj.retriggerCharacters)
            ? { retriggerCharacters: readWireCharacters(obj.retriggerCharacters) }
            : {}),
        ...(Array.isArray(obj.providedCodeActionKinds)
            ? { providedCodeActionKinds: readWireCharacters(obj.providedCodeActionKinds) }
            : {}),
        ...readWireLegend(obj.legend),
        ...(obj.hasOnDidChange === true ? { hasOnDidChange: true } : {}),
    };
}

/**
 * The index in `tokenTypes` and the bit in `tokenModifiers` are positional: a non-string element becomes an empty
 * string instead of being dropped.
 */
function readWireLegend(raw: unknown): { legend?: IWireSemanticTokensLegend } {
    if (raw === null || typeof raw !== "object") return {};
    const { tokenTypes, tokenModifiers } = raw as Record<string, unknown>;
    const strings = (list: unknown): string[] =>
        Array.isArray(list) ? list.map((item: unknown) => (typeof item === "string" ? item : "")) : [];
    return { legend: { tokenTypes: strings(tokenTypes), tokenModifiers: strings(tokenModifiers) } };
}

function parseWireSelector(raw: readonly unknown[]): IWireLanguageFilter[] {
    const selector: IWireLanguageFilter[] = [];
    for (const item of raw) {
        const filter = parseWireLanguageFilter(item);
        if (filter !== null) selector.push(filter);
    }
    return selector;
}

/** An unknown severity reads as Information, a command without a string id is dropped. */
export function parseWireLanguageStatusItem(raw: unknown): IWireLanguageStatusItem | null {
    // The handle check filters primitives too: their fields read as undefined.
    const p = raw as Record<string, unknown> | null | undefined;
    if (!isWireHandle(p?.handle) || typeof p.id !== "string" || !Array.isArray(p.selector)) return null;
    const command = parseWireLanguageStatusCommand(p.command);
    return {
        handle: p.handle,
        id: p.id,
        source: typeof p.source === "string" ? p.source : "",
        selector: parseWireSelector(p.selector),
        text: typeof p.text === "string" ? p.text : "",
        severity: p.severity === 1 || p.severity === 2 ? (p.severity as WireLanguageStatusSeverity) : 0,
        busy: p.busy === true,
        ...(typeof p.name === "string" ? { name: p.name } : {}),
        ...(typeof p.detail === "string" && p.detail !== "" ? { detail: p.detail } : {}),
        ...(command === null ? {} : { command }),
    };
}

function parseWireLanguageStatusCommand(raw: unknown): IWireLanguageStatusCommand | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.command !== "string" || p.command === "") return null;
    return {
        command: p.command,
        title: typeof p.title === "string" ? p.title : "",
        ...(Array.isArray(p.arguments) ? { arguments: p.arguments as readonly unknown[] } : {}),
    };
}

export function parseWireProviderHandle(raw: unknown): IWireProviderHandle | null {
    const handle = (raw as Record<string, unknown> | null | undefined)?.handle;
    return isWireHandle(handle) ? { handle } : null;
}

/**
 * The response id goes as a string in `resultId`: the core returns it as `previousResultId` (like upstream
 * `MainThreadDocumentSemanticTokensProvider`).
 */
export function wireToCoreSemanticTokens(
    result: WireSemanticTokensResult | null,
): ISemanticTokens | ISemanticTokensEdits | null {
    if (result === null) return null;
    const resultId = String(result.id);
    if (result.type === "full") return { resultId, data: new Uint32Array(result.data) };
    return {
        resultId,
        edits: result.deltas.map((edit) => ({
            start: edit.start,
            deleteCount: edit.deleteCount,
            data: edit.data === undefined ? undefined : new Uint32Array(edit.data),
        })),
    };
}

function readWireCharacters(raw: readonly unknown[]): string[] {
    return raw.filter((item): item is string => typeof item === "string" && item !== "");
}

export function parseWireLanguageProviderUnregistration(raw: unknown): IWireLanguageProviderUnregistration | null {
    const handle = (raw as Record<string, unknown> | null | undefined)?.handle;
    return isWireHandle(handle) ? { handle } : null;
}

/**
 * A rejection beats the name: a provider that said "not here" must not open the input
 * box because of a placeholder sent along. `null` means the core asks the next provider.
 */
export function wireToCoreRenameLocation(wire: WireRenamePrepare): ICoreRenameLocation | null {
    if (wire.rejectReason !== undefined) return { kind: "reject", reason: wire.rejectReason };
    if (wire.placeholder !== undefined) return { kind: "name", name: wire.placeholder };
    return null;
}

export function parseWireProgressStart(raw: unknown): IWireProgressStart | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    if (typeof p.title !== "string") return null;
    return { handle: p.handle, title: p.title };
}

export function parseWireProgressReport(raw: unknown): IWireProgressReport | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    return {
        handle: p.handle,
        ...(typeof p.message === "string" ? { message: p.message } : {}),
        ...(isFiniteNumber(p.increment) ? { increment: p.increment } : {}),
    };
}

export function parseWireProgressEnd(raw: unknown): IWireProgressEnd | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    return { handle: p.handle };
}

export function parseWireStatusBarItem(raw: unknown): IWireStatusBarItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    if (typeof p.id !== "string" || p.id === "") return null;
    if (p.alignment !== "left" && p.alignment !== "right") return null;
    if (typeof p.text !== "string") return null;
    return {
        handle: p.handle,
        id: p.id,
        alignment: p.alignment,
        text: p.text,
        ...(isFiniteNumber(p.priority) ? { priority: p.priority } : {}),
        ...(typeof p.name === "string" && p.name !== "" ? { name: p.name } : {}),
        ...(typeof p.command === "string" && p.command !== "" ? { command: p.command } : {}),
        ...(Array.isArray(p.arguments) ? { arguments: p.arguments as readonly unknown[] } : {}),
    };
}

export function parseWireStatusBarItemDispose(raw: unknown): IWireStatusBarItemDispose | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    return { handle: p.handle };
}

function parseWireTerminalRef(raw: unknown): IWireTerminalRef | null {
    const p = raw as TerminalEnvelope;
    if (isFiniteNumber(p?.id)) return { id: p.id };
    if (isFiniteNumber(p?.extHostId)) return { extHostId: p.extHostId };
    return null;
}

type TerminalEnvelope = Readonly<Record<string, unknown>> | null | undefined;

/** Empty strings mean "not set". */
export function parseWireTerminalCreate(raw: unknown): IWireTerminalCreate | null {
    const p = raw as TerminalEnvelope;
    if (!isFiniteNumber(p?.extHostId)) return null;
    // Extension pty: there is no process on our side, so shell options don't apply.
    const location = parseWireTerminalLocation(p.location);
    if (p.pty === true) {
        return {
            extHostId: p.extHostId,
            pty: true,
            ...(typeof p.name === "string" && p.name !== "" ? { name: p.name } : {}),
            ...(location !== undefined ? { location } : {}),
        };
    }
    const shellArgs = parseWireStringArray(p.shellArgs);
    const env = parseWireStringRecord(p.env);
    return {
        extHostId: p.extHostId,
        ...(typeof p.name === "string" && p.name !== "" ? { name: p.name } : {}),
        ...(typeof p.shellPath === "string" && p.shellPath !== "" ? { shellPath: p.shellPath } : {}),
        ...(shellArgs !== undefined ? { shellArgs } : {}),
        ...(typeof p.cwd === "string" && p.cwd !== "" ? { cwd: p.cwd } : {}),
        ...(env !== undefined ? { env } : {}),
        ...(p.strictEnv === true ? { strictEnv: true } : {}),
        ...(p.hideFromUser === true ? { hideFromUser: true } : {}),
        ...(typeof p.message === "string" ? { message: p.message } : {}),
        ...(location !== undefined ? { location } : {}),
    };
}

/** Anything unrecognized means "not set": the terminal is placed per the setting. */
function parseWireTerminalLocation(raw: unknown): IWireTerminalLocation | undefined {
    if (raw === 1 || raw === 2) return raw;
    const p = raw as TerminalEnvelope;
    if (isFiniteNumber(p?.viewColumn)) {
        return { viewColumn: p.viewColumn, ...(p.preserveFocus === true ? { preserveFocus: true } : {}) };
    }
    const parentTerminal = parseWireTerminalRef(p?.parentTerminal);
    return parentTerminal === null ? undefined : { parentTerminal };
}

export function parseWireTerminalTarget(raw: unknown): IWireTerminalTarget | null {
    const terminal = parseWireTerminalRef((raw as TerminalEnvelope)?.terminal);
    return terminal === null ? null : { terminal };
}

export function parseWireTerminalShow(raw: unknown): IWireTerminalShow | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    return { terminal: target.terminal, preserveFocus: (raw as Record<string, unknown>).preserveFocus === true };
}

export function parseWireTerminalPtyData(raw: unknown): IWireTerminalPtyData | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    const { data } = raw as Record<string, unknown>;
    return typeof data === "string" ? { terminal: target.terminal, data } : null;
}

export function parseWireTerminalPtyExit(raw: unknown): IWireTerminalPtyExit | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    const { code } = raw as Record<string, unknown>;
    return { terminal: target.terminal, ...(isFiniteNumber(code) ? { code } : {}) };
}

export function parseWireTerminalSendText(raw: unknown): IWireTerminalSendText | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.text !== "string") return null;
    return { terminal: target.terminal, text: p.text, shouldExecute: p.shouldExecute !== false };
}

const WIRE_OUTPUT_LEVELS: readonly WireOutputLevel[] = ["trace", "debug", "info", "warn", "error"];

export function parseWireOutputAppend(raw: unknown): IWireOutputAppend | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.channel !== "string" || p.channel === "") return null;
    if (typeof p.label !== "string" || p.label === "") return null;
    // Stryker disable next-line ConditionalExpression: `typeof p.level !== "string"` → `false` is equivalent, `includes` over a list of strings is false for any non-string anyway; the second operand (`!includes` → `false`) is killed by the test with level "fatal"
    if (typeof p.level !== "string" || !WIRE_OUTPUT_LEVELS.includes(p.level as WireOutputLevel)) return null;
    if (typeof p.value !== "string") return null;
    return { channel: p.channel, label: p.label, level: p.level as WireOutputLevel, value: p.value };
}

export function parseWireOutputShow(raw: unknown): IWireOutputShow | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.channel !== "string" || p.channel === "") return null;
    if (typeof p.label !== "string" || p.label === "") return null;
    return { channel: p.channel, label: p.label };
}

function parseWireMarker(raw: unknown): WireMarker | null {
    if (typeof raw !== "object" || raw === null) return null;
    const m = raw as Record<string, unknown>;
    const range = parseRange(m.range);
    if (!isFiniteNumber(m.severity) || range === null || typeof m.message !== "string") {
        return null;
    }
    return {
        severity: m.severity,
        range,
        message: m.message,
        ...(typeof m.code === "string" ? { code: m.code } : {}),
        ...(typeof m.source === "string" ? { source: m.source } : {}),
    };
}

/** Invalid markers are dropped rather than failing the publish. */
export function parseWireDiagnosticsPublish(raw: unknown): IWireDiagnosticsPublish | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.owner !== "string" || p.owner === "") return null;
    if (typeof p.resource !== "string" || p.resource === "") return null;
    if (!Array.isArray(p.markers)) return null;
    const markers: WireMarker[] = [];
    for (const item of p.markers) {
        const parsed = parseWireMarker(item);
        if (parsed !== null) markers.push(parsed);
    }
    return { owner: p.owner, resource: p.resource, markers };
}

function parseWireEditorEdit(raw: unknown): IWireEditorEdit | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const range = parseRange(obj.range);
    if (range === null) return null;
    if (typeof obj.text !== "string") return null;
    return { range, text: obj.text };
}

export function parseWireEditorEdits(raw: unknown): IWireEditorEdit[] {
    if (!Array.isArray(raw)) return [];
    const result: IWireEditorEdit[] = [];
    for (const item of raw) {
        const parsed = parseWireEditorEdit(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

/**
 * A garbage operation drops the whole set: the edit applies all-or-nothing, silently losing one operation is worse
 * than an honest refusal.
 */
export function parseWireApplyWorkspaceEditParams(raw: unknown): IWireWorkspaceEditOp[] | null {
    // The same check filters primitives and `null`: they have no `ops` property.
    const list = (raw as { ops?: unknown } | null | undefined)?.ops;
    if (!Array.isArray(list)) return null;
    const result: IWireWorkspaceEditOp[] = [];
    for (const item of list) {
        const parsed = parseWireWorkspaceEditOp(item);
        if (parsed === null) return null;
        result.push(parsed);
    }
    return result;
}

function parseWireWorkspaceEditOp(raw: unknown): IWireWorkspaceEditOp | null {
    // A primitive's `kind` matches no kind, so no separate check is needed.
    if (raw === null || raw === undefined) return null;
    const obj = raw as Record<string, unknown>;
    if (obj.kind === "text") {
        if (typeof obj.resource !== "string") return null;
        const edits = parseWireEditorEdits(obj.edits);
        const setEndOfLine = obj.setEndOfLine === 1 || obj.setEndOfLine === 2 ? obj.setEndOfLine : undefined;
        if (edits.length === 0 && setEndOfLine === undefined) return null;
        return { kind: "text", resource: obj.resource, edits, ...(setEndOfLine === undefined ? {} : { setEndOfLine }) };
    }
    if (obj.kind === "create") {
        if (typeof obj.resource !== "string") return null;
        return {
            kind: "create",
            resource: obj.resource,
            ...(typeof obj.contents === "string" ? { contents: obj.contents } : {}),
            ...(typeof obj.contentsBase64 === "string" ? { contentsBase64: obj.contentsBase64 } : {}),
            ...(typeof obj.overwrite === "boolean" ? { overwrite: obj.overwrite } : {}),
            ...(obj.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
        };
    }
    if (obj.kind === "delete") {
        if (typeof obj.resource !== "string") return null;
        return {
            kind: "delete",
            resource: obj.resource,
            ...(obj.ignoreIfNotExists === true ? { ignoreIfNotExists: true } : {}),
        };
    }
    if (obj.kind === "rename") {
        if (typeof obj.from !== "string" || typeof obj.to !== "string") return null;
        return {
            kind: "rename",
            from: obj.from,
            to: obj.to,
            ...(typeof obj.overwrite === "boolean" ? { overwrite: obj.overwrite } : {}),
            ...(obj.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
        };
    }
    return null;
}

export function themeColorIdOf(value: SerializedColor | undefined): string | undefined {
    if (typeof value === "object" && typeof value.$themeColor === "string") {
        return value.$themeColor;
    }
    return undefined;
}

export function parseDecorationRanges(raw: unknown): IRange[] {
    if (!Array.isArray(raw)) return [];
    const result: IRange[] = [];
    for (const item of raw) {
        const parsed = parseRange(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

export function parseWireFileDecorations(raw: unknown): IWireFileDecoration[] {
    if (!Array.isArray(raw)) return [];
    const result: IWireFileDecoration[] = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null) continue;
        const d = item as { uri?: unknown; badge?: unknown; colorId?: unknown; propagate?: unknown };
        if (typeof d.uri !== "string" || d.uri === "") continue;
        result.push({
            uri: d.uri,
            ...(typeof d.badge === "string" ? { badge: d.badge } : {}),
            ...(typeof d.colorId === "string" ? { colorId: d.colorId } : {}),
            ...(typeof d.propagate === "boolean" ? { propagate: d.propagate } : {}),
        });
    }
    return result;
}

/** `null` when the resource doesn't exist; throws on a foreign shape. */
export function parseWireFileStat(raw: unknown): IStat | null {
    if (raw === null) return null;
    if (typeof raw !== "object") throw new Error("workspace.fs.stat: result must be an object");
    const { type, mtime, size } = raw as { type?: unknown; mtime?: unknown; size?: unknown };
    if (!isFiniteNumber(type) || !isFiniteNumber(mtime) || !isFiniteNumber(size)) {
        throw new Error("workspace.fs.stat: type, mtime and size must be numbers");
    }
    return { type, mtime, size };
}

export function parseWireReadFileResult(raw: unknown): Uint8Array {
    if (typeof raw !== "object" || raw === null) throw new Error("workspace.fs.readFile: result must be an object");
    const content = (raw as { content?: unknown }).content;
    if (typeof content !== "string") throw new Error("workspace.fs.readFile: content must be a base64 string");
    return new Uint8Array(Buffer.from(content, "base64"));
}

/** Throws on a foreign response: the core needs to tell "the provider said no" (`null`) from "the channel broke". */
export function parseWireTextContentResult(raw: unknown): string | null {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("workspace.provideTextDocumentContent: result must be an object");
    }
    const content = (raw as { content?: unknown }).content;
    if (content === null || content === undefined) return null;
    if (typeof content !== "string") {
        throw new Error("workspace.provideTextDocumentContent: content must be a string or null");
    }
    return content;
}

export function parseWireSchemes(raw: unknown): string[] {
    const schemes = (raw as { schemes?: unknown } | null)?.schemes;
    if (!Array.isArray(schemes)) return [];
    return schemes.filter((s): s is string => typeof s === "string");
}

/**
 * Without the `readonly` field (old subprocess) all are read-only: writing to a provider that didn't ask for it is
 * worse than refusing.
 */
export function parseWireFileSystemSchemes(raw: unknown): { schemes: string[]; readonly: string[] } {
    const schemes = parseWireSchemes(raw);
    const field = (raw as { readonly?: unknown } | null)?.readonly;
    if (!Array.isArray(field)) return { schemes, readonly: schemes };
    return { schemes, readonly: schemes.filter((scheme) => field.includes(scheme)) };
}

export function parseWireSetEnvironmentVariableCollection(raw: unknown): {
    extensionId: string;
    persistent: boolean;
    collection: [string, IEnvironmentVariableMutator][];
    description: [string, IEnvironmentVariableCollectionDescription][];
} | null {
    // The id check filters primitives: their fields read as undefined.
    const { extensionId, persistent, collection, description } = (raw ?? {}) as Record<string, unknown>;
    if (typeof extensionId !== "string" || extensionId === "") return null;
    return {
        extensionId,
        persistent: persistent !== false,
        collection: parseWireEnvironmentVariableEntries(collection),
        description: parseWireEnvironmentDescriptions(description),
    };
}

export function parseWireUriHandlerRegistration(raw: unknown): string | null {
    const extensionId = (raw as { extensionId?: unknown } | null)?.extensionId;
    return typeof extensionId === "string" && extensionId !== "" ? extensionId : null;
}

export function parseWireWatcherCreate(raw: unknown): IWireWatcherCreate | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as {
        id?: unknown;
        base?: unknown;
        pattern?: unknown;
        ignoreCreateEvents?: unknown;
        ignoreChangeEvents?: unknown;
        ignoreDeleteEvents?: unknown;
    };
    // Stryker disable next-line ConditionalExpression: `typeof p.id !== "number"` → `false` is equivalent, `Number.isInteger` is false for any non-number; the second operand (`!isInteger` → `false`) is killed by the test with id 1.5
    if (typeof p.id !== "number" || !Number.isInteger(p.id)) return null;
    if (typeof p.base !== "string" || p.base === "") return null;
    if (typeof p.pattern !== "string") return null;
    return {
        id: p.id,
        base: p.base,
        pattern: p.pattern,
        ignoreCreateEvents: p.ignoreCreateEvents === true,
        ignoreChangeEvents: p.ignoreChangeEvents === true,
        ignoreDeleteEvents: p.ignoreDeleteEvents === true,
    };
}

export function parseWireWatcherDispose(raw: unknown): number | null {
    if (typeof raw !== "object" || raw === null) return null;
    const { id } = raw as { id?: unknown };
    // Stryker disable next-line ConditionalExpression: `typeof id === "number"` → `true` is equivalent, `Number.isInteger` is false for any non-number; the second operand (`isInteger` → `true`) is killed by the test with id 1.5
    return typeof id === "number" && Number.isInteger(id) ? id : null;
}

function optionalWireString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

export function parseWireInputBoxRequest(raw: unknown): IWireInputBoxRequest | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the check below filters a non-object anyway (it lacks the required field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    return {
        handle: p.handle,
        title: optionalWireString(p.title),
        prompt: optionalWireString(p.prompt),
        placeHolder: optionalWireString(p.placeHolder),
        value: optionalWireString(p.value),
        password: p.password === true,
        validates: p.validates === true,
    };
}

export function parseWireQuickPickRequest(raw: unknown): IWireQuickPickRequest | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the check below filters a non-object anyway (it lacks the required field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    if (!Array.isArray(p.items)) return null;
    const items: IWireQuickPickItem[] = [];
    for (const entry of p.items) {
        if (typeof entry !== "object" || entry === null) continue;
        const it = entry as { label?: unknown; description?: unknown };
        // An item without a label has nothing to show, but it can't be dropped silently:
        // the response is addressed by index in THIS array, and a gap would shift the rest.
        items.push({
            label: typeof it.label === "string" ? it.label : "",
            description: optionalWireString(it.description),
        });
    }
    const canPickMany = p.canPickMany === true;
    const picked = Array.isArray(p.picked)
        ? p.picked.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < items.length)
        : [];
    return {
        handle: p.handle,
        title: optionalWireString(p.title),
        placeHolder: optionalWireString(p.placeHolder),
        canPickMany,
        items,
        // Preselection makes no sense without multi-select, so clear it here
        // so that downstream code doesn't have to remember this pair.
        picked: canPickMany ? picked : [],
    };
}

export function parseWireQuickInputCancel(raw: unknown): number | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the check below filters a non-object anyway (it lacks the required field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return null;
    const { handle } = raw as { handle?: unknown };
    return isFiniteNumber(handle) ? handle : null;
}

/** A string, `null` ("cleared") or a missing field ("untouched"). */
function nullableWireString(value: unknown): string | null | undefined {
    if (value === null) return null;
    return typeof value === "string" ? value : undefined;
}

/** A number, `null` ("cleared") or a missing field ("untouched"). */
function nullableWireNumber(value: unknown): number | null | undefined {
    if (value === null) return null;
    return isFiniteNumber(value) ? value : undefined;
}

function optionalWireBoolean(value: unknown): boolean | undefined {
    return typeof value === "boolean" ? value : undefined;
}

function optionalWireHandles(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.filter((i): i is number => Number.isInteger(i) && i >= 0);
}

/** A field of a foreign type reads as "untouched": a diff of one property must not fail the whole update. */
export function parseWireQuickPickUpdate(raw: unknown): IWireQuickPickUpdate | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the check below filters a non-object anyway (it lacks the required field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    const fields: Record<string, unknown> = {
        handle: p.handle,
        visible: optionalWireBoolean(p.visible),
        title: nullableWireString(p.title),
        step: nullableWireNumber(p.step),
        totalSteps: nullableWireNumber(p.totalSteps),
        placeholder: nullableWireString(p.placeholder),
        prompt: nullableWireString(p.prompt),
        value: optionalWireString(p.value),
        canSelectMany: optionalWireBoolean(p.canSelectMany),
        matchOnDescription: optionalWireBoolean(p.matchOnDescription),
        matchOnDetail: optionalWireBoolean(p.matchOnDetail),
        keepScrollPosition: optionalWireBoolean(p.keepScrollPosition),
        items: Array.isArray(p.items) ? parseWireQuickPickSessionItems(p.items) : undefined,
        activeItems: optionalWireHandles(p.activeItems),
        selectedItems: optionalWireHandles(p.selectedItems),
    };
    // "Untouched" is the ABSENCE of the key: the consumer applies the diff via `in`.
    const present = Object.entries(fields).filter(([, value]) => value !== undefined);
    return Object.fromEntries(present) as unknown as IWireQuickPickUpdate;
}

function parseWireQuickPickSessionItems(raw: readonly unknown[]): IWireQuickPickSessionItem[] {
    const items: IWireQuickPickSessionItem[] = [];
    for (const entry of raw) {
        const it = entry as Record<string, unknown> | null | undefined;
        // An item is addressed by handle, not position: without one it's safe to drop.
        if (!Number.isInteger(it?.handle)) continue;
        const item = entry as Record<string, unknown>;
        items.push({
            handle: item.handle as number,
            label: typeof item.label === "string" ? item.label : "",
            description: optionalWireString(item.description),
            detail: optionalWireString(item.detail),
            alwaysShow: item.alwaysShow === true,
        });
    }
    return items;
}

export function parseWireQuickPickDispose(raw: unknown): number | null {
    return parseWireQuickInputCancel(raw);
}

/** `null` means the value is fine, including when the extension answered with garbage or silence. */
export function parseWireValidationMessage(raw: unknown): IWireValidationMessage | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the check below filters a non-object anyway (it lacks the required field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { message?: unknown; severity?: unknown };
    if (typeof p.message !== "string") return null;
    const severity: WireValidationSeverity = p.severity === "warning" || p.severity === "info" ? p.severity : "error";
    return { message: p.message, severity };
}

export function parseWireShowMessageRequest(raw: unknown): IWireShowMessageRequest | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the check below filters a non-object anyway (it lacks the required field), so replacing the operand with `false` has no observable effect
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.message !== "string") return null;
    return {
        severity: parseWireMessageSeverity(p.severity),
        message: p.message,
        detail: optionalWireString(p.detail),
        modal: p.modal === true,
        items: parseWireMessageItems(p.items),
    };
}

/**
 * A button without a title stays empty: the response is addressed by index in this array, a gap would shift the
 * rest.
 */
function parseWireMessageItems(raw: unknown): IWireMessageItem[] {
    if (!Array.isArray(raw)) return [];
    const items: IWireMessageItem[] = [];
    for (const entry of raw) {
        const it = (entry ?? {}) as { title?: unknown; isCloseAffordance?: unknown };
        items.push({
            title: typeof it.title === "string" ? it.title : "",
            isCloseAffordance: it.isCloseAffordance === true,
        });
    }
    return items;
}

function parseWireMessageSeverity(raw: unknown): WireMessageSeverity {
    return raw === "error" || raw === "warn" ? raw : "info";
}

/** An empty string is a legitimate secret: only the value's type is checked. */
export function parseWireSecretWrite(raw: unknown): IWireSecretWrite | null {
    const ref = parseWireSecretRef(raw);
    if (ref === null) return null;
    const { value } = raw as { value?: unknown };
    if (typeof value !== "string") return null;
    return { ...ref, value };
}

export function parseWireSecretKeysRequest(raw: unknown): string | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the field check below filters a non-object anyway
    if (typeof raw !== "object" || raw === null) return null;
    const { extensionId } = raw as { extensionId?: unknown };
    return typeof extensionId === "string" && extensionId !== "" ? extensionId : null;
}

export function parseWireMementoUpdate(raw: unknown): IWireMementoUpdate | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the field checks below filter a non-object anyway
    if (typeof raw !== "object" || raw === null) return null;
    const { extensionId, shared, value } = raw as { extensionId?: unknown; shared?: unknown; value?: unknown };
    if (typeof extensionId !== "string" || extensionId === "") return null;
    if (typeof shared !== "boolean") return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return { extensionId, shared, value: value as Record<string, unknown> };
}

const WIRE_CONFIGURATION_TARGETS: readonly unknown[] = [
    "user",
    "workspace",
    "workspaceFolder",
] satisfies readonly WireConfigurationTarget[];

/** A missing `value` field removes the key. */
export function parseWireConfigurationUpdate(raw: unknown): IWireConfigurationUpdate | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` is a fast exit; the key check below filters a non-object anyway
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Partial<Record<keyof IWireConfigurationUpdate, unknown>>;
    if (typeof p.key !== "string" || p.key === "") return null;
    if (p.target !== undefined && !WIRE_CONFIGURATION_TARGETS.includes(p.target)) return null;
    if (p.resource !== undefined && typeof p.resource !== "string") return null;
    return {
        key: p.key,
        ...(p.value !== undefined ? { value: p.value } : {}),
        ...(p.target !== undefined ? { target: p.target as WireConfigurationTarget } : {}),
        ...(p.resource !== undefined ? { resource: p.resource } : {}),
    };
}

type TaskEnvelope = Readonly<Record<string, unknown>> | null | undefined;

function parseTaskEnv(raw: unknown): Record<string, string> | undefined {
    const record = parseWireStringRecord(raw);
    if (record === undefined) return undefined;
    return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => entry[1] !== null));
}

function parseQuotedString(raw: unknown): string | IWireShellQuotedString | undefined {
    if (typeof raw === "string") return raw;
    const p = raw as TaskEnvelope;
    if (typeof p?.value !== "string" || !isFiniteNumber(p.quoting)) return undefined;
    return { value: p.value, quoting: p.quoting };
}

function parseShellQuoting(raw: unknown): IWireShellQuotingOptions | undefined {
    const p = raw as TaskEnvelope;
    if (p === null || typeof p !== "object") return undefined;
    const escape = p.escape as TaskEnvelope | string;
    return {
        ...(typeof escape === "string" ? { escape } : {}),
        ...(typeof escape === "object" &&
        escape !== null &&
        typeof escape.escapeChar === "string" &&
        typeof escape.charsToEscape === "string"
            ? { escape: { escapeChar: escape.escapeChar, charsToEscape: escape.charsToEscape } }
            : {}),
        ...(typeof p.strong === "string" ? { strong: p.strong } : {}),
        ...(typeof p.weak === "string" ? { weak: p.weak } : {}),
    };
}

function parseTaskExecution(raw: unknown): WireTaskExecutionKind | undefined {
    const p = raw as TaskEnvelope;
    if (p?.customExecution === "customExecution") return { customExecution: "customExecution" };
    const options = p?.options as TaskEnvelope;
    const cwd = typeof options?.cwd === "string" ? { cwd: options.cwd } : {};
    const env = parseTaskEnv(options?.env);
    const common = { ...cwd, ...(env !== undefined ? { env } : {}) };
    if (typeof p?.process === "string") {
        return {
            process: p.process,
            args: parseWireStringArray(p.args) ?? [],
            ...(options !== undefined && options !== null ? { options: common } : {}),
        };
    }
    const commandLine = typeof p?.commandLine === "string" ? p.commandLine : undefined;
    const command = parseQuotedString(p?.command);
    if (commandLine === undefined && command === undefined) return undefined;
    const shellArgs = parseWireStringArray(options?.shellArgs);
    const shellQuoting = parseShellQuoting(options?.shellQuoting);
    const shellOptions = {
        ...common,
        ...(typeof options?.executable === "string" ? { executable: options.executable } : {}),
        ...(shellArgs !== undefined ? { shellArgs } : {}),
        ...(shellQuoting !== undefined ? { shellQuoting } : {}),
    };
    // Stryker disable next-line OptionalChaining: equivalent; without `p` we can't get here (neither commandLine nor command means an exit above); `?.` is for the type
    const args = Array.isArray(p?.args)
        ? (p.args as readonly unknown[]).map(parseQuotedString).filter((a) => a !== undefined)
        : undefined;
    return {
        ...(commandLine !== undefined ? { commandLine } : {}),
        ...(command !== undefined ? { command } : {}),
        ...(args !== undefined ? { args } : {}),
        ...(options !== undefined && options !== null ? { options: shellOptions } : {}),
    };
}

function parseTaskPresentation(raw: unknown): IWireTaskPresentation | undefined {
    const p = raw as TaskEnvelope;
    if (p === null || typeof p !== "object") return undefined;
    const out: Record<string, unknown> = {};
    for (const key of ["reveal", "panel"] as const) if (isFiniteNumber(p[key])) out[key] = p[key];
    for (const key of ["echo", "focus", "showReuseMessage", "clear", "close"] as const) {
        if (typeof p[key] === "boolean") out[key] = p[key];
    }
    if (typeof p.group === "string") out.group = p.group;
    return out as IWireTaskPresentation;
}

/** `null` without a name, a typed definition or a source; broken optional fields are dropped. */
export function parseWireTaskFromSubprocess(raw: unknown): IWireTask | null {
    const p = raw as TaskEnvelope;
    const definition = p?.definition as TaskEnvelope;
    const source = p?.source as TaskEnvelope;
    if (typeof p?.name !== "string" || typeof definition?.type !== "string") return null;
    if (typeof source?.label !== "string" || typeof source.extensionId !== "string") return null;
    const scopeFolder = (source.scope as TaskEnvelope)?.folder;
    const scope = isFiniteNumber(source.scope)
        ? source.scope
        : typeof scopeFolder === "string"
          ? { folder: scopeFolder }
          : null;
    if (scope === null) return null;
    const group = p.group as TaskEnvelope;
    const presentationOptions = parseTaskPresentation(p.presentationOptions);
    const runOptions = p.runOptions as TaskEnvelope;
    return {
        ...(typeof p.id === "string" ? { id: p.id } : {}),
        name: p.name,
        execution: parseTaskExecution(p.execution),
        definition: definition as IWireTaskDefinition,
        isBackground: p.isBackground === true,
        source: { label: source.label, extensionId: source.extensionId, scope },
        ...(typeof group?.id === "string"
            ? {
                  group: {
                      id: group.id,
                      ...(typeof group.isDefault === "boolean" ? { isDefault: group.isDefault } : {}),
                  },
              }
            : {}),
        ...(typeof p.detail === "string" ? { detail: p.detail } : {}),
        ...(presentationOptions !== undefined ? { presentationOptions } : {}),
        problemMatchers: parseWireStringArray(p.problemMatchers) ?? [],
        hasDefinedMatchers: p.hasDefinedMatchers === true,
        ...(typeof runOptions?.reevaluateOnRerun === "boolean"
            ? { runOptions: { reevaluateOnRerun: runOptions.reevaluateOnRerun } }
            : {}),
    };
}

export function parseWireTasksFromSubprocess(raw: unknown): IWireTask[] {
    if (!Array.isArray(raw)) return [];
    return (raw as readonly unknown[])
        .map(parseWireTaskFromSubprocess)
        .filter((task): task is IWireTask => task !== null);
}

export function parseWireTaskProviderRegistration(raw: unknown): IWireTaskProviderRegistration | null {
    const p = raw as TaskEnvelope;
    if (!isFiniteNumber(p?.handle) || typeof p.type !== "string" || typeof p.extensionId !== "string") return null;
    return { handle: p.handle, type: p.type, extensionId: p.extensionId };
}

export function parseWireTaskProviderHandle(raw: unknown): IWireTaskProviderHandle | null {
    const p = raw as TaskEnvelope;
    return isFiniteNumber(p?.handle) ? { handle: p.handle } : null;
}

export function parseWireTaskFilter(raw: unknown): IWireTaskFilter {
    const type = (raw as TaskEnvelope)?.type;
    return typeof type === "string" ? { type } : {};
}

export function parseWireTaskExecuteRequest(raw: unknown): WireTaskExecuteRequest | null {
    const p = raw as TaskEnvelope;
    if (typeof p?.id === "string") return { id: p.id };
    const task = parseWireTaskFromSubprocess(p?.task);
    return task === null ? null : { task };
}

export function parseWireTaskExecutionId(raw: unknown): IWireTaskExecutionId | null {
    const id = (raw as TaskEnvelope)?.id;
    return typeof id === "string" ? { id } : null;
}

export function parseWireUpdateWorkspaceFolders(raw: unknown): IWireUpdateWorkspaceFolders | null {
    const p = raw as { extensionId?: unknown; folders?: unknown } | null | undefined;
    if (!Array.isArray(p?.folders)) return null;
    // Even one non-path makes the whole request foreign: opening "part of the set" isn't allowed.
    if (!p.folders.every((folder) => typeof folder === "string")) return null;
    return {
        extensionId: typeof p.extensionId === "string" ? p.extensionId : null,
        folders: p.folders,
    };
}

function parseWireDialogFilters(raw: unknown): IWireDialogFilter[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const filters: IWireDialogFilter[] = [];
    for (const entry of raw) {
        const filter = entry as { name?: unknown; extensions?: unknown } | null | undefined;
        if (typeof filter?.name !== "string" || !Array.isArray(filter.extensions)) continue;
        filters.push({
            name: filter.name,
            extensions: filter.extensions.filter((ext): ext is string => typeof ext === "string"),
        });
    }
    return filters;
}

export function parseWireOpenDialogRequest(raw: unknown): IWireOpenDialogRequest {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
        defaultUri: optionalWireString(p.defaultUri),
        openLabel: optionalWireString(p.openLabel),
        canSelectFiles: optionalWireBoolean(p.canSelectFiles),
        canSelectFolders: optionalWireBoolean(p.canSelectFolders),
        canSelectMany: optionalWireBoolean(p.canSelectMany),
        filters: parseWireDialogFilters(p.filters),
        title: optionalWireString(p.title),
    };
}

export function parseWireSaveDialogRequest(raw: unknown): IWireSaveDialogRequest {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
        defaultUri: optionalWireString(p.defaultUri),
        saveLabel: optionalWireString(p.saveLabel),
        filters: parseWireDialogFilters(p.filters),
        title: optionalWireString(p.title),
    };
}

/**
 * Разбор хостом того, что прислал субпроцесс (нотификации, запросы и ответы
 * `subprocess → host`), и перевод wire-форм в форму ядра. Только хостовая
 * сторона провода: субпроцесс эти функции не зовёт. Общие для обеих сторон
 * типы провода и разбор того, что читает субпроцесс, — в `api/common/wireTypes.ts`.
 */

import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreRenameLocation } from "../../../../editor/common/languages/iRenameSource.ts";
import { createFoldingRegion, type IFoldingRegion } from "../../../../editor/contrib/folding/iFoldingRegion.ts";
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
    type IWireDiagnosticsPublish,
    type IWireEditorEdit,
    type IWireFileDecoration,
    type IWireInputBoxRequest,
    type IWireLanguageFilter,
    type IWireLanguageProviderRegistration,
    type IWireLanguageProviderUnregistration,
    type IWireMementoUpdate,
    type IWireMessageItem,
    type IWireOutputAppend,
    type IWireOutputShow,
    type IWireProgressEnd,
    type IWireProgressReport,
    type IWireProgressStart,
    type IWireQuickPickItem,
    type IWireQuickPickRequest,
    type IWireSecretWrite,
    type IWireShowMessageRequest,
    type IWireShowTextDocumentParams,
    type IWireStatusBarItem,
    type IWireStatusBarItemDispose,
    type IWireTerminalCreate,
    type IWireTerminalPtyData,
    type IWireTerminalPtyExit,
    type IWireTerminalRef,
    type IWireTerminalSendText,
    type IWireTerminalShow,
    type IWireTerminalTarget,
    type IWireValidationMessage,
    type IWireWatcherCreate,
    type IWireWorkspaceEditOp,
    parseRange,
    parseWireSecretRef,
    parseWireSelections,
    parseWireStringArray,
    parseWireStringRecord,
    type SerializedColor,
    WIRE_LANGUAGE_FEATURE_KINDS,
    type WireConfigurationTarget,
    type WireFoldingRange,
    type WireLanguageFeatureKind,
    type WireMarker,
    type WireMessageSeverity,
    type WireOutputLevel,
    type WireRenamePrepare,
    type WireValidationSeverity,
} from "../../../api/common/wireTypes.ts";

// ─── Editor layout: адресация редакторов и вкладок (editor.*) ───────────────

/** Валидирует параметры `editor.showTextDocument`. */
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

/** Валидирует параметры `editor.closeTabs`. */
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

/** Валидирует параметры `editor.closeGroups`. */
export function parseWireCloseGroupsParams(raw: unknown): IWireCloseGroupsParams | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.groupIds) || !(obj.groupIds as unknown[]).every((id) => isFiniteNumber(id))) return null;
    return { groupIds: obj.groupIds as number[] };
}

// ─── Folding ────────────────────────────────────────────────────────────────

/**
 * Переводит wire-области в core-регионы ({@link IFoldingRegion}). Отбрасывает
 * вырожденные (`end <= start` — прятать нечего) и клампит `start` к нулю. `kind`
 * не переносится (модель ядра его не хранит). Регионы приходят несвёрнутыми —
 * состояние `isCollapsed` восстанавливает мерж по `startLine` в редакторе.
 */
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

// ─── Регистрации языковых провайдеров ───────────────────────────────────────

function isWireLanguageFeatureKind(value: unknown): value is WireLanguageFeatureKind {
    return (WIRE_LANGUAGE_FEATURE_KINDS as readonly unknown[]).includes(value);
}

/** Валидирует один фильтр: поля чужого типа отбрасываются, а не роняют весь селектор. */
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

/** Разбирает `languages.register`; `null` — форма не распознана (регистрация игнорируется). */
export function parseWireLanguageProviderRegistration(raw: unknown): IWireLanguageProviderRegistration | null {
    // У примитива поля читаются как undefined, и его отсеет проверка handle ниже.
    if (raw === null || raw === undefined) return null;
    const obj = raw as Record<string, unknown>;
    if (!isWireHandle(obj.handle) || !isWireLanguageFeatureKind(obj.kind) || !Array.isArray(obj.selector)) {
        return null;
    }
    const selector: IWireLanguageFilter[] = [];
    for (const item of obj.selector) {
        const filter = parseWireLanguageFilter(item);
        if (filter !== null) selector.push(filter);
    }
    return {
        handle: obj.handle,
        kind: obj.kind,
        selector,
        ...(Array.isArray(obj.triggerCharacters)
            ? { triggerCharacters: readWireCharacters(obj.triggerCharacters) }
            : {}),
        ...(Array.isArray(obj.retriggerCharacters)
            ? { retriggerCharacters: readWireCharacters(obj.retriggerCharacters) }
            : {}),
        ...(Array.isArray(obj.providedCodeActionKinds)
            ? { providedCodeActionKinds: readWireCharacters(obj.providedCodeActionKinds) }
            : {}),
    };
}

/** Символы-триггеры и виды действий: только непустые строки, мусор отбрасывается. */
function readWireCharacters(raw: readonly unknown[]): string[] {
    return raw.filter((item): item is string => typeof item === "string" && item !== "");
}

/** Разбирает `languages.unregister`; `null` — форма не распознана. */
export function parseWireLanguageProviderUnregistration(raw: unknown): IWireLanguageProviderUnregistration | null {
    const handle = (raw as Record<string, unknown> | null | undefined)?.handle;
    return isWireHandle(handle) ? { handle } : null;
}

// ─── Rename ─────────────────────────────────────────────────────────────────

/**
 * Переводит ответ `prepareRename` в форму ядра. Отказ бьёт имя: провайдер,
 * сказавший «здесь нельзя», не должен открыть поле ввода из-за того, что
 * прислал заодно и placeholder. `null` — ни имени, ни причины: ядро спросит
 * следующего провайдера.
 */
export function wireToCoreRenameLocation(wire: WireRenamePrepare): ICoreRenameLocation | null {
    if (wire.rejectReason !== undefined) return { kind: "reject", reason: wire.rejectReason };
    if (wire.placeholder !== undefined) return { kind: "name", name: wire.placeholder };
    return null;
}

// ─── Progress (window.withProgress → статус-бар) ────────────────────────────

/** Валидирует `window.progress.start`; `null`, если конверт не распознан. */
export function parseWireProgressStart(raw: unknown): IWireProgressStart | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    if (typeof p.title !== "string") return null;
    return { handle: p.handle, title: p.title };
}

/** Валидирует `window.progress.report`; кривые message/increment отбрасываются по отдельности. */
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

/** Валидирует `window.progress.end`; `null`, если конверт не распознан. */
export function parseWireProgressEnd(raw: unknown): IWireProgressEnd | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    return { handle: p.handle };
}

// ─── Пункты статус-бара ─────────────────────────────────────────────────────

/** Валидирует `window.statusBarItem.update`; `null`, если конверт не распознан. */
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

/** Валидирует `window.statusBarItem.dispose`; `null`, если конверт не распознан. */
export function parseWireStatusBarItemDispose(raw: unknown): IWireStatusBarItemDispose | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    return { handle: p.handle };
}

// ─── Терминалы ──────────────────────────────────────────────────────────────

/** Адрес терминала: хостовый `id` либо `extHostId` субпроцесса; иначе `null`. */
function parseWireTerminalRef(raw: unknown): IWireTerminalRef | null {
    const p = raw as TerminalEnvelope;
    if (isFiniteNumber(p?.id)) return { id: p.id };
    if (isFiniteNumber(p?.extHostId)) return { extHostId: p.extHostId };
    return null;
}

/**
 * Конверт `terminal.*` как объект «может быть»: поля читаются опциональной
 * цепочкой — у примитива их нет так же, как у `null`.
 */
type TerminalEnvelope = Readonly<Record<string, unknown>> | null | undefined;

/** Валидирует `terminal.create`; `null` без `extHostId`. Пустые строки — «не задано». */
export function parseWireTerminalCreate(raw: unknown): IWireTerminalCreate | null {
    const p = raw as TerminalEnvelope;
    if (!isFiniteNumber(p?.extHostId)) return null;
    // Pty расширения: процесса на нашей стороне нет — шелловые опции не к чему.
    if (p.pty === true) {
        return {
            extHostId: p.extHostId,
            pty: true,
            ...(typeof p.name === "string" && p.name !== "" ? { name: p.name } : {}),
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
    };
}

/** Валидирует `terminal.hide` / `terminal.dispose`. */
export function parseWireTerminalTarget(raw: unknown): IWireTerminalTarget | null {
    const terminal = parseWireTerminalRef((raw as TerminalEnvelope)?.terminal);
    return terminal === null ? null : { terminal };
}

/** Валидирует `terminal.show`; `preserveFocus` — только явное `true`. */
export function parseWireTerminalShow(raw: unknown): IWireTerminalShow | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    return { terminal: target.terminal, preserveFocus: (raw as Record<string, unknown>).preserveFocus === true };
}

/** Валидирует `terminal.pty.data`: вывод — строка. */
export function parseWireTerminalPtyData(raw: unknown): IWireTerminalPtyData | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    const { data } = raw as Record<string, unknown>;
    return typeof data === "string" ? { terminal: target.terminal, data } : null;
}

/** Валидирует `terminal.pty.exit`: код — только число. */
export function parseWireTerminalPtyExit(raw: unknown): IWireTerminalPtyExit | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    const { code } = raw as Record<string, unknown>;
    return { terminal: target.terminal, ...(isFiniteNumber(code) ? { code } : {}) };
}

/** Валидирует `terminal.sendText`; `shouldExecute` — только явное `false` отключает Enter. */
export function parseWireTerminalSendText(raw: unknown): IWireTerminalSendText | null {
    const target = parseWireTerminalTarget(raw);
    if (target === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.text !== "string") return null;
    return { terminal: target.terminal, text: p.text, shouldExecute: p.shouldExecute !== false };
}

// ─── Output-каналы ──────────────────────────────────────────────────────────

const WIRE_OUTPUT_LEVELS: readonly WireOutputLevel[] = ["trace", "debug", "info", "warn", "error"];

/** Валидирует `output.append`; `null`, если конверт не распознан. */
export function parseWireOutputAppend(raw: unknown): IWireOutputAppend | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.channel !== "string" || p.channel === "") return null;
    if (typeof p.label !== "string" || p.label === "") return null;
    // Stryker disable next-line ConditionalExpression: `typeof p.level !== "string"` → `false` эквивалентен — `includes` по списку строк и так ложен для любого не-строкового значения; второй операнд (`!includes` → `false`) убивает тест с уровнем "fatal"
    if (typeof p.level !== "string" || !WIRE_OUTPUT_LEVELS.includes(p.level as WireOutputLevel)) return null;
    if (typeof p.value !== "string") return null;
    return { channel: p.channel, label: p.label, level: p.level as WireOutputLevel, value: p.value };
}

/** Валидирует `output.show`; `null`, если конверт не распознан. */
export function parseWireOutputShow(raw: unknown): IWireOutputShow | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.channel !== "string" || p.channel === "") return null;
    if (typeof p.label !== "string" || p.label === "") return null;
    return { channel: p.channel, label: p.label };
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

/** Валидирует один wire-маркер; `null`, если форма не распознана. */
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

/**
 * Разбирает параметры `diagnostics.publish`; `null`, если конверт не распознан.
 * Невалидные маркеры отбрасываются (drop+skip), а не роняют публикацию.
 */
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

// ─── Editor write (правки редактора) ────────────────────────────────────────

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

// ─── Workspace edit (workspace.applyEdit) ───────────────────────────────────

/**
 * Разбор операций workspace edit'а. Мусорная операция (неизвестный `kind`, не
 * строковый ресурс, текстовая без единой валидной правки) **отбрасывает весь
 * набор**: edit применяется all-or-nothing, и молча потерять одну операцию
 * хуже, чем честно отказать. `null` — разбирать нечего.
 */
export function parseWireApplyWorkspaceEditParams(raw: unknown): IWireWorkspaceEditOp[] | null {
    // Непригодные параметры (не объект, `null`, без массива `ops`) отсеивает
    // один гейт: у примитива и у `null` свойства просто нет.
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
    // Достаточно отсечь то, у чего вообще нет свойств: у примитива `kind` не
    // совпадёт ни с одним видом, и операция выпадет сама.
    if (raw === null || raw === undefined) return null;
    const obj = raw as Record<string, unknown>;
    if (obj.kind === "text") {
        if (typeof obj.resource !== "string") return null;
        const edits = parseWireEditorEdits(obj.edits);
        if (edits.length === 0) return null;
        return { kind: "text", resource: obj.resource, edits };
    }
    if (obj.kind === "create") {
        if (typeof obj.resource !== "string") return null;
        return {
            kind: "create",
            resource: obj.resource,
            ...(typeof obj.contents === "string" ? { contents: obj.contents } : {}),
            ...(obj.overwrite === true ? { overwrite: true } : {}),
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
            ...(obj.overwrite === true ? { overwrite: true } : {}),
            ...(obj.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
        };
    }
    return null;
}

// ─── Decorations ────────────────────────────────────────────────────────────

/** Извлекает id темы из сериализованного цвета; `undefined` для CSS-строк/пусто. */
export function themeColorIdOf(value: SerializedColor | undefined): string | undefined {
    if (typeof value === "object" && typeof value.$themeColor === "string") {
        return value.$themeColor;
    }
    return undefined;
}

/** Разбирает сырой массив диапазонов декорации в {@link IRange}[] (невалидные — drop). */
export function parseDecorationRanges(raw: unknown): IRange[] {
    if (!Array.isArray(raw)) return [];
    const result: IRange[] = [];
    for (const item of raw) {
        const parsed = parseRange(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

/** Разбирает сырой массив файловых декораций (`window.fileDecorationsChanged`). */
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

// ─── workspace.fs и провайдеры содержимого ──────────────────────────────────

/** Разбирает ответ `workspace.fs.readFile` в байты. Бросает на структурно чужом ответе. */
export function parseWireReadFileResult(raw: unknown): Uint8Array {
    if (typeof raw !== "object" || raw === null) throw new Error("workspace.fs.readFile: result must be an object");
    const content = (raw as { content?: unknown }).content;
    if (typeof content !== "string") throw new Error("workspace.fs.readFile: content must be a base64 string");
    return new Uint8Array(Buffer.from(content, "base64"));
}

/**
 * Разбирает ответ `workspace.provideTextDocumentContent`. Бросает на структурно
 * чужом ответе: ядру нужна разница между «провайдер сказал нет» (`null`) и
 * «канал сломался» — во втором случае человеку показывается причина.
 */
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

/** Разбирает список схем из `workspace.*ProvidersChanged`; чужие элементы отбрасывает. */
export function parseWireSchemes(raw: unknown): string[] {
    const schemes = (raw as { schemes?: unknown } | null)?.schemes;
    if (!Array.isArray(schemes)) return [];
    return schemes.filter((s): s is string => typeof s === "string");
}

// ─── Файловые watcher'ы расширений ──────────────────────────────────────────

/** Разбирает `workspace.watcher.create`; `null` — параметры структурно чужие. */
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
    // Stryker disable next-line ConditionalExpression: `typeof p.id !== "number"` → `false` эквивалентен — `Number.isInteger` ложен для любого не-числа; второй операнд (`!isInteger` → `false`) убивает тест с id 1.5
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

/** Разбирает `workspace.watcher.dispose`; `null` — параметры структурно чужие. */
export function parseWireWatcherDispose(raw: unknown): number | null {
    if (typeof raw !== "object" || raw === null) return null;
    const { id } = raw as { id?: unknown };
    // Stryker disable next-line ConditionalExpression: `typeof id === "number"` → `true` эквивалентен — `Number.isInteger` ложен для любого не-числа; второй операнд (`isInteger` → `true`) убивает тест с id 1.5
    return typeof id === "number" && Number.isInteger(id) ? id : null;
}

// ─── Quick input (window.showInputBox / window.showQuickPick) ───────────────

function optionalWireString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** Разбирает `window.showInputBox`; `null` — параметры структурно чужие. */
export function parseWireInputBoxRequest(raw: unknown): IWireInputBoxRequest | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
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

/** Разбирает `window.showQuickPick`; `null` — параметры структурно чужие. */
export function parseWireQuickPickRequest(raw: unknown): IWireQuickPickRequest | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (!isFiniteNumber(p.handle)) return null;
    if (!Array.isArray(p.items)) return null;
    const items: IWireQuickPickItem[] = [];
    for (const entry of p.items) {
        if (typeof entry !== "object" || entry === null) continue;
        const it = entry as { label?: unknown; description?: unknown };
        // Пункт без лейбла показывать нечем — но выбросить его молча нельзя:
        // ответ адресуется индексом в ЭТОМ массиве, и дыра сдвинула бы остальные.
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
        // Предотметки без множественного выбора смысла не имеют — гасим здесь,
        // чтобы ниже по течению не приходилось помнить про эту пару.
        picked: canPickMany ? picked : [],
    };
}

/** Разбирает `window.quickInput.cancel`; `null` — параметры структурно чужие. */
export function parseWireQuickInputCancel(raw: unknown): number | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return null;
    const { handle } = raw as { handle?: unknown };
    return isFiniteNumber(handle) ? handle : null;
}

/**
 * Разбирает ответ расширения на `window.inputBox.validate`. `null` — значение в
 * порядке (в том числе когда расширение ответило мусором или молчанием).
 */
export function parseWireValidationMessage(raw: unknown): IWireValidationMessage | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as { message?: unknown; severity?: unknown };
    if (typeof p.message !== "string") return null;
    const severity: WireValidationSeverity = p.severity === "warning" || p.severity === "info" ? p.severity : "error";
    return { message: p.message, severity };
}

// ─── Сообщения расширения (window.show*Message) ─────────────────────────────

/** Разбирает `window.showMessage`; `null` — параметры структурно чужие. */
export function parseWireShowMessageRequest(raw: unknown): IWireShowMessageRequest | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ниже (нужного поля у него нет), так что подмена операнда на `false` наблюдаемого эффекта не даёт
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
 * Кнопки с провода. Кнопка без заголовка остаётся в массиве пустой: ответ
 * адресуется индексом в ЭТОМ массиве, и дыра сдвинула бы остальные.
 */
function parseWireMessageItems(raw: unknown): IWireMessageItem[] {
    if (!Array.isArray(raw)) return [];
    const items: IWireMessageItem[] = [];
    for (const entry of raw) {
        // Мусорная кнопка (null, число, строка) читается теми же полями и даёт
        // пустой заголовок — отдельной ветки для неё не нужно, нужен только
        // `?? {}`, чтобы не обратиться к полю у `null`.
        const it = (entry ?? {}) as { title?: unknown; isCloseAffordance?: unknown };
        items.push({
            title: typeof it.title === "string" ? it.title : "",
            isCloseAffordance: it.isCloseAffordance === true,
        });
    }
    return items;
}

/** Строгость с провода; всё непонятное — `info` (как у логгера до этого). */
function parseWireMessageSeverity(raw: unknown): WireMessageSeverity {
    return raw === "error" || raw === "warn" ? raw : "info";
}

// ─── Секреты и memento расширения ───────────────────────────────────────────

/**
 * Разбирает `secrets.store`. Пустая строка — законный секрет (расширение вправе
 * хранить и такое), поэтому у значения проверяется только тип.
 */
export function parseWireSecretWrite(raw: unknown): IWireSecretWrite | null {
    const ref = parseWireSecretRef(raw);
    if (ref === null) return null;
    const { value } = raw as { value?: unknown };
    if (typeof value !== "string") return null;
    return { ...ref, value };
}

/** Разбирает `secrets.keys` (только id расширения); `null` — форма чужая. */
export function parseWireSecretKeysRequest(raw: unknown): string | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка поля ниже
    if (typeof raw !== "object" || raw === null) return null;
    const { extensionId } = raw as { extensionId?: unknown };
    return typeof extensionId === "string" && extensionId !== "" ? extensionId : null;
}

/** Разбирает `memento.update`; `null` — форма чужая. */
export function parseWireMementoUpdate(raw: unknown): IWireMementoUpdate | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеют проверки полей ниже
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

/**
 * Разбирает `configuration.update`; `null` — форма чужая: нет ключа, цель вне
 * списка, `resource` не строка. Пустое `value` (поля нет) — снятие ключа.
 */
export function parseWireConfigurationUpdate(raw: unknown): IWireConfigurationUpdate | null {
    // Stryker disable next-line ConditionalExpression: `typeof raw !== "object"` — быстрый выход; не-объект всё равно отсеет проверка ключа ниже
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

// ── Задачи (`tasks.*`) ────────────────────────────────────────────────────────

type TaskEnvelope = Readonly<Record<string, unknown>> | null | undefined;

/** Окружение задачи — только строковые значения. */
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

/** Исполнение задачи: процесс, шелл или метка `CustomExecution`; иначе — `undefined`. */
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
    // Stryker disable next-line OptionalChaining: эквивалентный — без `p` сюда не дойти (нет ни commandLine, ни command — выход выше); `?.` — для типа
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

/**
 * Задача от субпроцесса (ответ провайдера, описание для `tasks.execute`):
 * без имени, определения с типом или источника — `null`; лишнее и битое в
 * необязательных полях отбрасывается.
 */
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

/** Ответ провайдера: массив задач, битые выпадают. */
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

/** `tasks.execute`: id задачи ядра или описание целиком; иначе — `null`. */
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

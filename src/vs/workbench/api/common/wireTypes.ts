import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import { createTextEdit, type ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type {
    ICoreCompletionItem,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import { createFoldingRegion, type IFoldingRegion } from "../../../editor/contrib/folding/iFoldingRegion.ts";
import type { ISaveEdit } from "../../services/textfile/common/iSaveParticipant.ts";

/**
 * Wire-форма правки save-участника (subprocess → host). Либо замена текста в
 * диапазоне (позиции 0-based, как в ядре — прямой маппинг на `IRange`), либо
 * смена EOL всего документа. Общий формат для обеих сторон RPC.
 */
export type WireTextEdit =
    | {
          readonly range: {
              readonly startLine: number;
              readonly startCharacter: number;
              readonly endLine: number;
              readonly endCharacter: number;
          };
          readonly text: string;
      }
    | { readonly setEndOfLine: 1 | 2 };

/** Параметры запроса will-save (host → subprocess). */
export interface IWireWillSaveParams {
    /** Ресурс как `uri.toString()`. `document.fileName` субпроцесс выводит из него сам. */
    readonly uri: string;
    readonly languageId: string;
    readonly version: number;
    readonly isDirty: boolean;
    readonly text: string;
    /** `vscode.TextDocumentSaveReason` (1=Manual, 2=AfterDelay, 3=FocusOut). */
    readonly reason: number;
    /** Текущий EOL документа (`vscode.EndOfLine`: 1=LF, 2=CRLF). */
    readonly eol: number;
    /** Кодировка дискового представления (id из SUPPORTED_ENCODINGS, напр. "windows1251"). */
    readonly encoding?: string;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

/** Валидирует одну wire-правку; `null`, если форма не распознана. */
function parseWireTextEdit(raw: unknown): WireTextEdit | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if ("setEndOfLine" in obj) {
        const eol = obj.setEndOfLine;
        if (eol === 1 || eol === 2) return { setEndOfLine: eol };
        return null;
    }
    const range = obj.range;
    if (typeof range !== "object" || range === null) return null;
    const r = range as Record<string, unknown>;
    if (
        !isFiniteNumber(r.startLine) ||
        !isFiniteNumber(r.startCharacter) ||
        !isFiniteNumber(r.endLine) ||
        !isFiniteNumber(r.endCharacter) ||
        typeof obj.text !== "string"
    ) {
        return null;
    }
    return {
        range: {
            startLine: r.startLine,
            startCharacter: r.startCharacter,
            endLine: r.endLine,
            endCharacter: r.endCharacter,
        },
        text: obj.text,
    };
}

/**
 * Разбирает сырой ответ will-save в массив валидных {@link WireTextEdit}.
 * Невалидные элементы отбрасываются (drop+skip), а не роняют весь ответ.
 */
export function parseWireTextEdits(raw: unknown): WireTextEdit[] {
    if (!Array.isArray(raw)) return [];
    const result: WireTextEdit[] = [];
    for (const item of raw) {
        const parsed = parseWireTextEdit(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

/** Переводит wire-правки в core-правки ({@link ISaveEdit}). */
export function wireToSaveEdits(wire: readonly WireTextEdit[]): ISaveEdit[] {
    return wire.map((edit) =>
        "setEndOfLine" in edit
            ? { kind: "eol", eol: edit.setEndOfLine === 2 ? EndOfLine.CRLF : EndOfLine.LF }
            : {
                  kind: "text",
                  range: createRange(
                      edit.range.startLine,
                      edit.range.startCharacter,
                      edit.range.endLine,
                      edit.range.endCharacter,
                  ),
                  text: edit.text,
              },
    );
}

/** Маркер «ответ не пришёл вовремя» для {@link raceWithTimeout}. */
const TIMED_OUT = Symbol("timeout");

/**
 * Общий гонщик RPC-ответа с таймаутом для всех pull-запросов к субпроцессу
 * (will-save, completion, resolve, folding, definition): расширение не отвечает
 * или отвечает ошибкой — вызывающий получает {@link TIMED_OUT} и откатывается на
 * пустой результат, а UI никогда не блокируется навсегда.
 */
async function raceWithTimeout(pending: Promise<unknown>, timeoutMs: number): Promise<unknown> {
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => {
            resolve(TIMED_OUT);
        }, timeoutMs);
    });
    try {
        return await Promise.race([pending.catch(() => TIMED_OUT), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Запрашивает у subprocess'а правки will-save с таймаутом. Возвращает пустой
 * массив на таймаут, ошибку RPC или невалидный ответ — сохранение никогда не
 * блокируется навсегда и не портит данные. `request` — голая функция (обычно
 * `rpc.request`), чтобы логику можно было юнит-тестировать через
 * {@link InProcessChannelPair} без форка subprocess'а.
 */
export async function requestWillSaveEdits(
    request: (method: string, params: unknown) => Promise<unknown>,
    params: IWireWillSaveParams,
    timeoutMs: number,
): Promise<ISaveEdit[]> {
    const outcome = await raceWithTimeout(request("workspace.willSaveTextDocument", params), timeoutMs);
    if (outcome === TIMED_OUT) return [];
    return wireToSaveEdits(parseWireTextEdits(outcome));
}

// ─── Document sync (LSP, наивный full-text push) ─────────────────────────────

/**
 * Снапшот документа для push-синхронизации host → subprocess
 * (`editor.didOpen` / `editor.didChange`). Наивная модель: полный текст, без
 * инкрементальных правок — subprocess переводит его в одну full-range правку
 * `onDidChangeTextDocument`, что валидно и для Full, и для Incremental sync
 * language-сервера.
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

/** Валидирует параметры `editor.didOpen`/`didChange`; `null`, если форма не распознана. */
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

// ─── Completion (WP8) ────────────────────────────────────────────────────────

/** Wire-форма диапазона (0-based, прямой маппинг на `IRange`). */
interface IWireRange {
    readonly startLine: number;
    readonly startCharacter: number;
    readonly endLine: number;
    readonly endCharacter: number;
}

/**
 * Wire-форма элемента автодополнения (subprocess → host). `insertText` уже
 * нормализован хостом-сериализатором (fallback на `label`).
 */
export interface WireCompletionItem {
    readonly label: string;
    readonly insertText: string;
    /**
     * Ключ элемента в кэше субпроцесса (`"<cacheId>.<index>"`) для
     * `languages.resolveCompletionItem`. Нет id — пункт нерезолвимый
     * (word-based, провайдер без `resolveCompletionItem`).
     */
    readonly id?: string;
    /** `labelDetails.detail` — сигнатура рядом с лейблом (`(a: string): void`). */
    readonly labelDetail?: string;
    /** `labelDetails.description` — источник (модуль авто-импорта). */
    readonly labelDescription?: string;
    readonly kind?: number;
    readonly detail?: string;
    readonly documentation?: string;
    readonly command?: { readonly command: string; readonly arguments?: readonly unknown[] };
    readonly range?: IWireRange;
    readonly sortText?: string;
    readonly filterText?: string;
}

/**
 * Ответ на `languages.provideCompletionItems`. `isIncomplete` доезжает из
 * `CompletionList` провайдера: у tsserver список почти всегда неполный, и
 * добор символа обязан перезапросить сервер, а не фильтровать локально.
 */
export interface WireCompletionResult {
    readonly items: readonly WireCompletionItem[];
    readonly isIncomplete: boolean;
}

/** Ответ на `languages.resolveCompletionItem` — догруженные поля пункта. */
export interface WireResolvedCompletionItem {
    readonly detail?: string;
    readonly documentation?: string;
    /** Правки-спутники (авто-импорт): применяются вместе со вставкой. */
    readonly additionalEdits?: readonly WireTextEdit[];
}

/** Параметры запроса completion (host → subprocess). */
export interface IWireCompletionParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    readonly text: string;
    readonly line: number;
    readonly character: number;
}

function parseWireRange(raw: unknown): IWireRange | undefined {
    if (typeof raw !== "object" || raw === null) return undefined;
    const r = raw as Record<string, unknown>;
    if (
        !isFiniteNumber(r.startLine) ||
        !isFiniteNumber(r.startCharacter) ||
        !isFiniteNumber(r.endLine) ||
        !isFiniteNumber(r.endCharacter)
    ) {
        return undefined;
    }
    return {
        startLine: r.startLine,
        startCharacter: r.startCharacter,
        endLine: r.endLine,
        endCharacter: r.endCharacter,
    };
}

function parseWireCommand(raw: unknown): WireCompletionItem["command"] {
    if (typeof raw !== "object" || raw === null) return undefined;
    const c = raw as Record<string, unknown>;
    if (typeof c.command !== "string" || c.command === "") return undefined;
    return {
        command: c.command,
        ...(Array.isArray(c.arguments) ? { arguments: c.arguments as readonly unknown[] } : {}),
    };
}

/** Валидирует один wire-элемент completion; `null`, если форма не распознана. */
function parseWireCompletionItem(raw: unknown): WireCompletionItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.label !== "string" || obj.label === "") return null;
    const insertText = typeof obj.insertText === "string" ? obj.insertText : obj.label;
    const range = parseWireRange(obj.range);
    const command = parseWireCommand(obj.command);
    return {
        label: obj.label,
        insertText,
        ...(typeof obj.id === "string" && obj.id !== "" ? { id: obj.id } : {}),
        ...(typeof obj.labelDetail === "string" ? { labelDetail: obj.labelDetail } : {}),
        ...(typeof obj.labelDescription === "string" ? { labelDescription: obj.labelDescription } : {}),
        ...(isFiniteNumber(obj.kind) ? { kind: obj.kind } : {}),
        ...(typeof obj.detail === "string" ? { detail: obj.detail } : {}),
        ...(typeof obj.documentation === "string" ? { documentation: obj.documentation } : {}),
        ...(command !== undefined ? { command } : {}),
        ...(range !== undefined ? { range } : {}),
        ...(typeof obj.sortText === "string" ? { sortText: obj.sortText } : {}),
        ...(typeof obj.filterText === "string" ? { filterText: obj.filterText } : {}),
    };
}

/**
 * Разбирает сырой ответ completion в массив валидных {@link WireCompletionItem}.
 * Невалидные элементы отбрасываются (drop+skip), а не роняют весь ответ.
 */
export function parseWireCompletionItems(raw: unknown): WireCompletionItem[] {
    if (!Array.isArray(raw)) return [];
    const result: WireCompletionItem[] = [];
    for (const item of raw) {
        const parsed = parseWireCompletionItem(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

/**
 * Разбирает ответ `languages.provideCompletionItems`. Понимает и голый массив —
 * форму до появления `isIncomplete` (расширение из чужой поставки, старый
 * subprocess): такой ответ считается полным списком.
 */
export function parseWireCompletionResult(raw: unknown): WireCompletionResult {
    if (Array.isArray(raw)) return { items: parseWireCompletionItems(raw), isIncomplete: false };
    if (typeof raw !== "object" || raw === null) return { items: [], isIncomplete: false };
    const obj = raw as Record<string, unknown>;
    return {
        items: parseWireCompletionItems(obj.items),
        isIncomplete: obj.isIncomplete === true,
    };
}

/** Разбирает ответ `languages.resolveCompletionItem`; `null` — резолва нет. */
export function parseWireResolvedCompletionItem(raw: unknown): ICoreResolvedCompletion | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const additionalEdits: ITextEdit[] = [];
    if (Array.isArray(obj.additionalEdits)) {
        for (const edit of obj.additionalEdits) {
            if (typeof edit !== "object" || edit === null) continue;
            const e = edit as Record<string, unknown>;
            const range = parseWireRange(e.range);
            if (range === undefined || typeof e.text !== "string") continue;
            additionalEdits.push(
                createTextEdit(
                    createRange(range.startLine, range.startCharacter, range.endLine, range.endCharacter),
                    e.text,
                ),
            );
        }
    }
    return {
        ...(typeof obj.detail === "string" ? { detail: obj.detail } : {}),
        ...(typeof obj.documentation === "string" ? { documentation: obj.documentation } : {}),
        ...(additionalEdits.length > 0 ? { additionalEdits } : {}),
    };
}

/** Переводит wire-элементы в core-элементы ({@link ICoreCompletionItem}). */
export function wireToCoreCompletionItems(wire: readonly WireCompletionItem[]): ICoreCompletionItem[] {
    return wire.map((item) => ({
        label: item.label,
        insertText: item.insertText,
        ...(item.id !== undefined ? { id: item.id } : {}),
        ...(item.labelDetail !== undefined ? { labelDetail: item.labelDetail } : {}),
        ...(item.labelDescription !== undefined ? { labelDescription: item.labelDescription } : {}),
        ...(item.kind !== undefined ? { kind: item.kind } : {}),
        ...(item.detail !== undefined ? { detail: item.detail } : {}),
        ...(item.documentation !== undefined ? { documentation: item.documentation } : {}),
        ...(item.command !== undefined
            ? {
                  command: {
                      command: item.command.command,
                      ...(item.command.arguments !== undefined ? { arguments: item.command.arguments } : {}),
                  },
              }
            : {}),
        ...(item.range !== undefined
            ? {
                  range: createRange(
                      item.range.startLine,
                      item.range.startCharacter,
                      item.range.endLine,
                      item.range.endCharacter,
                  ),
              }
            : {}),
        ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
        ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
    }));
}

/**
 * Запрашивает у subprocess'а элементы автодополнения с таймаутом. Возвращает
 * пустой массив на таймаут, ошибку RPC или невалидный ответ (completion —
 * best-effort, не блокирует UI). `request` — голая функция для юнит-тестов через
 * {@link InProcessChannelPair} без форка subprocess'а (как {@link requestWillSaveEdits}).
 */
export async function requestCompletionItems(
    request: (method: string, params: unknown) => Promise<unknown>,
    params: IWireCompletionParams,
    timeoutMs: number,
): Promise<ICoreCompletionResult> {
    const outcome = await raceWithTimeout(request("languages.provideCompletionItems", params), timeoutMs);
    if (outcome === TIMED_OUT) return { items: [], isIncomplete: false };
    const parsed = parseWireCompletionResult(outcome);
    return { items: wireToCoreCompletionItems(parsed.items), isIncomplete: parsed.isIncomplete };
}

/**
 * Просит субпроцесс догрузить detail/documentation/additionalTextEdits пункта
 * (`languages.resolveCompletionItem`). `null` — таймаут, ошибка RPC или
 * провайдер без resolve: попап просто останется с тем, что уже есть.
 */
export async function requestResolveCompletionItem(
    request: (method: string, params: unknown) => Promise<unknown>,
    id: string,
    timeoutMs: number,
): Promise<ICoreResolvedCompletion | null> {
    const outcome = await raceWithTimeout(request("languages.resolveCompletionItem", { id }), timeoutMs);
    if (outcome === TIMED_OUT) return null;
    return parseWireResolvedCompletionItem(outcome);
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

/** Параметры запроса folding (host → subprocess). */
export interface IWireFoldingParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    readonly text: string;
}

/** Валидирует одну wire-область folding; `null`, если форма не распознана. */
function parseWireFoldingRange(raw: unknown): WireFoldingRange | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!isFiniteNumber(obj.start) || !isFiniteNumber(obj.end)) return null;
    return {
        start: obj.start,
        end: obj.end,
        ...(isFiniteNumber(obj.kind) ? { kind: obj.kind } : {}),
    };
}

/**
 * Разбирает сырой ответ folding в массив валидных {@link WireFoldingRange}.
 * Невалидные элементы отбрасываются (drop+skip), а не роняют весь ответ.
 */
export function parseWireFoldingRanges(raw: unknown): WireFoldingRange[] {
    if (!Array.isArray(raw)) return [];
    const result: WireFoldingRange[] = [];
    for (const item of raw) {
        const parsed = parseWireFoldingRange(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

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

/**
 * Запрашивает у subprocess'а области сворачивания с таймаутом. Возвращает пустой
 * массив на таймаут, ошибку RPC или невалидный ответ (folding — best-effort:
 * ядро откатится на indentation-фолды). `request` — голая функция для юнит-тестов
 * через {@link InProcessChannelPair} без форка subprocess'а.
 */
export async function requestFoldingRanges(
    request: (method: string, params: unknown) => Promise<unknown>,
    params: IWireFoldingParams,
    timeoutMs: number,
): Promise<IFoldingRegion[]> {
    const outcome = await raceWithTimeout(request("languages.provideFoldingRanges", params), timeoutMs);
    if (outcome === TIMED_OUT) return [];
    return wireToCoreFoldingRegions(parseWireFoldingRanges(outcome));
}

// ─── Definition (LSP) ────────────────────────────────────────────────────────

/**
 * Wire-форма одной цели definition (subprocess → host). `uri` — цель прыжка
 * (может отличаться от запрошенного ресурса), `range` — прицельный диапазон
 * символа (у `LocationLink` хост-сериализатор берёт `targetSelectionRange ??
 * targetRange`).
 */
export interface WireDefinitionLocation {
    readonly uri: string;
    readonly range: IWireRange;
}

/** Параметры запроса definition (host → subprocess) — форма completion-запроса. */
export interface IWireDefinitionParams {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    readonly text: string;
    readonly line: number;
    readonly character: number;
}

/** Валидирует одну wire-цель definition; `null`, если форма не распознана. */
function parseWireDefinitionLocation(raw: unknown): WireDefinitionLocation | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.uri !== "string" || obj.uri === "") return null;
    const range = parseWireRange(obj.range);
    if (range === undefined) return null;
    return { uri: obj.uri, range };
}

/**
 * Разбирает сырой ответ definition в массив валидных {@link WireDefinitionLocation}.
 * Невалидные элементы отбрасываются (drop+skip), а не роняют весь ответ.
 */
export function parseWireDefinitionLocations(raw: unknown): WireDefinitionLocation[] {
    if (!Array.isArray(raw)) return [];
    const result: WireDefinitionLocation[] = [];
    for (const item of raw) {
        const parsed = parseWireDefinitionLocation(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

/** Переводит wire-цели в core-цели ({@link ICoreDefinitionLocation}). */
export function wireToCoreDefinitionLocations(wire: readonly WireDefinitionLocation[]): ICoreDefinitionLocation[] {
    return wire.map((loc) => ({
        uri: loc.uri,
        range: createRange(loc.range.startLine, loc.range.startCharacter, loc.range.endLine, loc.range.endCharacter),
    }));
}

/**
 * Запрашивает у subprocess'а цели definition с таймаутом. Возвращает пустой
 * массив на таймаут, ошибку RPC или невалидный ответ (go-to-definition —
 * best-effort, не блокирует UI). `request` — голая функция для юнит-тестов через
 * {@link InProcessChannelPair} без форка subprocess'а.
 */
export async function requestDefinition(
    request: (method: string, params: unknown) => Promise<unknown>,
    params: IWireDefinitionParams,
    timeoutMs: number,
): Promise<ICoreDefinitionLocation[]> {
    const outcome = await raceWithTimeout(request("languages.provideDefinition", params), timeoutMs);
    if (outcome === TIMED_OUT) return [];
    return wireToCoreDefinitionLocations(parseWireDefinitionLocations(outcome));
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

// ─── Output-каналы (window.createOutputChannel → панель Output) ──────────────

/** Уровень строки output-канала (маппится на методы ILogger хоста). */
export type WireOutputLevel = "trace" | "debug" | "info" | "warn" | "error";

const WIRE_OUTPUT_LEVELS: readonly WireOutputLevel[] = ["trace", "debug", "info", "warn", "error"];

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

/** Валидирует `output.append`; `null`, если конверт не распознан. */
export function parseWireOutputAppend(raw: unknown): IWireOutputAppend | null {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    if (typeof p.channel !== "string" || p.channel === "") return null;
    if (typeof p.label !== "string" || p.label === "") return null;
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

// ─── Diagnostics (LSP) ───────────────────────────────────────────────────────

/**
 * Wire-форма одной диагностики (subprocess → host, notify `diagnostics.publish`).
 * Range — плоские 0-based поля (как в остальных wire-типах); `severity` —
 * `vscode.DiagnosticSeverity` (0=Error…3=Hint), маппинг в `MarkerSeverity`
 * делает потребитель sink'а.
 */
export interface WireMarker {
    readonly severity: number;
    readonly startLine: number;
    readonly startCharacter: number;
    readonly endLine: number;
    readonly endCharacter: number;
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

/** Валидирует один wire-маркер; `null`, если форма не распознана. */
function parseWireMarker(raw: unknown): WireMarker | null {
    if (typeof raw !== "object" || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (
        !isFiniteNumber(m.severity) ||
        !isFiniteNumber(m.startLine) ||
        !isFiniteNumber(m.startCharacter) ||
        !isFiniteNumber(m.endLine) ||
        !isFiniteNumber(m.endCharacter) ||
        typeof m.message !== "string"
    ) {
        return null;
    }
    return {
        severity: m.severity,
        startLine: m.startLine,
        startCharacter: m.startCharacter,
        endLine: m.endLine,
        endCharacter: m.endCharacter,
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

// ─── Editor write (selection + edit, #194) ───────────────────────────────────

/** Wire-форма выделения (0-based; anchor — якорь, active — курсор). */
export interface IWireSelection {
    readonly anchorLine: number;
    readonly anchorCharacter: number;
    readonly activeLine: number;
    readonly activeCharacter: number;
}

/** Wire-форма одной правки `TextEditor.edit` (замена текста в диапазоне). */
export interface IWireEditorEdit {
    readonly range: IWireRange;
    readonly text: string;
}

/** Параметры `editor.applyEdit` (subprocess → host): правки активного редактора. */
export interface IWireApplyEditParams {
    readonly uri: string;
    readonly edits: readonly IWireEditorEdit[];
}

/** Параметры `editor.setSelection` (subprocess → host): новые выделения активного редактора. */
export interface IWireSetSelectionParams {
    readonly uri: string;
    readonly selections: readonly IWireSelection[];
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

export function parseWireSelections(raw: unknown): IWireSelection[] {
    if (!Array.isArray(raw)) return [];
    const result: IWireSelection[] = [];
    for (const item of raw) {
        const parsed = parseWireSelection(item);
        if (parsed !== null) result.push(parsed);
    }
    return result;
}

function parseWireEditorEdit(raw: unknown): IWireEditorEdit | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const range = parseWireRange(obj.range);
    if (range === undefined) return null;
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
}

/** Одна изменившаяся файловая декорация (`window.fileDecorationsChanged`). */
export interface IWireFileDecoration {
    readonly uri: string;
    readonly badge?: string;
    readonly colorId?: string;
    readonly propagate?: boolean;
}

/**
 * Сериализует значение цвета опций декорации. `ThemeColor` (утиный тип — объект
 * со строковым `id`) → `{ $themeColor: id }`; CSS-строка остаётся как есть;
 * прочее (в т.ч. `undefined`) → `undefined`.
 */
export function serializeColor(value: unknown): SerializedColor | undefined {
    if (typeof value === "string") return value;
    if (typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string") {
        return { $themeColor: (value as { id: string }).id };
    }
    return undefined;
}

/** Извлекает id темы из сериализованного цвета; `undefined` для CSS-строк/пусто. */
export function themeColorIdOf(value: SerializedColor | undefined): string | undefined {
    if (typeof value === "object" && typeof value.$themeColor === "string") {
        return value.$themeColor;
    }
    return undefined;
}

/**
 * Сериализует `vscode.DecorationRenderOptions` в {@link SerializedDecorationRenderOptions}.
 * Утиный тип `options` (без импорта типов vscode в этот shared-модуль): читаем
 * известные поля best-effort. `ThemeColor`-значения проходят через {@link serializeColor}.
 */
export function serializeDecorationRenderOptions(options: unknown): SerializedDecorationRenderOptions {
    const o = (typeof options === "object" && options !== null ? options : {}) as {
        isWholeLine?: unknown;
        overviewRulerLane?: unknown;
        backgroundColor?: unknown;
        color?: unknown;
        overviewRulerColor?: unknown;
    };
    const result: {
        isWholeLine?: boolean;
        overviewRulerLane?: number;
        backgroundColor?: SerializedColor;
        color?: SerializedColor;
        overviewRulerColor?: SerializedColor;
    } = {};
    if (typeof o.isWholeLine === "boolean") result.isWholeLine = o.isWholeLine;
    if (typeof o.overviewRulerLane === "number") result.overviewRulerLane = o.overviewRulerLane;
    const bg = serializeColor(o.backgroundColor);
    if (bg !== undefined) result.backgroundColor = bg;
    const color = serializeColor(o.color);
    if (color !== undefined) result.color = color;
    const overview = serializeColor(o.overviewRulerColor);
    if (overview !== undefined) result.overviewRulerColor = overview;
    return result;
}

/**
 * Валидирует один сырой диапазон в {@link IRange} (nested `start`/`end`). `null`,
 * если форма не распознана (drop+skip, как остальные wire-парсеры).
 */
function parseDecorationRange(raw: unknown): IRange | null {
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

/** Разбирает сырой массив диапазонов декорации в {@link IRange}[] (невалидные — drop). */
export function parseDecorationRanges(raw: unknown): IRange[] {
    if (!Array.isArray(raw)) return [];
    const result: IRange[] = [];
    for (const item of raw) {
        const parsed = parseDecorationRange(item);
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

// ── workspace.fs: чтение ресурса провайдером расширения ──────────────────────

/**
 * Ответ субпроцесса на `workspace.fs.readFile`. Содержимое едет base64-строкой:
 * канал RPC — JSON, а бинарный `Uint8Array` в нём не переживает round-trip
 * (превратился бы в объект с числовыми ключами).
 */
export interface IWireReadFileResult {
    content: string;
}

/** Разбирает ответ `workspace.fs.readFile` в байты. Бросает на структурно чужом ответе. */
export function parseWireReadFileResult(raw: unknown): Uint8Array {
    if (typeof raw !== "object" || raw === null) throw new Error("workspace.fs.readFile: result must be an object");
    const content = (raw as { content?: unknown }).content;
    if (typeof content !== "string") throw new Error("workspace.fs.readFile: content must be a base64 string");
    return new Uint8Array(Buffer.from(content, "base64"));
}

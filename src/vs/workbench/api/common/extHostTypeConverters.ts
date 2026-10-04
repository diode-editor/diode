/**
 * Конвертеры «объект расширения ↔ провод» субпроцесса (калька upstream
 * `extHostTypeConverters.ts`). API → провод: утиная проверка объектов
 * расширения — их поля публичны и записываемы, а объект мог прийти из чужого
 * бандла, — и сборка формы провода (core `IRange`, `ICore*` ответов языковых
 * провайдеров, правки, маркеры, декорации). Хост ответы субпроцесса не
 * перепроверяет: форму гарантирует этот модуль. Провод → API — обратные
 * переводы для провайдеров и прокси редактора (`toVscode*`).
 */
import type * as vscode from "vscode";

import { comparePositions, createPosition } from "../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import type { ICoreCompletionItem } from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreInlineCompletionItem } from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type {
    ICoreParameterInfo,
    ICoreSignature,
    ICoreSignatureHelp,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";

import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import {
    EndOfLine,
    ParameterInformation,
    Position,
    Range,
    Selection,
    SignatureHelp,
    SignatureInformation,
    SnippetString,
    SnippetTextEdit,
    type TextEdit,
    type WorkspaceEdit,
} from "./vscodeTypes.ts";
import type {
    IWireEditorEdit,
    IWireSelection,
    IWireWorkspaceEditOp,
    SerializedColor,
    SerializedDecorationRenderOptions,
    WireFoldingRange,
    WireMarker,
    WireRenamePrepare,
    WireTextEdit,
} from "./wireTypes.ts";

/** Конечное число: не `NaN`, не `Infinity` и не значение другого типа. */
function isFiniteNumber(raw: unknown): raw is number {
    return Number.isFinite(raw);
}

/**
 * Сериализует `vscode.Range` (утиный тип — подойдёт и `Range` чужого бандла) в
 * core-диапазон провода ({@link IRange}); `null`, если форма чужая или
 * координата не конечное число (`Position` расширения клампит к нулю, но `NaN`
 * пропускает). Перевёрнутый диапазон разворачивается: инвариант `start <= end`
 * `vscode.Range` держит конструктором, а утиный объект — нет. Хост диапазоны
 * ответа не перепроверяет. Единственная сборка диапазона «API → провод»:
 * языковые ответы, правки, маркеры, декорации.
 */
export function rangeFrom(raw: unknown): IRange | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
    const { start, end } = r;
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
    const from = createPosition(start.line, start.character);
    const to = createPosition(end.line, end.character);
    // Stryker disable next-line EqualityOperator: на равных границах обе ветки дают один и тот же диапазон
    return comparePositions(from, to) <= 0 ? { start: from, end: to } : { start: to, end: from };
}

/** Диапазон провода (параметры запроса хоста, свой сериализованный) → `vscode.Range` для провайдера. */
export function toVscodeRange(range: IRange): Range {
    return new Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

/**
 * Диапазоны из `setDecorations` — либо голые Range, либо DecorationOptions с
 * `.range`. Битый диапазон (чужая форма, не конечная координата) выпадает — как
 * его отбросил бы и разбор декораций на хосте.
 */
export function normalizeDecorationRanges(
    rangesOrOptions: readonly vscode.Range[] | readonly vscode.DecorationOptions[],
): IRange[] {
    return rangesOrOptions.flatMap((item) => {
        const range = rangeFrom("range" in item ? item.range : item);
        return range === null ? [] : [range];
    });
}

/** Выделение провода (anchor/active, 0-based) → `vscode.Selection` для прокси редактора. */
export function toVscodeSelection(s: IWireSelection): vscode.Selection {
    return new Selection(new Position(s.anchorLine, s.anchorCharacter), new Position(s.activeLine, s.activeCharacter));
}

/** `vscode.Selection` → wire (anchor/active, 0-based). */
export function toWireSelection(selection: vscode.Selection): IWireSelection {
    return {
        anchorLine: selection.anchor.line,
        anchorCharacter: selection.anchor.character,
        activeLine: selection.active.line,
        activeCharacter: selection.active.character,
    };
}

/**
 * Диапазон правки из `Range`/`Selection` (есть `start`/`end`) либо `Position`
 * (вставка в точку → пустой диапазон `pos..pos`). `null` — диапазон битый
 * (см. {@link rangeFrom}).
 */
export function toWireEditRange(location: vscode.Range | vscode.Position): IRange | null {
    const asRange = location as { start?: vscode.Position; end?: vscode.Position };
    if (asRange.start !== undefined && asRange.end !== undefined) {
        return rangeFrom(location);
    }
    const pos = location as vscode.Position;
    return createRange(pos.line, pos.character, pos.line, pos.character);
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

/**
 * Сериализует `vscode.DecorationRenderOptions` в {@link SerializedDecorationRenderOptions}.
 * Утиный тип `options` (расширение вправе положить в поля что угодно): читаем
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
 * Текст диагностики: строка как есть, rich-форма (`MarkdownString` и подобные) —
 * её `value`. Слепой `String()` дал бы здесь «[object Object]» в маркере.
 */
function messageText(message: unknown): string {
    // Stryker disable next-line ConditionalExpression,StringLiteral: эквивалентный — без этой ветки строка уходит в последний `toString()`, а он у строки возвращает её саму; ветка — для типов и читателя
    if (typeof message === "string") return message;
    if (message === undefined || message === null) return "";
    if (typeof message === "object") {
        const value = (message as { value?: unknown }).value;
        return typeof value === "string" ? value : "";
    }
    return (message as { toString(): string }).toString();
}

/**
 * Строковый вид uri, пришедшего от расширения (свой `Uri` или чужой из другого
 * рантайма). Отдельной ветки на строку не нужно: у неё `toString()` — она сама.
 */
function uriText(uri: unknown): string {
    return (uri as { toString(): string }).toString();
}

/**
 * `vscode.Diagnostic` (утиный тип) → {@link WireMarker}; кривые поля — к
 * дефолтам. Диагностика без `range` встаёт в начало файла; `null` — диапазон
 * есть, но битый (чужая форма, не конечная координата): маркер выпадает, как
 * выпал бы и в разборе хоста, а не роняет `collection.set` расширения.
 */
export function toWireMarker(diag: unknown): WireMarker | null {
    const d = diag as {
        range?: unknown;
        message?: unknown;
        severity?: unknown;
        code?: unknown;
        source?: unknown;
    };
    const range = d.range == null ? createRange(0, 0, 0, 0) : rangeFrom(d.range);
    if (range === null) return null;
    // code бывает и rich-формой { value, target } (ссылка на доку правила —
    // так шлёт eslint); wire несёт только value, target TUI некуда открывать.
    const rawCode = typeof d.code === "object" && d.code !== null ? (d.code as { value?: unknown }).value : d.code;
    const code = typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : undefined;
    return {
        severity: typeof d.severity === "number" ? d.severity : 0,
        range,
        message: messageText(d.message),
        ...(code !== undefined ? { code } : {}),
        ...(typeof d.source === "string" ? { source: d.source } : {}),
    };
}

/**
 * Сериализует один элемент результата definition-провайдера: `Location`
 * (`{ uri, range }`) или `LocationLink` (`{ targetUri, targetRange,
 * targetSelectionRange? }` — прицельный диапазон `targetSelectionRange ??
 * targetRange`). `null` — форма не распознана (drop+skip).
 */
export function serializeDefinitionLocation(item: unknown): ICoreDefinitionLocation | null {
    if (typeof item !== "object" || item === null) return null;
    const link = item as { targetUri?: unknown; targetRange?: unknown; targetSelectionRange?: unknown };
    if (link.targetUri != null) {
        return serializeLocation(link.targetUri, link.targetSelectionRange ?? link.targetRange);
    }
    const loc = item as { uri?: unknown; range?: unknown };
    if (loc.uri == null) return null;
    return serializeLocation(loc.uri, loc.range);
}

/** Цель с диапазоном; `null` — диапазон чужой формы или uri пустой (прыгать некуда). */
function serializeLocation(rawUri: unknown, rawRange: unknown): ICoreDefinitionLocation | null {
    const uri = uriText(rawUri);
    const range = rangeFrom(rawRange);
    return range === null || uri === "" ? null : { uri, range };
}

/**
 * Сериализует ответ `prepareRename`: либо голый `Range`, либо
 * `{ range, placeholder }`. Placeholder, которого провайдер не прислал,
 * добирается текстом самого диапазона — ровно как обещает эталон («when
 * omitted the text in the returned range is used»); подстановка живёт здесь,
 * потому что документ есть только у субпроцесса. `null` — форма не распознана
 * (ядро спросит следующего провайдера).
 */
export function serializeRenamePrepare(raw: unknown, doc: ExtHostTextDocument): WireRenamePrepare | null {
    // Своей проверки формы тут нет: `null`/`undefined` отсекает вызывающий
    // («провайдеру сказать нечего»), а примитив отсеет разбор диапазона ниже.
    const holder = raw as { range?: unknown; placeholder?: unknown };
    // Голый `Range` от `{range, placeholder}` отличает наличие поля `range`:
    // у самого Range его нет.
    const rangeSource = holder.range === undefined ? raw : holder.range;
    const range = rangeFrom(rangeSource);
    if (range === null) return null;
    if (typeof holder.placeholder === "string" && holder.placeholder !== "") {
        return { placeholder: holder.placeholder };
    }
    const text = doc.getText(toVscodeRange(range));
    // Пустой диапазон не даёт имени: отвечаем «сказать нечего», и слово под
    // кареткой доберёт ядро.
    return text === "" ? null : { placeholder: text };
}

/**
 * Сериализует `contents` одного hover'а в блоки сырого markdown: строка,
 * `MarkdownString { value }` или legacy `MarkedString { language, value }`
 * (кодовый блок → fenced). Пустые и нераспознанные блоки отбрасываются
 * (drop+skip), разметку протокол не трогает — её стрипает UI-потребитель.
 */
export function serializeHoverContents(raw: unknown): string[] {
    const blocks: string[] = [];
    for (const block of Array.isArray(raw) ? raw : [raw]) {
        const value = readHoverBlock(block);
        if (value !== null && value.trim() !== "") blocks.push(value);
    }
    return blocks;
}

/** Один блок `Hover.contents`: строка, `MarkdownString` или `MarkedString`. */
function readHoverBlock(block: unknown): string | null {
    if (typeof block === "string") return block;
    if (block === null) return null;
    const b = block as { value?: unknown; language?: unknown };
    if (typeof b.value !== "string") return null;
    // Legacy MarkedString `{language, value}` — кодовый блок; оборачиваем в
    // fenced, чтобы UI отличал код от прозы.
    if (typeof b.language !== "string" || b.language === "") return b.value;
    return `\`\`\`${b.language}\n${b.value}\n\`\`\``;
}

/**
 * `vscode.SignatureHelp` (утиный тип) → форма ядра; `null` — форма чужая или
 * подсказки нет. Разбор строгий: битая сигнатура или параметр отбраковывают
 * весь ответ, и хендлер спрашивает следующего провайдера: `activeSignature`/
 * `activeParameter` — индексы, и выброс одного элемента сдвинул бы подсветку на
 * соседний параметр молча. Хост ответ не перепроверяет — индексы и числа
 * приводятся здесь.
 */
export function serializeSignatureHelp(raw: unknown): ICoreSignatureHelp | null {
    if (typeof raw !== "object" || raw === null) return null;
    const help = raw as { signatures?: unknown; activeSignature?: unknown; activeParameter?: unknown };
    if (!Array.isArray(help.signatures) || help.signatures.length === 0) return null;

    const signatures: ICoreSignature[] = [];
    for (const item of help.signatures) {
        const signature = serializeSignature(item);
        if (signature === null) return null;
        signatures.push(signature);
    }

    return {
        signatures,
        activeSignature: clampSignatureIndex(help.activeSignature, signatures.length),
        // `-1` — легальное «активного параметра нет» (noActiveParameterSupport),
        // поэтому нижней границы здесь нет, только отбраковка не-чисел.
        activeParameter: isFiniteNumber(help.activeParameter) ? help.activeParameter : 0,
    };
}

/** Индекс активной сигнатуры: не-целое или выход за список → 0. */
function clampSignatureIndex(raw: unknown, length: number): number {
    if (!Number.isInteger(raw)) return 0;
    const index = raw as number;
    // Stryker disable next-line EqualityOperator: на index === 0 обе границы дают ноль — тот же индекс, что и без клампа
    if (index < 0 || index >= length) return 0;
    return index;
}

/** Одна сигнатура (`vscode.SignatureInformation`); `null` — форма чужая. */
function serializeSignature(raw: unknown): ICoreSignature | null {
    if (!isDuckObject(raw)) return null;
    const item = raw as { label?: unknown; documentation?: unknown; parameters?: unknown; activeParameter?: unknown };
    if (typeof item.label !== "string") return null;

    const parameters: ICoreParameterInfo[] = [];
    if (item.parameters !== undefined) {
        if (!Array.isArray(item.parameters)) return null;
        for (const parameter of item.parameters) {
            const serialized = serializeParameter(parameter);
            if (serialized === null) return null;
            parameters.push(serialized);
        }
    }

    const documentation = readDocumentationText(item.documentation);
    return {
        label: item.label,
        parameters,
        ...(documentation === undefined || documentation === "" ? {} : { documentation }),
        ...(isFiniteNumber(item.activeParameter) ? { activeParameter: item.activeParameter } : {}),
    };
}

/** Один параметр (`vscode.ParameterInformation`); `null` — форма чужая. */
function serializeParameter(raw: unknown): ICoreParameterInfo | null {
    if (!isDuckObject(raw)) return null;
    const item = raw as { label?: unknown; documentation?: unknown };
    const label = serializeParameterLabel(item.label);
    if (label === null) return null;
    const documentation = readDocumentationText(item.documentation);
    return { label, ...(documentation === undefined || documentation === "" ? {} : { documentation }) };
}

/**
 * Утиная проверка «это объект расширения, а не примитив». Отдельная функция —
 * чтобы `typeof`-конъюнкт (нужный компилятору, но избыточный в рантайме: у
 * числа всё равно нет ни `label`, ни `parameters`) гасился в одном месте.
 */
function isDuckObject(raw: unknown): boolean {
    if (raw === null) return false;
    // Stryker disable next-line ConditionalExpression: см. выше — примитив отсеют проверки полей у вызывающих
    return typeof raw === "object";
}

/** Метка параметра: подстрока метки сигнатуры либо пара офсетов `[start, end)`. */
function serializeParameterLabel(raw: unknown): string | readonly [number, number] | null {
    if (typeof raw === "string") return raw;
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const [start, end] = raw as unknown[];
    if (!isFiniteNumber(start) || !isFiniteNumber(end)) return null;
    return [start, end];
}

/**
 * Показанная подсказка из запроса хоста (`activeSignatureHelp`, plain-объект
 * ядра) → экземпляры `SignatureHelp`/`SignatureInformation`/
 * `ParameterInformation` для контекста провайдера: так её видит провайдер и в
 * VS Code. Форму гарантирует ядро — это эхо его же подсказки.
 */
export function toVscodeSignatureHelp(help: ICoreSignatureHelp): SignatureHelp {
    const result = new SignatureHelp();
    result.signatures = help.signatures.map(toVscodeSignature);
    result.activeSignature = help.activeSignature;
    result.activeParameter = help.activeParameter;
    return result;
}

function toVscodeSignature(signature: ICoreSignature): SignatureInformation {
    const info = new SignatureInformation(signature.label, signature.documentation);
    info.parameters = signature.parameters.map(
        (parameter) =>
            new ParameterInformation(
                typeof parameter.label === "string" ? parameter.label : [parameter.label[0], parameter.label[1]],
                parameter.documentation,
            ),
    );
    info.activeParameter = signature.activeParameter;
    return info;
}

/** Читает `label` элемента (строка или `CompletionItemLabel { label }`). */
function readLabel(item: vscode.CompletionItem): string | undefined {
    const label = (item as { label?: unknown }).label;
    if (typeof label === "string") return label;
    if (typeof label === "object" && label !== null && typeof (label as { label?: unknown }).label === "string") {
        return (label as { label: string }).label;
    }
    return undefined;
}

/**
 * Читает `labelDetails` (`labelDetailsSupport` объявляет за нас стоковый
 * languageclient): сигнатура рядом с лейблом (`(a: string): void`) и описание
 * источника (модуль авто-импорта).
 */
function readLabelDetails(item: vscode.CompletionItem): { detail?: string; description?: string } {
    const label = (item as { label?: unknown }).label;
    if (typeof label !== "object" || label === null) return {};
    const parts = label as { detail?: unknown; description?: unknown };
    return {
        ...(typeof parts.detail === "string" ? { detail: parts.detail } : {}),
        ...(typeof parts.description === "string" ? { description: parts.description } : {}),
    };
}

/**
 * Вырезает сниппет-синтаксис: `${1:name}` → `name`, `${1|a,b|}` → `a`,
 * `$1`/`$0` → ``, `\$` → `$`.
 *
 * Сниппет-сессий (табстопы) у нас нет, и заводить их в этой итерации мы не
 * стали — но и пускать `${1:name}` в буфер пользователя нельзя. Это страховка,
 * а не поддержка сниппетов.
 */
export function stripSnippetPlaceholders(value: string): string {
    // Экранированный `\$` прячем ПЕРВЫМ: иначе `\$5` разбирается как плейсхолдер
    // `$5`, и от него остаётся осиротевший обратный слэш.
    const ESCAPED_DOLLAR = "\u0000";
    return (
        value
            .replace(/\\\$/g, ESCAPED_DOLLAR)
            // `split(",", 1).join("")` вместо `[0]`: даёт первый вариант без ветки
            // «а вдруг массив пуст» (её не бывает, а покрытие требовало бы теста).
            .replace(/\$\{(\d+)\|([^|]*)\|\}/g, (_all, _index: string, choices: string) =>
                // Stryker disable next-line StringLiteral: эквивалентный разделитель `join` — `split(…, 1)` всегда даёт ровно один элемент, склеивать нечего; подмена разделителя `split` закрыта тестом «${1|foo,bar|}»
                choices.split(",", 1).join(""),
            )
            .replace(/\$\{\d+:([^}]*)\}/g, "$1")
            .replace(/\$\{\d+\}/g, "")
            .replace(/\$\d+/g, "")
            .replaceAll(ESCAPED_DOLLAR, "$")
    );
}

/**
 * Читает `insertText` (строка или `SnippetString { value }`); fallback — label.
 * У сниппет-пунктов плейсхолдеры вырезаются — см. {@link stripSnippetPlaceholders}.
 */
function readInsertText(item: vscode.CompletionItem, label: string): string {
    const insert = (item as { insertText?: unknown }).insertText;
    if (typeof insert === "string") return insert;
    if (insert instanceof SnippetString) return stripSnippetPlaceholders(insert.value);
    if (typeof insert === "object" && insert !== null && typeof (insert as { value?: unknown }).value === "string") {
        return (insert as { value: string }).value;
    }
    return label;
}

/** Читает `documentation` (строка или `MarkdownString { value }`). */
export function readDocumentation(item: vscode.CompletionItem): string | undefined {
    return readDocumentationText((item as { documentation?: unknown }).documentation);
}

/** `string | MarkdownString` → строка сырого markdown; чужая форма → `undefined`. */
function readDocumentationText(doc: unknown): string | undefined {
    if (typeof doc === "string") return doc;
    if (typeof doc === "object" && doc !== null && typeof (doc as { value?: unknown }).value === "string") {
        return (doc as { value: string }).value;
    }
    return undefined;
}

/**
 * Читает диапазон замены (`Range` или `{ replacing, inserting }`). Оба — по
 * форме, а не `instanceof`: `Range` чужого бандла (своя копия `vscode`-типов у
 * расширения) — тоже диапазон. Битый диапазон — `undefined` (ядро заменит слово).
 */
function readRange(item: vscode.CompletionItem): IRange | undefined {
    const raw = (item as { range?: unknown }).range;
    if (raw === undefined || raw === null) return undefined;
    const replacing = (raw as { replacing?: unknown }).replacing;
    return rangeFrom(replacing === undefined ? raw : replacing) ?? undefined;
}

/**
 * Сериализует `vscode.CompletionItem` в wire-форму (subprocess → host).
 * `id` — ключ элемента в кэше ответа, по нему host потом просит resolve.
 */
export function serializeCompletionItem(item: vscode.CompletionItem, id: string): ICoreCompletionItem | null {
    const label = readLabel(item);
    if (label === undefined || label === "") return null;
    const labelDetails = readLabelDetails(item);
    const command = (item as { command?: { command?: unknown; arguments?: unknown } | null }).command;
    const kind = (item as { kind?: unknown }).kind;
    const detail = (item as { detail?: unknown }).detail;
    const sortText = (item as { sortText?: unknown }).sortText;
    const filterText = (item as { filterText?: unknown }).filterText;
    const documentation = readDocumentation(item);
    const range = readRange(item);
    return {
        label,
        insertText: readInsertText(item, label),
        id,
        ...(labelDetails.detail !== undefined ? { labelDetail: labelDetails.detail } : {}),
        ...(labelDetails.description !== undefined ? { labelDescription: labelDetails.description } : {}),
        ...(isFiniteNumber(kind) ? { kind } : {}),
        ...(typeof detail === "string" ? { detail } : {}),
        ...(documentation !== undefined ? { documentation } : {}),
        ...(typeof command?.command === "string" && command.command !== ""
            ? {
                  command: {
                      command: command.command,
                      ...(Array.isArray(command.arguments) ? { arguments: command.arguments } : {}),
                  },
              }
            : {}),
        ...(range !== undefined ? { range } : {}),
        ...(typeof sortText === "string" ? { sortText } : {}),
        ...(typeof filterText === "string" ? { filterText } : {}),
    };
}

/**
 * Сериализует пункт инлайн-подсказки (утиный тип `vscode.InlineCompletionItem`):
 * `insertText` — строка либо `SnippetString` (плейсхолдеры вырезаются, чтобы
 * сниппет-синтаксис не попал ни в превью, ни в буфер). `null` — форма чужая
 * или текст пуст (drop+skip).
 */
export function serializeInlineCompletionItem(item: unknown): ICoreInlineCompletionItem | null {
    // Клауза typeof — защитная: не-объект без .insertText отсеет следующий
    // гард (примитив со строковым insertText невозможен) — её мутанты
    // эквивалентны. null отсекается по-настоящему (доступ к полю бросил бы).
    // Stryker disable next-line ConditionalExpression: см. выше
    if (typeof item !== "object" || item === null) return null;
    const obj = item as { insertText?: unknown; filterText?: unknown; range?: unknown };
    let insertText: string;
    if (typeof obj.insertText === "string") {
        insertText = obj.insertText;
    } else if (obj.insertText instanceof SnippetString) {
        insertText = stripSnippetPlaceholders(obj.insertText.value);
    } else {
        return null;
    }
    if (insertText === "") return null;
    const range = rangeFrom(obj.range);
    return {
        insertText,
        ...(typeof obj.filterText === "string" ? { filterText: obj.filterText } : {}),
        ...(range === null ? {} : { range }),
    };
}

/**
 * Сериализует `vscode.TextEdit` (утиный тип) в wire-правку текста
 * ({@link IWireEditorEdit}); `null` — форма чужая.
 */
export function serializeTextEdit(edit: unknown): IWireEditorEdit | null {
    if (typeof edit !== "object" || edit === null) return null;
    const e = edit as { range?: unknown; newText?: unknown };
    const range = rangeFrom(e.range);
    if (range === null || typeof e.newText !== "string") return null;
    return { range, text: e.newText };
}

/** Сериализует `vscode.FoldingRange` в wire-форму; `null`, если форма битая. */
export function serializeFoldingRange(range: vscode.FoldingRange): WireFoldingRange | null {
    const start = (range as { start?: unknown }).start;
    const end = (range as { end?: unknown }).end;
    // Клауза typeof — для сужения типа: не-число и так не проходит
    // `Number.isFinite`, так что её подмена на `false` эквивалентна.
    // Stryker disable next-line ConditionalExpression: см. выше
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    // Stryker disable next-line ConditionalExpression: см. выше
    if (typeof end !== "number" || !Number.isFinite(end)) return null;
    const kind = (range as { kind?: unknown }).kind;
    return {
        start,
        end,
        ...(isFiniteNumber(kind) ? { kind } : {}),
    };
}

/**
 * Сериализует `vscode.TextEdit` участника will-save в wire-форму (subprocess →
 * host): смена EOL или правка текста; `null` — поля правки испорчены (её
 * `range`/`newText` публичны и записываемы). Хост ответ will-save не перепроверяет.
 */
export function serializeWillSaveTextEdit(edit: TextEdit): WireTextEdit | null {
    if (edit.newEol !== undefined) {
        return { setEndOfLine: edit.newEol === EndOfLine.CRLF ? 2 : 1 };
    }
    return serializeTextEdit(edit);
}

/**
 * Сериализует правку из `WorkspaceEdit` в wire-форму `workspace.applyEdit`
 * (диапазон уже собран вызывающим — см. {@link rangeFrom}). Сниппет-правка
 * становится обычным текстом (плейсхолдеры вырезаются — как у completion,
 * интерактивных табстопов нет). Чистая EOL-правка (`TextEdit.setEndOfLine`)
 * текстом не является — пропускается (`null`).
 */
function serializeWorkspaceTextEdit(edit: TextEdit | SnippetTextEdit, range: IRange): IWireEditorEdit | null {
    if (edit instanceof SnippetTextEdit) {
        return { range, text: stripSnippetPlaceholders(edit.snippet.value) };
    }
    if (edit.newEol !== undefined && edit.newText === "" && edit.range.isEmpty) return null;
    return { range, text: edit.newText };
}

/**
 * Сериализует `WorkspaceEdit` в упорядоченный набор операций провода.
 *
 * Порядок операций сохраняется дословно: «Move to a new file» создаёт файл и
 * тут же пишет в него, а rename-рефакторинг правит импорты уже по новому пути.
 * Текстовая операция, у которой не осталось ни одной настоящей правки (один шум
 * вроде `TextEdit.setEndOfLine`), выпадает — применять там нечего. Правка с
 * битым диапазоном выпадает тоже, но операция, в которой битыми оказались ВСЕ
 * правки, — отказ всего edit'а (`null`): так же all-or-nothing её отбил бы
 * разбор хоста.
 */
export function serializeWorkspaceEdit(edit: WorkspaceEdit): IWireWorkspaceEditOp[] | null {
    const ops: IWireWorkspaceEditOp[] = [];
    for (const op of edit.operations()) {
        if (op.kind === "text") {
            const edits: IWireEditorEdit[] = [];
            let broken = false;
            for (const item of op.edits) {
                const range = rangeFrom(item.range);
                if (range === null) {
                    broken = true;
                    continue;
                }
                const serialized = serializeWorkspaceTextEdit(item, range);
                if (serialized !== null) edits.push(serialized);
            }
            if (edits.length === 0 && broken) return null;
            if (edits.length > 0) ops.push({ kind: "text", resource: op.uri.toString(), edits });
            continue;
        }
        if (op.kind === "rename") {
            ops.push({
                kind: "rename",
                from: op.from.toString(),
                to: op.to.toString(),
                ...(op.options.overwrite === true ? { overwrite: true } : {}),
                ...(op.options.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        if (op.kind === "create") {
            ops.push({
                kind: "create",
                resource: op.uri.toString(),
                ...(op.options.contents === undefined ? {} : { contents: op.options.contents }),
                ...(op.options.overwrite === true ? { overwrite: true } : {}),
                ...(op.options.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        ops.push({
            kind: "delete",
            resource: op.uri.toString(),
            ...(op.options.ignoreIfNotExists === true ? { ignoreIfNotExists: true } : {}),
        });
    }
    return ops;
}

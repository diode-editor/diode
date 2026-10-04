import type * as vscode from "vscode";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { describeRejection } from "../../../base/common/describeRejection.ts";
import type {
    ICoreParameterInfo,
    ICoreSignature,
    ICoreSignatureHelp,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";

import { scoreDocumentSelector, toWireLanguageFilters } from "./documentSelector.ts";
import type { ExtHostTextDocument } from "./extHostDocuments.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    CancellationTokenSource,
    CodeAction,
    CodeActionKind,
    CodeActionTriggerKind,
    CompletionTriggerKind,
    DisposableImpl,
    EventEmitter,
    InlineCompletionTriggerKind,
    Position,
    Range,
    SignatureHelpTriggerKind,
    SnippetString,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import type {
    IWireCodeActionParams,
    IWireFormattingParams,
    IWireLanguageProviderMetadata,
    IWireSignatureHelpParams,
    WireCodeAction,
    WireCompletionItem,
    WireCompletionResult,
    WireDefinitionLocation,
    WireFoldingRange,
    WireHover,
    WireInlineCompletionItem,
    WireLanguageFeatureKind,
    WireMarker,
    WireReference,
    WireRenamePrepare,
    WireRenameResult,
    WireResolvedCompletionItem,
    WireTextEdit,
} from "./wireTypes.ts";

/** `vscode.Diagnostic` (утиный тип) → {@link WireMarker}; кривые поля — к дефолтам. */
/**
 * Текст диагностики: строка как есть, rich-форма (`MarkdownString` и подобные) —
 * её `value`. Слепой `String()` дал бы здесь «[object Object]» в маркере.
 */
function messageText(message: unknown): string {
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

function toWireMarker(diag: unknown): WireMarker {
    const d = diag as {
        range?: { start: { line: number; character: number }; end: { line: number; character: number } };
        message?: unknown;
        severity?: unknown;
        code?: unknown;
        source?: unknown;
    };
    const r = d.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    // code бывает и rich-формой { value, target } (ссылка на доку правила —
    // так шлёт eslint); wire несёт только value, target TUI некуда открывать.
    const rawCode = typeof d.code === "object" && d.code !== null ? (d.code as { value?: unknown }).value : d.code;
    const code = typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : undefined;
    return {
        severity: typeof d.severity === "number" ? d.severity : 0,
        startLine: r.start.line,
        startCharacter: r.start.character,
        endLine: r.end.line,
        endCharacter: r.end.character,
        message: messageText(d.message),
        ...(code !== undefined ? { code } : {}),
        ...(typeof d.source === "string" ? { source: d.source } : {}),
    };
}

/** Зарегистрированный провайдер автодополнения. */
export interface ICompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CompletionItemProvider;
    readonly triggerCharacters: readonly string[];
}

/** Зарегистрированный inline-completion-провайдер (ghost text). */
export interface IInlineCompletionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.InlineCompletionItemProvider;
}

/** Зарегистрированный провайдер областей сворачивания. */
export interface IFoldingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.FoldingRangeProvider;
}

/** Зарегистрированный definition-провайдер. */
export interface IDefinitionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DefinitionProvider;
}

/** Зарегистрированный rename-провайдер. */
export interface IRenameRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.RenameProvider;
}

/** Зарегистрированный hover-провайдер. */
export interface IHoverRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.HoverProvider;
}

/** Зарегистрированный references-провайдер. */
export interface IReferenceRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.ReferenceProvider;
}

/**
 * Зарегистрированный провайдер подсказки параметров. Триггер- и
 * ретриггер-символы объявляет сервер: клиент передаёт их либо rest-аргументами,
 * либо объектом-метаданными (вторую форму он выбирает, когда сервер прислал
 * `retriggerCharacters`).
 */
export interface ISignatureHelpRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.SignatureHelpProvider;
    readonly triggerCharacters: readonly string[];
    readonly retriggerCharacters: readonly string[];
}

/**
 * Зарегистрированный code-action-провайдер. `providedKinds` — из
 * `CodeActionProviderMetadata.providedCodeActionKinds`: непустой список
 * позволяет НЕ спрашивать провайдера, когда запрошенный `only` заведомо
 * не пересекается с его видами.
 */
export interface ICodeActionRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.CodeActionProvider;
    readonly providedKinds: readonly string[];
}

/** Зарегистрированный провайдер форматирования документа. */
export interface IFormattingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentFormattingEditProvider;
}

/** Зарегистрированный провайдер форматирования диапазона. */
export interface IRangeFormattingRegistration {
    readonly selector: vscode.DocumentSelector;
    readonly provider: vscode.DocumentRangeFormattingEditProvider;
}

/** Wire-параметры запроса completion (host → subprocess). */
interface IWireCompletionParams {
    /** Провайдеры, выбранные ядром по селектору, в порядке реестра (пачка). */
    readonly handles?: readonly unknown[];
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
    /** `CompletionTriggerKind`; по умолчанию `Invoke`. */
    readonly triggerKind?: number;
    /** Символ-триггер, если запрос спровоцирован набором (`.`). */
    readonly triggerCharacter?: string;
}

/** Элемент кэша ответов completion — оригинальный объект провайдера + его владелец. */
interface ICachedCompletion {
    readonly item: vscode.CompletionItem;
    readonly provider: vscode.CompletionItemProvider;
}

/** Сколько последних ответов completion держим ради resolve. */
const COMPLETION_CACHE_DEPTH = 2;

/**
 * Кэшированный элемент ответа code actions: действие (тот же объект, что
 * вернул провайдер, — resolve обязан получить его же) + регистрация,
 * у чьего провайдера спрашивать resolveCodeAction.
 */
interface ICachedCodeAction {
    readonly item: vscode.CodeAction | vscode.Command;
    readonly registration: ICodeActionRegistration;
}

/** Пересечение диапазонов, границы включительно (как `vscode.Range.intersection`). */
function rangesIntersect(a: Range, b: Range): boolean {
    const startsBeforeOrAt = (x: Position, y: Position): boolean =>
        x.line < y.line || (x.line === y.line && x.character <= y.character);
    return startsBeforeOrAt(a.start, b.end) && startsBeforeOrAt(b.start, a.end);
}

/** Wire-параметры запроса inline completions (host → subprocess). */
interface IWireInlineCompletionParams {
    /** Провайдеры, выбранные ядром по селектору, в порядке реестра (пачка). */
    readonly handles?: readonly unknown[];
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
    /** `InlineCompletionTriggerKind`; по умолчанию `Automatic`. */
    readonly triggerKind?: number;
}

/** Wire-параметры запроса folding (host → subprocess). */
interface IWireFoldingParams {
    /** Провайдеры, выбранные ядром по селектору, в порядке реестра (пачка). */
    readonly handles?: readonly unknown[];
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
}

/** Wire-параметры запроса definition (host → subprocess). */
interface IWireDefinitionParams {
    /** Провайдер, выбранный ядром по селектору (см. `languages.register`). */
    readonly handle?: number;
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
}

/**
 * Wire-параметры обеих rename-ручек (host → subprocess), как их видит
 * субпроцесс: поля необязательны — что приехало по проводу, тем и является
 * (отправитель — `IWirePrepareRenameParams`/`IWireRenameParams` из wireTypes).
 */
interface IWireRenameRequestParams {
    /** Провайдер, выбранный ядром по селектору (см. `languages.register`). */
    readonly handle?: number;
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
    readonly newName?: unknown;
}

/** Wire-параметры запроса hover (host → subprocess). */
interface IWireHoverParams {
    /** Провайдер, выбранный ядром по селектору (см. `languages.register`). */
    readonly handle?: number;
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
}

/** Wire-параметры запроса references (host → subprocess). */
interface IWireReferenceParams {
    /** Провайдер, выбранный ядром по селектору (см. `languages.register`). */
    readonly handle?: number;
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly text?: string;
    readonly line?: number;
    readonly character?: number;
    readonly includeDeclaration?: boolean;
}

/** Сериализует `vscode.Range` (утиный тип) в wire-диапазон; `null`, если форма чужая. */
function serializeDefinitionRange(raw: unknown): WireDefinitionLocation["range"] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { start?: { line?: unknown; character?: unknown }; end?: { line?: unknown; character?: unknown } };
    const { start, end } = r;
    if (
        start == null ||
        end == null ||
        typeof start.line !== "number" ||
        typeof start.character !== "number" ||
        typeof end.line !== "number" ||
        typeof end.character !== "number"
    ) {
        return null;
    }
    return {
        startLine: start.line,
        startCharacter: start.character,
        endLine: end.line,
        endCharacter: end.character,
    };
}

/**
 * Сериализует один элемент результата definition-провайдера: `Location`
 * (`{ uri, range }`) или `LocationLink` (`{ targetUri, targetRange,
 * targetSelectionRange? }` — прицельный диапазон `targetSelectionRange ??
 * targetRange`). `null` — форма не распознана (drop+skip).
 */
function serializeDefinitionLocation(item: unknown): WireDefinitionLocation | null {
    if (typeof item !== "object" || item === null) return null;
    const link = item as { targetUri?: unknown; targetRange?: unknown; targetSelectionRange?: unknown };
    if (link.targetUri != null) {
        const range = serializeDefinitionRange(link.targetSelectionRange ?? link.targetRange);
        return range === null ? null : { uri: uriText(link.targetUri), range };
    }
    const loc = item as { uri?: unknown; range?: unknown };
    if (loc.uri == null) return null;
    const range = serializeDefinitionRange(loc.range);
    return range === null ? null : { uri: uriText(loc.uri), range };
}

/**
 * Сериализует ответ `prepareRename`: либо голый `Range`, либо
 * `{ range, placeholder }`. Placeholder, которого провайдер не прислал,
 * добирается текстом самого диапазона — ровно как обещает эталон («when
 * omitted the text in the returned range is used»); подстановка живёт здесь,
 * потому что документ есть только у субпроцесса. `null` — форма не распознана
 * (ядро спросит следующего провайдера).
 */
function serializeRenamePrepare(raw: unknown, doc: ExtHostTextDocument): WireRenamePrepare | null {
    // Своей проверки формы тут нет: `null`/`undefined` отсекает вызывающий
    // («провайдеру сказать нечего»), а примитив отсеет разбор диапазона ниже.
    const holder = raw as { range?: unknown; placeholder?: unknown };
    // Голый `Range` от `{range, placeholder}` отличает наличие поля `range`:
    // у самого Range его нет.
    const rangeSource = holder.range === undefined ? raw : holder.range;
    const range = serializeDefinitionRange(rangeSource);
    if (range === null) return null;
    if (typeof holder.placeholder === "string" && holder.placeholder !== "") {
        return { placeholder: holder.placeholder };
    }
    const text = doc.getText(
        new Range(
            new Position(range.startLine, range.startCharacter),
            new Position(range.endLine, range.endCharacter),
        ) as unknown as vscode.Range,
    );
    // Пустой диапазон не даёт имени: отвечаем «сказать нечего», и слово под
    // кареткой доберёт ядро.
    return text === "" ? null : { placeholder: text };
}

/**
 * Текст отклонения промиса провайдера для показа человеку. `Error` несёт
 * `message`, но провайдер вправе отклонить промис чем угодно — включая строку
 * и `undefined` (у отказа без причины остаётся родовое сообщение).
 */
function renameRejectReason(error: unknown): string {
    if (typeof error === "string" && error !== "") return error;
    const message = (error as { message?: unknown } | null | undefined)?.message;
    if (typeof message === "string" && message !== "") return message;
    return "Rename failed";
}

/**
 * Сериализует `contents` одного hover'а в блоки сырого markdown: строка,
 * `MarkdownString { value }` или legacy `MarkedString { language, value }`
 * (кодовый блок → fenced). Пустые и нераспознанные блоки отбрасываются
 * (drop+skip), разметку протокол не трогает — её стрипает UI-потребитель.
 */
function serializeHoverContents(raw: unknown): string[] {
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
 * Третий аргумент `registerSignatureHelpProvider`: либо объект-метаданные
 * (эту форму выбирает стоковый клиент, когда сервер прислал
 * `retriggerCharacters`), либо rest-строки триггер-символов.
 */
function readSignatureHelpMetadata(rest: readonly unknown[]): {
    triggerCharacters: readonly string[];
    retriggerCharacters: readonly string[];
} {
    const first = rest.at(0);
    // Stryker disable next-line ConditionalExpression: `null` третьим аргументом клиент не передаёт, а если бы передал — обе ветки дали бы пустые списки символов
    if (typeof first === "object" && first !== null) {
        const metadata = first as Partial<vscode.SignatureHelpProviderMetadata>;
        return {
            triggerCharacters: readStringList(metadata.triggerCharacters),
            retriggerCharacters: readStringList(metadata.retriggerCharacters),
        };
    }
    return { triggerCharacters: readStringList(rest), retriggerCharacters: [] };
}

/** Массив строк из утиного значения; всё лишнее отбрасывается. */
function readStringList(raw: unknown): readonly string[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string");
}

/**
 * `vscode.SignatureHelp` (утиный тип) → форма ядра; `null` — форма чужая или
 * подсказки нет. Разбор строгий: битая сигнатура или параметр отбраковывают
 * весь ответ, и хендлер спрашивает следующего провайдера. Причина та же, что у
 * `parseWireSignatureHelp`: `activeSignature`/`activeParameter` — индексы, и
 * выброс одного элемента сдвинул бы подсветку на соседний параметр молча.
 */
function serializeSignatureHelp(raw: unknown): ICoreSignatureHelp | null {
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
        activeSignature: typeof help.activeSignature === "number" ? help.activeSignature : 0,
        activeParameter: typeof help.activeParameter === "number" ? help.activeParameter : 0,
    };
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
        ...(documentation === undefined ? {} : { documentation }),
        ...(typeof item.activeParameter === "number" ? { activeParameter: item.activeParameter } : {}),
    };
}

/** Один параметр (`vscode.ParameterInformation`); `null` — форма чужая. */
function serializeParameter(raw: unknown): ICoreParameterInfo | null {
    if (!isDuckObject(raw)) return null;
    const item = raw as { label?: unknown; documentation?: unknown };
    const label = serializeParameterLabel(item.label);
    if (label === null) return null;
    const documentation = readDocumentationText(item.documentation);
    return { label, ...(documentation === undefined ? {} : { documentation }) };
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
    if (typeof start !== "number" || typeof end !== "number") return null;
    return [start, end];
}

/** Токен отмены-заглушка (запросы completion короткоживущие, отмена не нужна). */
function neverCancelledToken(): vscode.CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: new EventEmitter<unknown>().event,
    } as unknown as vscode.CancellationToken;
}

/**
 * Переводит транспортный токен RPC в `vscode.CancellationToken`. Отдать свой
 * напрямую нельзя: расширения ждут vscode-семантику `Event` (`thisArgs`,
 * `disposables`), которую даёт только {@link CancellationTokenSource} из
 * vscodeTypes. Возвращённый `dispose` снимает подписку на транспортный токен —
 * запрос отработал, держать слушателя больше незачем.
 */
function toVscodeCancellationToken(token: ICancellationToken): {
    token: vscode.CancellationToken;
    dispose: () => void;
} {
    const source = new CancellationTokenSource();
    // Уже отменённый токен зовёт слушателя синхронно — провайдер получит
    // отменённый токен, не успев начать (отмена обогнала запрос).
    const subscription = token.onCancellationRequested(() => {
        source.cancel();
    });
    return {
        token: source.token,
        // Уборка после отработавшего запроса: отписка от транспортного токена
        // наблюдаемого поведения не меняет (сам токен живёт ровно до ответа),
        // поэтому проверять тут нечего — только не течь.
        // Stryker disable BlockStatement,CallExpression: см. выше
        dispose: (): void => {
            subscription.dispose();
            source.dispose();
        },
        // Stryker restore BlockStatement,CallExpression
    };
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
function readDocumentation(item: vscode.CompletionItem): string | undefined {
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

/** Читает диапазон замены (`Range` или `{ replacing, inserting }`). */
function readRange(item: vscode.CompletionItem): WireCompletionItem["range"] {
    const raw = (item as { range?: unknown }).range;
    if (raw === undefined || raw === null) return undefined;
    const range =
        raw instanceof Range
            ? raw
            : typeof raw === "object" && (raw as { replacing?: unknown }).replacing instanceof Range
              ? (raw as { replacing: Range }).replacing
              : undefined;
    if (range === undefined) return undefined;
    return {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
    };
}

/**
 * Сериализует `vscode.CompletionItem` в wire-форму (subprocess → host).
 * `id` — ключ элемента в кэше ответа, по нему host потом просит resolve.
 */
function serializeCompletionItem(item: vscode.CompletionItem, id: string): WireCompletionItem | null {
    const label = readLabel(item);
    if (label === undefined || label === "") return null;
    const labelDetails = readLabelDetails(item);
    const command = (item as { command?: { command?: unknown; arguments?: unknown } }).command;
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
        ...(typeof kind === "number" ? { kind } : {}),
        ...(typeof detail === "string" ? { detail } : {}),
        ...(documentation !== undefined ? { documentation } : {}),
        ...(command !== undefined && typeof command.command === "string" && command.command !== ""
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
 * Нормализует результат провайдера в элементы + флаг «список неполный».
 * `isIncomplete` — не косметика: на нём стоит решение ядра перезапросить
 * провайдеров при доборе символа вместо локальной фильтрации (у tsserver
 * список почти всегда неполный).
 */
function normalizeResult(result: unknown): { items: readonly vscode.CompletionItem[]; isIncomplete: boolean } {
    if (result === undefined || result === null) return { items: [], isIncomplete: false };
    if (Array.isArray(result)) return { items: result as vscode.CompletionItem[], isIncomplete: false };
    const items = (result as { items?: unknown }).items;
    const isIncomplete = (result as { isIncomplete?: unknown }).isIncomplete === true;
    return { items: Array.isArray(items) ? (items as vscode.CompletionItem[]) : [], isIncomplete };
}

/**
 * Сериализует `vscode.TextEdit` (утиный тип) в общую wire-форму правки
 * ({@link WireTextEdit}, та же, что у save-участников); `null` — форма чужая.
 */
function serializeTextEdit(edit: unknown): WireTextEdit | null {
    if (typeof edit !== "object" || edit === null) return null;
    const e = edit as { range?: unknown; newText?: unknown };
    const range = serializeDefinitionRange(e.range);
    if (range === null || typeof e.newText !== "string") return null;
    return { range, text: e.newText };
}

/**
 * Пишет сбой провайдера в stderr субпроцесса (host зеркалит его в лог-канал).
 *
 * Молчаливый `catch` стоит здесь намеренно: сбойный провайдер не должен ломать
 * команду. Но МОЛЧАЛИВЫМ он быть не должен — на этом сгорел день отладки
 * стокового prettier: его `provideDocumentFormattingEdits` падал на
 * отсутствующем `TextDocument.positionAt`, снаружи это выглядело как «форматтер
 * ответил: менять нечего», и ни в одном логе следа не было (#381).
 */
function reportProviderFailure(method: string, err: unknown): void {
    console.error(`[ext-host] ${method} failed: ${describeRejection(err)}`);
}

/** Сериализует `vscode.FoldingRange` в wire-форму; `null`, если форма битая. */
function serializeFoldingRange(range: vscode.FoldingRange): WireFoldingRange | null {
    const start = (range as { start?: unknown }).start;
    const end = (range as { end?: unknown }).end;
    if (typeof start !== "number" || !Number.isFinite(start)) return null;
    if (typeof end !== "number" || !Number.isFinite(end)) return null;
    const kind = (range as { kind?: unknown }).kind;
    return {
        start,
        end,
        ...(typeof kind === "number" ? { kind } : {}),
    };
}

/**
 * `vscode.languages` на стороне subprocess.
 *
 * Хранит регистрации провайдеров автодополнения и обслуживает host-запрос
 * `languages.provideCompletionItems`: обновляет полный снапшот документа в
 * реестре, матчит `DocumentSelector`, вызывает провайдеры и сериализует
 * результат. Наличие провайдеров сигналится хосту через
 * `languages.updateSubscriptions` (0↔1) — без провайдеров хост не гоняет RPC.
 */
/**
 * Зависимости applyCodeAction, живущие в соседних namespace'ах: правки
 * применяются через `workspace.applyEdit` (RPC до хоста внутри), команды
 * действия — через `commands.executeCommand` (локальный реестр + прокси-мост).
 * Ассемблер передаёт настоящие функции; дефолт — честные отказы для тестов,
 * которым applyCodeAction не нужен.
 */
export interface ICodeActionDeps {
    readonly applyEdit: (edit: vscode.WorkspaceEdit) => Thenable<boolean>;
    readonly executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
}

const NULL_CODE_ACTION_DEPS: ICodeActionDeps = {
    // Stryker disable next-line ArrowFunction: `undefined` и `Promise<false>` для applyCodeAction неотличимы — оба читаются как «не применилось»
    applyEdit: () => Promise.resolve(false),
    // Stryker disable next-line StringLiteral: текст диагностического reject'а глотает catch applyCodeAction — ненаблюдаем
    executeCommand: () => Promise.reject(new Error("commands bridge is not wired")),
};

export function createLanguagesNamespace(
    ctx: IVscodeHostContext,
    codeActionDeps: ICodeActionDeps = NULL_CODE_ACTION_DEPS,
): {
    languages: typeof vscode.languages;
} {
    const { rpc, documentSync } = ctx;
    // Провайдеры фич, переехавших в реестр ядра: по handle, который ядро
    // присылает в запросе (upstream ExtHostLanguageFeatures._adapter).
    const hoverProviders = new Map<number, IHoverRegistration>();
    const definitionProviders = new Map<number, IDefinitionRegistration>();
    const referenceProviders = new Map<number, IReferenceRegistration>();
    const signatureHelpProviders = new Map<number, ISignatureHelpRegistration>();
    const completionProviders = new Map<number, ICompletionRegistration>();
    const formattingProviders = new Map<number, IFormattingRegistration>();
    const rangeFormattingProviders = new Map<number, IRangeFormattingRegistration>();
    const codeActionProviders = new Map<number, ICodeActionRegistration>();
    const foldingProviders = new Map<number, IFoldingRegistration>();
    const inlineCompletionProviders = new Map<number, IInlineCompletionRegistration>();
    const renameProviders = new Map<number, IRenameRegistration>();
    let nextProviderHandle = 0;

    /**
     * Регистрирует провайдера под новым handle и объявляет его реестру ядра
     * (`languages.register`): скоринг по селектору делает ядро, а субпроцесс
     * зовут уже с выбранным handle. Dispose снимает провайдера и в ядре
     * (`languages.unregister`).
     */
    function registerByHandle<T>(
        providers: Map<number, T>,
        kind: WireLanguageFeatureKind,
        selector: vscode.DocumentSelector,
        registration: T,
        metadata: IWireLanguageProviderMetadata = {},
    ): vscode.Disposable {
        const handle = nextProviderHandle++;
        providers.set(handle, registration);
        rpc.notify("languages.register", { handle, kind, selector: toWireLanguageFilters(selector), ...metadata });
        return new DisposableImpl(() => {
            if (providers.delete(handle)) rpc.notify("languages.unregister", { handle });
        }) as unknown as vscode.Disposable;
    }

    // Кэш ответов completion для resolve. Держим последние COMPLETION_CACHE_DEPTH
    // ответов: пользователь резолвит пункт из текущего списка, а гонка «ответ
    // пришёл, попап уже перезапросил» стоит одного лишнего ведра.
    const completionCache = new Map<number, readonly ICachedCompletion[]>();
    let nextCacheId = 1;

    function rememberCompletions(cacheId: number, items: readonly ICachedCompletion[]): void {
        completionCache.set(cacheId, items);
        // Вытесняем самые старые вёдра (Map хранит порядок вставки).
        const excess = completionCache.size - COMPLETION_CACHE_DEPTH;
        for (const key of [...completionCache.keys()].slice(0, excess)) completionCache.delete(key);
    }

    /** Достаёт элемент по id вида `"<cacheId>.<index>"`; `null` — ведро вытеснено. */
    function findCachedCompletion(id: string): ICachedCompletion | null {
        const [rawCacheId, rawIndex] = id.split(".");
        const bucket = completionCache.get(Number(rawCacheId));
        return bucket?.[Number(rawIndex)] ?? null;
    }

    // Кэш ответов code actions для apply/resolve — та же схема вёдер, что у
    // completion: применять нужно ТОТ ЖЕ объект действия, который вернул
    // провайдер (у клиента это ProtocolCodeAction с приватным `data`).
    const codeActionCache = new Map<number, readonly ICachedCodeAction[]>();

    function rememberCodeActions(cacheId: number, items: readonly ICachedCodeAction[]): void {
        codeActionCache.set(cacheId, items);
        const excess = codeActionCache.size - COMPLETION_CACHE_DEPTH;
        for (const key of [...codeActionCache.keys()].slice(0, excess)) codeActionCache.delete(key);
    }

    /** Достаёт действие по id вида `"<cacheId>.<index>"`; `null` — ведро вытеснено. */
    function findCachedCodeAction(id: string): ICachedCodeAction | null {
        const [rawCacheId, rawIndex] = id.split(".");
        const bucket = codeActionCache.get(Number(rawCacheId));
        return bucket?.[Number(rawIndex)] ?? null;
    }

    // Хранилища ВСЕХ DiagnosticCollection расширений: из них собирается
    // контекст code actions (те же объекты Diagnostic, что публиковал клиент).
    const diagnosticStores: Map<string, readonly vscode.Diagnostic[]>[] = [];

    /** Диагностики ресурса, пересекающиеся с диапазоном (по всем коллекциям). */
    function diagnosticsIntersecting(resource: string, range: Range): vscode.Diagnostic[] {
        const found: vscode.Diagnostic[] = [];
        for (const store of diagnosticStores) {
            // Stryker disable next-line ArrayDeclaration: фолбэк-массив немедленно фильтруется по range — содержимое ненаблюдаемо
            for (const diag of store.get(resource) ?? []) {
                const diagRange = (diag as { range?: Range }).range;
                if (diagRange === undefined) continue;
                if (rangesIntersect(diagRange, range)) found.push(diag);
            }
        }
        return found;
    }

    rpc.handleRequest("languages.provideDefinition", async (params): Promise<WireDefinitionLocation[]> => {
        const p = params as IWireDefinitionParams;
        // Провайдер мог сняться, пока запрос летел: отвечаем «целей нет».
        const reg = definitionProviders.get(p.handle ?? -1);
        if (reg === undefined) return [];
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        let result: unknown;
        try {
            result = await Promise.resolve(
                reg.provider.provideDefinition(
                    doc as unknown as vscode.TextDocument,
                    position as unknown as vscode.Position,
                    neverCancelledToken(),
                ),
            );
        } catch {
            // Сбойный провайдер = «целей нет»: `result` остаётся неприсвоенным,
            // и сериализация ниже его отбрасывает.
        }
        const locations: WireDefinitionLocation[] = [];
        for (const item of Array.isArray(result) ? result : [result]) {
            const wire = serializeDefinitionLocation(item);
            if (wire !== null) locations.push(wire);
        }
        return locations;
    });

    rpc.handleRequest("languages.provideHover", async (params): Promise<WireHover | null> => {
        const p = params as IWireHoverParams;
        // Провайдер мог сняться, пока запрос летел: отвечаем «hover'а нет».
        const reg = hoverProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        let result: unknown;
        try {
            result = await Promise.resolve(
                reg.provider.provideHover(
                    doc as unknown as vscode.TextDocument,
                    position as unknown as vscode.Position,
                    neverCancelledToken(),
                ),
            );
        } catch {
            // Сбойный провайдер = «hover'а нет»: `result` остаётся неприсвоенным,
            // и его отсеивает общая проверка ниже.
        }
        if (result == null) return null;
        const contents = serializeHoverContents((result as { contents?: unknown }).contents);
        if (contents.length === 0) return null;
        const range = serializeDefinitionRange((result as { range?: unknown }).range);
        return { contents, ...(range === null ? {} : { range }) };
    });

    rpc.handleRequest("languages.provideSignatureHelp", async (params): Promise<ICoreSignatureHelp | null> => {
        // Всё, кроме `uri`, читаем как необязательное: по RPC приезжает что
        // прислали, и дефолты ниже — не украшение, а обработка недоехавшего поля.
        const p = params as Pick<IWireSignatureHelpParams, "uri"> & Partial<IWireSignatureHelpParams>;
        // Провайдер мог сняться, пока запрос летел: отвечаем «подсказки нет».
        const reg = signatureHelpProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        const context = {
            triggerKind: p.triggerKind ?? SignatureHelpTriggerKind.Invoke,
            triggerCharacter: p.triggerCharacter,
            isRetrigger: p.isRetrigger === true,
            activeSignatureHelp: p.activeSignatureHelp,
        };
        let result: unknown;
        try {
            result = await Promise.resolve(
                reg.provider.provideSignatureHelp(
                    doc as unknown as vscode.TextDocument,
                    position as unknown as vscode.Position,
                    neverCancelledToken(),
                    context as unknown as vscode.SignatureHelpContext,
                ),
            );
        } catch {
            // Сбойный провайдер = «подсказки нет»: `result` остаётся
            // неприсвоенным, и его отсеивает сериализация ниже.
        }
        return serializeSignatureHelp(result);
    });

    rpc.handleRequest("languages.provideReferences", async (params): Promise<WireReference[]> => {
        const p = params as IWireReferenceParams;
        // Провайдер мог сняться, пока запрос летел: отвечаем «ссылок нет».
        const reg = referenceProviders.get(p.handle ?? -1);
        if (reg === undefined) return [];
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        const context = { includeDeclaration: p.includeDeclaration === true };
        let result: unknown;
        try {
            result = await Promise.resolve(
                reg.provider.provideReferences(
                    doc as unknown as vscode.TextDocument,
                    position as unknown as vscode.Position,
                    context as vscode.ReferenceContext,
                    neverCancelledToken(),
                ),
            );
        } catch {
            // Сбойный провайдер = «ссылок нет»: `result` остаётся неприсвоенным,
            // и его отсеивает общая проверка ниже.
        }
        // References — всегда массив (`ProviderResult<Location[]>`), в
        // отличие от definition с его одиночной формой.
        if (!Array.isArray(result)) return [];
        const references: WireReference[] = [];
        for (const item of result) {
            const wire = serializeDefinitionLocation(item);
            if (wire !== null) references.push(wire);
        }
        return references;
    });

    /**
     * Документ и позиция запроса rename. Обе ручки (`prepareRename` /
     * `provideRenameEdits`) принимают одну и ту же форму параметров, поэтому
     * синхронизация документа живёт одним хелпером.
     */
    function syncRenameTarget(p: IWireRenameRequestParams): { doc: ExtHostTextDocument; position: Position } {
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        return { doc, position: new Position(p.line ?? 0, p.character ?? 0) };
    }

    rpc.handleRequest("languages.prepareRename", async (params): Promise<WireRenamePrepare | null> => {
        const p = params as IWireRenameRequestParams;
        // Провайдер мог сняться, пока запрос летел: «сказать нечего».
        const reg = renameProviders.get(p.handle ?? -1);
        if (reg === undefined) return null;
        const prepare = reg.provider.prepareRename?.bind(reg.provider);
        // Провайдер без `prepareRename` — не отказ: эталон в этом случае
        // переименовывает слово под кареткой, а что считать словом — решает
        // ядро (у него есть текст и своя классификация символов).
        if (prepare === undefined) return null;
        const { doc, position } = syncRenameTarget(p);
        let result: unknown;
        try {
            result = await Promise.resolve(
                prepare(
                    doc as unknown as vscode.TextDocument,
                    position as unknown as vscode.Position,
                    neverCancelledToken(),
                ),
            );
        } catch (error) {
            // «Здесь переименовывать нельзя» эталон выражает именно отказом
            // промиса — это ответ провайдера, а не сбой, и причина едет человеку.
            return { rejectReason: renameRejectReason(error) };
        }
        if (result == null) return null;
        return serializeRenamePrepare(result, doc);
    });

    rpc.handleRequest("languages.provideRenameEdits", async (params): Promise<WireRenameResult> => {
        const p = params as IWireRenameRequestParams;
        // Провайдер мог сняться, пока запрос летел: «правок нет».
        const reg = renameProviders.get(p.handle ?? -1);
        if (reg === undefined) return { applied: false };
        const { newName } = p;
        if (typeof newName !== "string" || newName === "") {
            return { applied: false, error: "Rename requires a new name" };
        }
        const { doc, position } = syncRenameTarget(p);
        let edit: unknown;
        try {
            edit = await Promise.resolve(
                reg.provider.provideRenameEdits(
                    doc as unknown as vscode.TextDocument,
                    position as unknown as vscode.Position,
                    newName,
                    neverCancelledToken(),
                ),
            );
        } catch (error) {
            // Отклонённый промис — штатный канал «имя невалидно» эталона («If
            // the given name is not valid, the provider must return a rejected
            // promise»): сообщение провайдера едет человеку.
            return { applied: false, error: renameRejectReason(error) };
        }
        // Не-правки от провайдера («нет результата») — ядро спросит следующего.
        if (!(edit instanceof WorkspaceEdit)) return { applied: false };
        const ok = await codeActionDeps.applyEdit(edit as unknown as vscode.WorkspaceEdit);
        return ok ? { applied: true } : { applied: false, error: "Rename failed to apply edits" };
    });

    // Форматирование (#196): один RPC на оба вида — с `range` зовётся
    // range-провайдер (Format Selection, а также «синтетический» формат
    // документа range-провайдером на полный диапазон), без — документный.
    // Провайдера выбрало ядро (по score — `editor/contrib/format`); снятый или
    // чужой handle — пустой ответ, как и сбой провайдера (no-op).
    rpc.handleRequest("languages.provideFormattingEdits", async (params): Promise<WireTextEdit[]> => {
        const p = params as IWireFormattingParams;
        const handle = p.handle ?? -1;
        const range = p.range;
        // Вызов провайдера, выбранного ядром; `undefined` — handle снят или чужого вида.
        let format:
            | ((
                  doc: vscode.TextDocument,
                  options: vscode.FormattingOptions,
                  token: vscode.CancellationToken,
              ) => vscode.ProviderResult<vscode.TextEdit[]>)
            | undefined;
        if (range === undefined) {
            const reg = formattingProviders.get(handle);
            if (reg !== undefined) {
                format = (doc, options, token) => reg.provider.provideDocumentFormattingEdits(doc, options, token);
            }
        } else {
            const reg = rangeFormattingProviders.get(handle);
            if (reg !== undefined) {
                const selection = new Range(
                    range.startLine,
                    range.startCharacter,
                    range.endLine,
                    range.endCharacter,
                ) as unknown as vscode.Range;
                format = (doc, options, token) =>
                    reg.provider.provideDocumentRangeFormattingEdits(doc, selection, options, token);
            }
        }
        if (format === undefined) return [];
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const options = {
            tabSize: p.tabSize ?? 4,
            insertSpaces: p.insertSpaces ?? true,
        } as vscode.FormattingOptions;
        const token = neverCancelledToken();

        let result: unknown;
        try {
            result = await Promise.resolve(format(doc as unknown as vscode.TextDocument, options, token));
        } catch (err) {
            // Сбойный провайдер — пустой ответ (no-op), не «нет форматтера»:
            // `result` остаётся неприсвоенным, его отсеет проверка ниже. В
            // stderr — иначе сбой неотличим от «менять нечего».
            reportProviderFailure(
                range === undefined ? "provideDocumentFormattingEdits" : "provideDocumentRangeFormattingEdits",
                err,
            );
        }
        if (!Array.isArray(result)) return [];
        const edits: WireTextEdit[] = [];
        for (const item of result) {
            const wire = serializeTextEdit(item);
            if (wire !== null) edits.push(wire);
        }
        return edits;
    });

    // Code actions (#196): контекст-диагностики собираются ЗДЕСЬ из локальных
    // DiagnosticCollection (те же объекты, что публиковал клиент, — с приватным
    // `data`, по которому сервер матчит фиксы), а не едут с хоста lossy-копией.
    // Провайдера выбрало ядро (по селектору и `providedCodeActionKinds`);
    // снятый или чужой handle — пустой список.
    rpc.handleRequest("languages.provideCodeActions", async (params): Promise<WireCodeAction[]> => {
        const p = params as IWireCodeActionParams;
        const reg = codeActionProviders.get(p.handle ?? -1);
        if (reg === undefined) return [];
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const range = new Range(p.range.startLine, p.range.startCharacter, p.range.endLine, p.range.endCharacter);
        const only = typeof p.only === "string" ? new CodeActionKind(p.only) : undefined;
        const context = {
            triggerKind: CodeActionTriggerKind.Invoke,
            diagnostics: diagnosticsIntersecting(doc.uri.toString(), range),
            only,
        } as unknown as vscode.CodeActionContext;

        // Stryker disable next-line UpdateOperator: направление счётчика ненаблюдаемо — вёдра различает уникальность id, а не порядок
        const cacheId = nextCacheId++;
        const cached: ICachedCodeAction[] = [];
        const wire: WireCodeAction[] = [];
        let result: unknown;
        try {
            result = await Promise.resolve(
                reg.provider.provideCodeActions(
                    doc as unknown as vscode.TextDocument,
                    range as unknown as vscode.Range,
                    context,
                    neverCancelledToken(),
                ),
            );
        } catch {
            // Сбойный провайдер = «действий нет»: `result` остаётся
            // неприсвоенным, и его отсеивает проверка ниже.
        }
        if (!Array.isArray(result)) return [];
        // Элементы — `unknown`: что отдал провайдер расширения, тем и является;
        // до проверки заголовка это ещё не `CodeAction | Command`.
        for (const item of result as unknown[]) {
            // У примитива `title` читается как undefined — отсеется той же проверкой.
            if (typeof (item as { title?: unknown } | null | undefined)?.title !== "string") continue;
            // `only` фильтрует по виду; голые команды вида не имеют и при
            // запрошенном `only` отбрасываются (как в VS Code).
            const action: CodeAction | undefined = item instanceof CodeAction ? item : undefined;
            const kind = action?.kind;
            if (only !== undefined && (kind === undefined || !only.contains(kind))) continue;
            const id = `${String(cacheId)}.${String(cached.length)}`;
            cached.push({ item: item as vscode.CodeAction | vscode.Command, registration: reg });
            wire.push({
                id,
                title: (item as { title: string }).title,
                ...(kind === undefined ? {} : { kind: kind.value }),
                ...(action?.isPreferred === true ? { isPreferred: true } : {}),
            });
        }
        rememberCodeActions(cacheId, cached);
        return wire;
    });

    // Применение закэшированного действия: ленивый resolve (правки многих
    // серверов приезжают только по codeAction/resolve), затем правки через
    // `workspace.applyEdit` (существующий RPC до хоста) и команда действия.
    rpc.handleRequest("languages.applyCodeAction", async (params): Promise<boolean> => {
        const id = (params as { id?: unknown }).id;
        if (typeof id !== "string") return false;
        const found = findCachedCodeAction(id);
        if (found === null) return false;

        /** Исполняет команду действия; `false` — команда упала. */
        async function runActionCommand(command: vscode.Command): Promise<boolean> {
            try {
                await codeActionDeps.executeCommand(command.command, ...((command.arguments ?? []) as unknown[]));
                return true;
            } catch {
                return false;
            }
        }

        // Голая команда (`vscode.Command`): исполняем и всё.
        if (!(found.item instanceof CodeAction)) {
            return runActionCommand(found.item as vscode.Command);
        }

        let action: CodeAction = found.item;
        const resolve = found.registration.provider.resolveCodeAction?.bind(found.registration.provider);
        // Stryker disable next-line ConditionalExpression: подмена на true вызвала бы отсутствующий resolve, но TypeError упал бы внутри try и был бы проглочен — ненаблюдаемо
        const canResolve = resolve !== undefined;
        if (action.edit === undefined && canResolve) {
            try {
                const resolved = await Promise.resolve(resolve(action as never, neverCancelledToken()));
                if (resolved != null) action = resolved as CodeAction;
            } catch {
                // Сбойный resolve — применяем то, что есть (обычно command).
            }
        }

        let applied = false;
        if (action.edit instanceof WorkspaceEdit) {
            const ok = await codeActionDeps.applyEdit(action.edit as unknown as vscode.WorkspaceEdit);
            // Правки не легли — команду не запускаем: VS Code применяет edit
            // ПЕРЕД командой, и продолжать после отказа значило бы исполнить
            // действие наполовину.
            if (!ok) return false;
            applied = true;
        }
        const command = action.command as vscode.Command | undefined;
        if (command !== undefined && typeof command.command === "string") {
            if (!(await runActionCommand(command))) return false;
            applied = true;
        }
        return applied;
    });

    rpc.handleRequest("languages.provideCompletionItems", async (params): Promise<WireCompletionResult[]> => {
        const p = params as IWireCompletionParams;
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const position = new Position(p.line ?? 0, p.character ?? 0);
        const token = neverCancelledToken();
        const context = {
            triggerKind: p.triggerKind ?? CompletionTriggerKind.Invoke,
            triggerCharacter: p.triggerCharacter,
        } as unknown as vscode.CompletionContext;

        // Одно ведро кэша на пачку: id пунктов уникальны сквозь всех провайдеров.
        const cacheId = nextCacheId++;
        const cached: ICachedCompletion[] = [];
        const results: WireCompletionResult[] = [];
        // Провайдеров — в присланном ядром порядке; ответ выровнен по `handles`.
        // Снятый, пока запрос летел, или чужой handle — пустой результат.
        for (const handle of Array.isArray(p.handles) ? p.handles : []) {
            // Handle чужого типа Map.get и так не найдёт — отдельная проверка не нужна.
            const reg = completionProviders.get(handle as number);
            // Stryker disable next-line ConditionalExpression,BlockStatement: без проверки обращение к снятому провайдеру падает внутри try ниже, и провайдер получает тот же пустой результат
            if (reg === undefined) {
                results.push({ items: [], isIncomplete: false });
                continue;
            }
            const items: WireCompletionItem[] = [];
            let result: unknown;
            try {
                result = await Promise.resolve(
                    reg.provider.provideCompletionItems(
                        doc as unknown as vscode.TextDocument,
                        position as unknown as vscode.Position,
                        token,
                        context,
                    ),
                );
            } catch {
                // Сбойный провайдер = пустой результат: `result` остаётся
                // неприсвоенным, и нормализация ниже даёт пустой список.
            }
            const normalized = normalizeResult(result);
            for (const item of normalized.items) {
                // id выдаём ДО сериализации: resolve обязан получить тот же самый
                // объект, который вернул провайдер (у languageclient это
                // ProtocolCompletionItem с приватным `data` для completionItem/resolve).
                const id = `${String(cacheId)}.${String(cached.length)}`;
                const wire = serializeCompletionItem(item, id);
                if (wire === null) continue;
                cached.push({ item, provider: reg.provider });
                items.push(wire);
            }
            results.push({ items, isIncomplete: normalized.isIncomplete });
        }
        rememberCompletions(cacheId, cached);
        return results;
    });

    /**
     * `languages.resolveCompletionItem`: догружает detail/documentation/
     * additionalTextEdits выбранного пункта. Стоковый languageclient объявляет
     * серверу `resolveSupport` именно на эти три свойства — у tsserver в первом
     * ответе их нет вовсе.
     */
    rpc.handleRequest("languages.resolveCompletionItem", async (params): Promise<WireResolvedCompletionItem | null> => {
        const id = (params as { id?: unknown }).id;
        if (typeof id !== "string") return null;
        const entry = findCachedCompletion(id);
        if (entry === null) return null;
        const resolve = entry.provider.resolveCompletionItem?.bind(entry.provider);
        if (resolve === undefined) return null;

        let resolved: unknown;
        try {
            resolved = await Promise.resolve(resolve(entry.item, neverCancelledToken()));
        } catch {
            return null; // сбойный resolve не должен ронять попап
        }
        const item = (resolved ?? entry.item) as vscode.CompletionItem;
        const detail = (item as { detail?: unknown }).detail;
        const documentation = readDocumentation(item);
        const rawEdits = (item as { additionalTextEdits?: unknown }).additionalTextEdits;
        const additionalEdits: WireTextEdit[] = [];
        if (Array.isArray(rawEdits)) {
            for (const edit of rawEdits) {
                const wire = serializeTextEdit(edit);
                if (wire !== null) additionalEdits.push(wire);
            }
        }
        return {
            ...(typeof detail === "string" ? { detail } : {}),
            ...(documentation !== undefined ? { documentation } : {}),
            ...(additionalEdits.length > 0 ? { additionalEdits } : {}),
        };
    });

    /**
     * Сериализует пункт инлайн-подсказки (утиный тип `vscode.InlineCompletionItem`):
     * `insertText` — строка либо `SnippetString` (плейсхолдеры вырезаются, чтобы
     * сниппет-синтаксис не попал ни в превью, ни в буфер). `null` — форма чужая
     * или текст пуст (drop+skip).
     */
    function serializeInlineCompletionItem(item: unknown): WireInlineCompletionItem | null {
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
        const range = serializeDefinitionRange(obj.range);
        return {
            insertText,
            ...(typeof obj.filterText === "string" ? { filterText: obj.filterText } : {}),
            ...(range === null ? {} : { range }),
        };
    }

    rpc.handleRequest(
        "languages.provideInlineCompletions",
        async (params, cancellation): Promise<WireInlineCompletionItem[][]> => {
            const p = params as IWireInlineCompletionParams;
            const doc: ExtHostTextDocument = documentSync.sync({
                uri: p.uri,
                // Stryker disable next-line ConditionalExpression: `{languageId: undefined}` реестр трактует как отсутствие поля — обе ветки дают документ на дефолтном языке
                ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
                text: p.text ?? "",
            });
            const position = new Position(p.line ?? 0, p.character ?? 0);
            // Настоящий токен отмены (в отличие от остальных провайдеров): ядро
            // гасит устаревший запрос, и провайдер — в первую очередь платный
            // LLM — узнаёт об этом. Расширение на vscode-languageclient
            // превратит сработавший токен в `$/cancelRequest` языковому серверу.
            const cancel = toVscodeCancellationToken(cancellation);
            // selectedCompletionInfo не поддержан: пока открыт suggest-попап, ядро
            // ghost text не запрашивает вовсе (люфт v1 — docs/TODO/InlineCompletions.md).
            const context = {
                triggerKind: p.triggerKind ?? InlineCompletionTriggerKind.Automatic,
                selectedCompletionInfo: undefined,
            } as unknown as vscode.InlineCompletionContext;

            // Провайдеров — в присланном ядром порядке; ответ выровнен по
            // `handles`. Снятый, пока запрос летел, или чужой handle — пусто.
            const results: WireInlineCompletionItem[][] = [];
            try {
                for (const handle of Array.isArray(p.handles) ? p.handles : []) {
                    const items: WireInlineCompletionItem[] = [];
                    results.push(items);
                    // Отмена останавливает и обход пачки: спрашивать следующего
                    // провайдера про снапшот, который уже никому не нужен, — та
                    // же лишняя работа, от которой мы уходим.
                    if (cancel.token.isCancellationRequested) continue;
                    // Handle чужого типа Map.get и так не найдёт — отдельная проверка не нужна.
                    const reg = inlineCompletionProviders.get(handle as number);
                    // Stryker disable next-line ConditionalExpression: без проверки обращение к снятому провайдеру падает внутри try ниже, и провайдер получает тот же пустой список
                    if (reg === undefined) continue;
                    let result: unknown;
                    try {
                        result = await Promise.resolve(
                            reg.provider.provideInlineCompletionItems(
                                doc as unknown as vscode.TextDocument,
                                position as unknown as vscode.Position,
                                context,
                                cancel.token,
                            ),
                        );
                    } catch {
                        // Сбойный провайдер не роняет остальные: `result` остаётся
                        // неприсвоенным, и его отсеивает общая проверка ниже — своего
                        // `continue` тут нет намеренно, иначе ветка неотличима от неё
                        // (тот же приём, что у hover).
                    }
                    if (result == null) continue;
                    // `InlineCompletionItem[] | InlineCompletionList` — нормализуем к массиву.
                    const rawItems = Array.isArray(result) ? result : (result as { items?: unknown }).items;
                    if (!Array.isArray(rawItems)) continue;
                    for (const item of rawItems) {
                        const wire = serializeInlineCompletionItem(item);
                        if (wire !== null) items.push(wire);
                    }
                }
            } finally {
                // Stryker disable next-line CallExpression: уборка подписки, см. toVscodeCancellationToken
                cancel.dispose();
            }
            return results;
        },
    );

    rpc.handleRequest("languages.provideFoldingRanges", async (params): Promise<WireFoldingRange[][]> => {
        const p = params as IWireFoldingParams;
        const doc: ExtHostTextDocument = documentSync.sync({
            uri: p.uri,
            ...(typeof p.languageId === "string" ? { languageId: p.languageId } : {}),
            text: p.text ?? "",
        });
        const token = neverCancelledToken();
        const context = {} as vscode.FoldingContext;

        // Провайдеров — в присланном ядром порядке; ответ выровнен по `handles`.
        // Снятый, пока запрос летел, или чужой handle — пустой список.
        const results: WireFoldingRange[][] = [];
        for (const handle of Array.isArray(p.handles) ? p.handles : []) {
            // Handle чужого типа Map.get и так не найдёт — отдельная проверка не нужна.
            const reg = foldingProviders.get(handle as number);
            const ranges: WireFoldingRange[] = [];
            results.push(ranges);
            // Stryker disable next-line ConditionalExpression: без проверки обращение к снятому провайдеру падает внутри try ниже, и провайдер получает тот же пустой список
            if (reg === undefined) continue;
            let result: unknown;
            try {
                result = await Promise.resolve(
                    reg.provider.provideFoldingRanges(doc as unknown as vscode.TextDocument, context, token),
                );
            } catch {
                // Сбойный провайдер = пустой список: `result` остаётся
                // неприсвоенным, и его отсеивает проверка ниже.
            }
            if (!Array.isArray(result)) continue;
            for (const range of result as vscode.FoldingRange[]) {
                const wire = serializeFoldingRange(range);
                if (wire !== null) ranges.push(wire);
            }
        }
        return results;
    });

    // No-op регистрация провайдера — валидный Disposable; фича не работает,
    // но стоковый клиент (vscode-languageclient заводит провайдеры под
    // capabilities сервера) не падает. Шаги закрытия каждого — docs/TODO/LSP.md.
    const registerNoopProvider = (): vscode.Disposable =>
        new DisposableImpl(() => undefined) as unknown as vscode.Disposable;

    /**
     * Коллекция диагностик, форвардящая маркеры хосту нотификацией
     * `diagnostics.publish` — хост пишет их в `MarkerService`, откуда их
     * подхватывают squiggle-декорации редактора и панель Problems. Ресурс
     * нормализуется в `uri.toString()` (ключ MarkerService).
     */
    const createDiagnosticCollection = (name?: string): vscode.DiagnosticCollection => {
        const owner = "ext:" + (name ?? "diagnostics");
        // Оригинальные Diagnostic'и расширения (контракт get/forEach); wire-форма
        // считается на публикации.
        const store = new Map<string, readonly vscode.Diagnostic[]>();
        // Регистрируем хранилище для сборки контекста code actions: провайдер
        // должен видеть ТЕ ЖЕ объекты диагностик, что публиковал клиент.
        diagnosticStores.push(store);

        const resourceOf = (uri: unknown): string => {
            if (typeof uri === "string") return Uri.parse(uri).toString();
            return (uri as { toString(): string }).toString();
        };
        const publish = (resource: string, diags: readonly vscode.Diagnostic[]): void => {
            rpc.notify("diagnostics.publish", { owner, resource, markers: diags.map(toWireMarker) });
        };
        const setOne = (uri: unknown, diags: readonly vscode.Diagnostic[] | undefined): void => {
            const resource = resourceOf(uri);
            store.set(resource, diags ?? []);
            publish(resource, diags ?? []);
        };

        const collection = {
            name: name ?? "diagnostics",
            set: (arg: unknown, diags?: readonly vscode.Diagnostic[]): void => {
                // Перегрузка VS Code: set(uri, diags) | set([[uri, diags], …]).
                if (Array.isArray(arg)) {
                    for (const entry of arg as [unknown, readonly vscode.Diagnostic[] | undefined][]) {
                        setOne(entry[0], entry[1] ?? []);
                    }
                    return;
                }
                setOne(arg, diags);
            },
            delete: (uri: unknown): void => {
                const resource = resourceOf(uri);
                store.delete(resource);
                publish(resource, []);
            },
            clear: (): void => {
                for (const resource of store.keys()) publish(resource, []);
                store.clear();
            },
            forEach: (
                callback: (uri: unknown, diagnostics: readonly vscode.Diagnostic[], c: unknown) => unknown,
                thisArg?: unknown,
            ): void => {
                for (const [resource, diags] of store) callback.call(thisArg, Uri.parse(resource), diags, collection);
            },
            get: (uri: unknown): readonly vscode.Diagnostic[] | undefined => store.get(resourceOf(uri)),
            has: (uri: unknown): boolean => store.has(resourceOf(uri)),
            dispose: (): void => {
                collection.clear();
            },
            *[Symbol.iterator](): IterableIterator<[unknown, readonly vscode.Diagnostic[]]> {
                for (const [resource, diags] of store) yield [Uri.parse(resource), diags];
            },
        };
        return collection as unknown as vscode.DiagnosticCollection;
    };

    const languagesNs = {
        createDiagnosticCollection,
        // Наивный language status item: держатель полей с честным dispose, в UI
        // ничего не проецируется (в статус-баре места под язык-статус нет).
        // Ruff держит в нём состояние сервера и обновляет text/severity/busy.
        createLanguageStatusItem: (id: string, selector: vscode.DocumentSelector): vscode.LanguageStatusItem => ({
            id,
            selector,
            name: undefined,
            text: "",
            detail: undefined,
            severity: 0,
            command: undefined,
            busy: false,
            dispose: () => undefined,
        }),
        // Настоящий match: vscode-languageclient фильтрует ИМ документы для
        // синхронизации с сервером (textSynchronization.js) — наивный «всегда 10»
        // скармливал ts-серверу markdown и meta-обёртки, сервер ронял хендлеры.
        // Score тот же, что у реестра ядра: `*` — 5, точное совпадение — 10.
        match: (selector: vscode.DocumentSelector, document: vscode.TextDocument): number =>
            scoreDocumentSelector(selector, document as unknown as ExtHostTextDocument),

        registerCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CompletionItemProvider,
            ...triggerCharacters: string[]
        ): vscode.Disposable => {
            // Символы, после которых ядро само открывает попап («.» у tsserver):
            // сервер объявляет их в completionProvider, стоковый клиент — здесь.
            // Едут метаданными регистрации: ядро берёт их только у провайдеров,
            // подошедших документу.
            const registration: ICompletionRegistration = { selector, provider, triggerCharacters };
            return registerByHandle(completionProviders, "completion", selector, registration, {
                triggerCharacters: triggerCharacters.filter((char) => typeof char === "string" && char !== ""),
            });
        },
        registerFoldingRangeProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.FoldingRangeProvider,
        ): vscode.Disposable => registerByHandle(foldingProviders, "folding", selector, { selector, provider }),
        registerDefinitionProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DefinitionProvider,
        ): vscode.Disposable => registerByHandle(definitionProviders, "definition", selector, { selector, provider }),
        registerHoverProvider: (selector: vscode.DocumentSelector, provider: vscode.HoverProvider): vscode.Disposable =>
            registerByHandle(hoverProviders, "hover", selector, { selector, provider }),
        registerReferenceProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.ReferenceProvider,
        ): vscode.Disposable => registerByHandle(referenceProviders, "references", selector, { selector, provider }),
        registerRenameProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.RenameProvider,
        ): vscode.Disposable => registerByHandle(renameProviders, "rename", selector, { selector, provider }),

        registerSignatureHelpProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.SignatureHelpProvider,
            ...rest: (string | vscode.SignatureHelpProviderMetadata)[]
        ): vscode.Disposable => {
            const registration: ISignatureHelpRegistration = { selector, provider, ...readSignatureHelpMetadata(rest) };
            // Символы, после которых ядро само открывает подсказку («(», «,»,
            // «<» у tsserver), и ретриггеры («)») едут метаданными регистрации:
            // ядро берёт их только у провайдеров, подошедших документу.
            return registerByHandle(signatureHelpProviders, "signatureHelp", selector, registration, {
                triggerCharacters: registration.triggerCharacters,
                retriggerCharacters: registration.retriggerCharacters,
            });
        },

        registerDocumentFormattingEditProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentFormattingEditProvider,
        ): vscode.Disposable => registerByHandle(formattingProviders, "formatting", selector, { selector, provider }),

        registerDocumentRangeFormattingEditProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.DocumentRangeFormattingEditProvider,
        ): vscode.Disposable =>
            registerByHandle(rangeFormattingProviders, "rangeFormatting", selector, { selector, provider }),

        registerCodeActionsProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.CodeActionProvider,
            metadata?: vscode.CodeActionProviderMetadata,
        ): vscode.Disposable => {
            // Stryker disable next-line ArrayDeclaration: фолбэк-массив тут же вычищается map+filter — содержимое ненаблюдаемо
            const providedKinds = (metadata?.providedCodeActionKinds ?? [])
                .map((kind) => (kind as { value?: unknown }).value)
                .filter((value): value is string => typeof value === "string");
            const registration: ICodeActionRegistration = { selector, provider, providedKinds };
            // Виды едут метаданными: провайдера, чьи виды не пересекаются с
            // запрошенным `only`, ядро не спрашивает вовсе.
            return registerByHandle(codeActionProviders, "codeActions", selector, registration, {
                providedCodeActionKinds: providedKinds,
            });
        },

        // ── No-op провайдеры (поверхность, которую трогает vscode-languageclient
        // под capabilities сервера). Закрытие каждого — по образцу definition:
        // seam + RPC + UI-потребитель; см. таблицу стабов в docs/TODO/LSP.md. ──
        registerDeclarationProvider: registerNoopProvider,
        registerImplementationProvider: registerNoopProvider,
        registerTypeDefinitionProvider: registerNoopProvider,
        registerDocumentHighlightProvider: registerNoopProvider,
        registerDocumentSymbolProvider: registerNoopProvider,
        registerWorkspaceSymbolProvider: registerNoopProvider,
        registerCodeLensProvider: registerNoopProvider,
        registerDocumentLinkProvider: registerNoopProvider,
        registerColorProvider: registerNoopProvider,
        registerOnTypeFormattingEditProvider: registerNoopProvider,
        registerSelectionRangeProvider: registerNoopProvider,
        registerDocumentSemanticTokensProvider: registerNoopProvider,
        registerDocumentRangeSemanticTokensProvider: registerNoopProvider,
        registerInlayHintsProvider: registerNoopProvider,
        registerInlineValuesProvider: registerNoopProvider,
        registerInlineCompletionItemProvider: (
            selector: vscode.DocumentSelector,
            provider: vscode.InlineCompletionItemProvider,
        ): vscode.Disposable =>
            registerByHandle(inlineCompletionProviders, "inlineCompletions", selector, { selector, provider }),
        registerLinkedEditingRangeProvider: registerNoopProvider,
        registerCallHierarchyProvider: registerNoopProvider,
        registerTypeHierarchyProvider: registerNoopProvider,
    };

    return {
        languages: languagesNs as unknown as typeof vscode.languages,
    };
}

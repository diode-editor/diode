import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

/**
 * Чистые value-типы `vscode`, раздаваемые расширениям внутри subprocess.
 *
 * Здесь нет никакого RPC и ссылок на host-сервисы — это конструируемые
 * расширением объекты (`new vscode.Position(...)`, `vscode.Uri.file(...)`,
 * `vscode.TextEdit.replace(...)`). Ассемблер {@link ../VscodeNamespace.ts}
 * отдаёт эти классы/enum'ы как runtime-поля объекта `vscode`.
 *
 * Сигнатуры повторяют закомментированный `src/Extensions/Api/vscode.d.ts`.
 */

/** Совместимая с `vscode.Disposable`. Возвращается из подписочных API. */
export class DisposableImpl implements vscode.Disposable {
    private readonly callOnDispose: () => unknown;

    public constructor(callOnDispose: () => unknown) {
        this.callOnDispose = callOnDispose;
    }

    public dispose(): unknown {
        return this.callOnDispose();
    }

    public static from(...items: { dispose: () => unknown }[]): DisposableImpl {
        return new DisposableImpl(() => {
            for (const item of items) item.dispose();
        });
    }
}

/** Иммутабельная позиция (0-based line/character). */
export class Position implements vscode.Position {
    public readonly line: number;
    public readonly character: number;

    public constructor(line: number, character: number) {
        this.line = Math.max(0, line);
        this.character = Math.max(0, character);
    }

    public isBefore(other: Position): boolean {
        if (this.line < other.line) return true;
        if (this.line > other.line) return false;
        return this.character < other.character;
    }

    public isBeforeOrEqual(other: Position): boolean {
        return this.isBefore(other) || this.isEqual(other);
    }

    public isAfter(other: Position): boolean {
        return other.isBefore(this);
    }

    public isAfterOrEqual(other: Position): boolean {
        return other.isBeforeOrEqual(this);
    }

    public isEqual(other: Position): boolean {
        return this.line === other.line && this.character === other.character;
    }

    public compareTo(other: Position): number {
        if (this.line < other.line) return -1;
        if (this.line > other.line) return 1;
        if (this.character < other.character) return -1;
        if (this.character > other.character) return 1;
        return 0;
    }

    public translate(lineDelta?: number, characterDelta?: number): Position;
    public translate(change: { lineDelta?: number; characterDelta?: number }): Position;
    public translate(
        lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
        characterDelta = 0,
    ): Position {
        let lineDelta = 0;
        let charDelta = characterDelta;
        if (typeof lineDeltaOrChange === "object") {
            lineDelta = lineDeltaOrChange.lineDelta ?? 0;
            charDelta = lineDeltaOrChange.characterDelta ?? 0;
        } else if (typeof lineDeltaOrChange === "number") {
            lineDelta = lineDeltaOrChange;
        }
        if (lineDelta === 0 && charDelta === 0) return this;
        return new Position(this.line + lineDelta, this.character + charDelta);
    }

    public with(line?: number, character?: number): Position;
    public with(change: { line?: number; character?: number }): Position;
    public with(lineOrChange?: number | { line?: number; character?: number }, character?: number): Position {
        let newLine = this.line;
        let newCharacter = character ?? this.character;
        if (typeof lineOrChange === "object") {
            newLine = lineOrChange.line ?? this.line;
            newCharacter = lineOrChange.character ?? this.character;
        } else if (typeof lineOrChange === "number") {
            newLine = lineOrChange;
        }
        if (newLine === this.line && newCharacter === this.character) return this;
        return new Position(newLine, newCharacter);
    }
}

/** Иммутабельный диапазон; `start.isBeforeOrEqual(end)` гарантирован. */
export class Range implements vscode.Range {
    public readonly start: Position;
    public readonly end: Position;

    public constructor(start: Position, end: Position);
    public constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
    public constructor(
        startOrStartLine: Position | number,
        endOrStartCharacter?: Position | number,
        endLine?: number,
        endCharacter?: number,
    ) {
        let start: Position;
        let end: Position;
        if (typeof startOrStartLine === "number") {
            start = new Position(startOrStartLine, endOrStartCharacter as number);
            /* v8 ignore start -- defensive: the numeric overload always supplies endLine/endCharacter */
            end = new Position(endLine ?? 0, endCharacter ?? 0);
            /* v8 ignore stop */
        } else {
            start = startOrStartLine;
            end = endOrStartCharacter as Position;
        }
        if (start.isBeforeOrEqual(end)) {
            this.start = start;
            this.end = end;
        } else {
            this.start = end;
            this.end = start;
        }
    }

    public get isEmpty(): boolean {
        return this.start.isEqual(this.end);
    }

    public get isSingleLine(): boolean {
        return this.start.line === this.end.line;
    }

    public contains(positionOrRange: Position | Range): boolean {
        if (positionOrRange instanceof Range) {
            return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
        }
        return positionOrRange.isAfterOrEqual(this.start) && positionOrRange.isBeforeOrEqual(this.end);
    }

    public isEqual(other: Range): boolean {
        return this.start.isEqual(other.start) && this.end.isEqual(other.end);
    }

    public intersection(other: Range): Range | undefined {
        const start = this.start.isAfter(other.start) ? this.start : other.start;
        const end = this.end.isBefore(other.end) ? this.end : other.end;
        if (start.isAfter(end)) return undefined;
        return new Range(start, end);
    }

    public union(other: Range): Range {
        const start = this.start.isBefore(other.start) ? this.start : other.start;
        const end = this.end.isAfter(other.end) ? this.end : other.end;
        return new Range(start, end);
    }

    public with(start?: Position, end?: Position): Range;
    public with(change: { start?: Position; end?: Position }): Range;
    public with(startOrChange?: Position | { start?: Position; end?: Position }, end?: Position): Range {
        let newStart = this.start;
        let newEnd = end ?? this.end;
        if (startOrChange instanceof Position) {
            newStart = startOrChange;
        } else if (startOrChange != null) {
            newStart = startOrChange.start ?? this.start;
            newEnd = startOrChange.end ?? this.end;
        }
        if (newStart.isEqual(this.start) && newEnd.isEqual(this.end)) return this;
        return new Range(newStart, newEnd);
    }
}

/**
 * Выделение в редакторе (`vscode.Selection`). Наследует {@link Range}
 * (`start`/`end` упорядочены), но дополнительно помнит направление: `anchor` —
 * неподвижный конец, `active` — конец с курсором. `isReversed` истинно, когда
 * курсор стоит перед якорем.
 */
export class Selection extends Range implements vscode.Selection {
    public readonly anchor: Position;
    public readonly active: Position;

    public constructor(anchor: Position, active: Position);
    public constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number);
    public constructor(
        anchorOrAnchorLine: Position | number,
        activeOrAnchorCharacter?: Position | number,
        activeLine?: number,
        activeCharacter?: number,
    ) {
        let anchor: Position;
        let active: Position;
        if (typeof anchorOrAnchorLine === "number") {
            anchor = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number);
            /* v8 ignore start -- defensive: the numeric overload always supplies activeLine/activeCharacter */
            active = new Position(activeLine ?? 0, activeCharacter ?? 0);
            /* v8 ignore stop */
        } else {
            anchor = anchorOrAnchorLine;
            active = activeOrAnchorCharacter as Position;
        }
        super(anchor, active);
        this.anchor = anchor;
        this.active = active;
    }

    public get isReversed(): boolean {
        return this.active.isBefore(this.anchor);
    }
}

/**
 * `vscode.Location` — позиция внутри ресурса (цель definition/references).
 * Position в конструкторе сворачивается в пустой Range (контракт vscode.d.ts).
 */
export class Location implements vscode.Location {
    public uri: Uri;
    public range: Range;

    public constructor(uri: Uri, rangeOrPosition: Range | Position) {
        this.uri = uri;
        this.range = rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
    }
}

/** Направление перевода строки. */
export enum EndOfLine {
    LF = 1,
    CRLF = 2,
}

/** Причина сохранения (используется will-save участниками, WP6). */
export enum TextDocumentSaveReason {
    Manual = 1,
    AfterDelay = 2,
    FocusOut = 3,
}

/**
 * Цель `WorkspaceConfiguration.update` — расширения передают её явно
 * (`config.update(key, value, vscode.ConfigurationTarget.Global)`).
 */
export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
}

/** Причина транзакционной правки документа (`TextDocumentChangeEvent.reason`). */
export enum TextDocumentChangeReason {
    Undo = 1,
    Redo = 2,
}

/** Тип записи файловой системы. */
export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

/** Вид изменения ресурса, о котором сообщает `FileSystemProvider.onDidChangeFile`. */
export enum FileChangeType {
    Changed = 1,
    Created = 2,
    Deleted = 3,
}

/** Одиночная текстовая правка либо смена EOL всего документа. */
export class TextEdit implements vscode.TextEdit {
    public range: Range;
    public newText: string;
    public newEol?: EndOfLine;

    public constructor(range: Range, newText: string) {
        this.range = range;
        this.newText = newText;
    }

    public static replace(range: Range, newText: string): TextEdit {
        return new TextEdit(range, newText);
    }

    public static insert(position: Position, newText: string): TextEdit {
        return new TextEdit(new Range(position, position), newText);
    }

    public static delete(range: Range): TextEdit {
        return new TextEdit(range, "");
    }

    public static setEndOfLine(eol: EndOfLine): TextEdit {
        const edit = new TextEdit(new Range(new Position(0, 0), new Position(0, 0)), "");
        edit.newEol = eol;
        return edit;
    }
}

/**
 * Сниппет-правка (`vscode.SnippetTextEdit`). Класс-ловушка конвертера клиента:
 * на LSP `SnippetTextEdit` он делает `new code.SnippetTextEdit(...)` — без
 * класса упала бы конвертация всего `WorkspaceEdit`. Интерактивных табстопов
 * у нас нет: применение вырезает плейсхолдеры (как у completion-сниппетов).
 */
export class SnippetTextEdit {
    public range: Range;
    public snippet: SnippetString;
    public keepWhitespace?: boolean;

    public constructor(range: Range, snippet: SnippetString) {
        this.range = range;
        this.snippet = snippet;
    }

    public static replace(range: Range, snippet: SnippetString): SnippetTextEdit {
        return new SnippetTextEdit(range, snippet);
    }

    public static insert(position: Position, snippet: SnippetString): SnippetTextEdit {
        return new SnippetTextEdit(new Range(position, position), snippet);
    }
}

/**
 * Разновидность области сворачивания (`vscode.FoldingRangeKind`). Значения
 * совпадают с VS Code; `Region` — маркеры `#region`/`#endregion`.
 */
export enum FoldingRangeKind {
    Comment = 1,
    Imports = 2,
    Region = 3,
}

/**
 * Область сворачивания (`vscode.FoldingRange`): строки `start..end` (0-based).
 * Провайдеры расширений возвращают её из `provideFoldingRanges`; хост
 * сериализует в `WireFoldingRange` (kind — числом).
 */
export class FoldingRange implements vscode.FoldingRange {
    public start: number;
    public end: number;
    public kind?: FoldingRangeKind;

    public constructor(start: number, end: number, kind?: FoldingRangeKind) {
        this.start = start;
        this.end = end;
        this.kind = kind;
    }
}

/**
 * URI ресурса — ре-экспорт ядрового {@link Uri} (`Common/Uri.ts`, upstream
 * `vscode-uri`). Раньше здесь жил самописный file-only шим: он не разбирал схемы
 * без `//` (`untitled:Untitled-1` парсился как file-путь), отдавал `path` из
 * `fsPath` для любой схемы и терял authority/query/fragment. Ядро и субпроцесс
 * теперь адресуют ресурс одним и тем же типом.
 */
export { Uri };

/**
 * Ошибка файловой системы (`vscode.FileSystemError`). Реализация `workspace.fs`
 * бросает её через фабрики; `code` совпадает с именем фабрики, как в VS Code
 * (расширения ловят по `err.code === "FileNotFound"`).
 *
 * `name` повторяет формат VS Code `"${providerCode} (FileSystemError)"`, где
 * `providerCode` — имя из `FileSystemProviderErrorCode` (FileNotFound →
 * `EntryNotFound`). Некоторые расширения (стоковый editorconfig-vscode) ловят
 * именно по `err.name === "EntryNotFound (FileSystemError)"`, а не по `code`.
 */
const PROVIDER_CODE_NAME: Record<string, string> = {
    FileNotFound: "EntryNotFound",
    FileExists: "EntryExists",
    FileNotADirectory: "EntryNotADirectory",
    FileIsADirectory: "EntryIsADirectory",
    NoPermissions: "NoPermissions",
    Unavailable: "Unavailable",
    Unknown: "Unknown",
};

export class FileSystemError extends Error implements vscode.FileSystemError {
    public readonly code: string;

    public constructor(messageOrUri?: string | Uri, code = "Unknown") {
        super(typeof messageOrUri === "string" ? messageOrUri : messageOrUri?.toString());
        this.name = `${PROVIDER_CODE_NAME[code] ?? code} (FileSystemError)`;
        this.code = code;
    }

    public static FileNotFound(messageOrUri?: string | Uri): FileSystemError {
        return new FileSystemError(messageOrUri, "FileNotFound");
    }

    public static FileExists(messageOrUri?: string | Uri): FileSystemError {
        return new FileSystemError(messageOrUri, "FileExists");
    }

    public static FileNotADirectory(messageOrUri?: string | Uri): FileSystemError {
        return new FileSystemError(messageOrUri, "FileNotADirectory");
    }

    public static FileIsADirectory(messageOrUri?: string | Uri): FileSystemError {
        return new FileSystemError(messageOrUri, "FileIsADirectory");
    }

    public static NoPermissions(messageOrUri?: string | Uri): FileSystemError {
        return new FileSystemError(messageOrUri, "NoPermissions");
    }

    public static Unavailable(messageOrUri?: string | Uri): FileSystemError {
        return new FileSystemError(messageOrUri, "Unavailable");
    }
}

/** Разновидность элемента автодополнения. */
export enum CompletionItemKind {
    Text = 0,
    Method = 1,
    Function = 2,
    Constructor = 3,
    Field = 4,
    Variable = 5,
    Class = 6,
    Interface = 7,
    Module = 8,
    Property = 9,
    Unit = 10,
    Value = 11,
    Enum = 12,
    Keyword = 13,
    Snippet = 14,
    Color = 15,
    File = 16,
    Reference = 17,
    Folder = 18,
    EnumMember = 19,
    Constant = 20,
    Struct = 21,
    Event = 22,
    Operator = 23,
    TypeParameter = 24,
    User = 25,
    Issue = 26,
}

/** Чем спровоцирован запрос автодополнения (`CompletionContext.triggerKind`). */
export enum CompletionTriggerKind {
    Invoke = 0,
    TriggerCharacter = 1,
    TriggerForIncompleteCompletions = 2,
}

/** Элемент автодополнения. Сериализуется хостом в `ICoreCompletionItem` (WP8). */
export class CompletionItem implements vscode.CompletionItem {
    public label: string;
    public kind?: CompletionItemKind;
    public insertText?: string;
    public detail?: string;
    public documentation?: string;
    public command?: { command: string; title: string; arguments?: unknown[] };
    public range?: Range;
    public sortText?: string;
    public filterText?: string;
    public preselect?: boolean;

    public constructor(label: string, kind?: CompletionItemKind) {
        this.label = label;
        this.kind = kind;
    }
}

/**
 * Список автодополнений с флагом «неполный» (`vscode.CompletionList`).
 *
 * Не украшение API: стоковый `vscode-languageclient` конструирует его на КАЖДЫЙ
 * ответ сервера (`protocolConverter.asCompletionResult`), а
 * `typescript-language-server` всегда отвечает списком. Без этого класса
 * конвертация ответа падала целиком, и ошибка уходила только в
 * `client.outputChannel` — LSP-пунктов в попапе не было вовсе.
 */
export class CompletionList<T extends vscode.CompletionItem = CompletionItem> implements vscode.CompletionList<T> {
    public items: T[];
    public isIncomplete: boolean;

    public constructor(items: T[] = [], isIncomplete = false) {
        this.items = items;
        this.isIncomplete = isIncomplete;
    }
}

/** Чем спровоцирован запрос инлайн-подсказки (`InlineCompletionContext.triggerKind`). */
export enum InlineCompletionTriggerKind {
    Invoke = 0,
    Automatic = 1,
}

/**
 * Пункт инлайн-подсказки (`vscode.InlineCompletionItem`). Конструктор — как в
 * d.ts: `(insertText, range?, command?)`. Понадобится и конвертеру стокового
 * `vscode-languageclient` (он делает `new code.InlineCompletionItem(...)` на
 * каждый ответ сервера — отсутствие класса молча убивает фичу целиком).
 */
export class InlineCompletionItem {
    public insertText: string | SnippetString;
    public filterText?: string;
    public range?: Range;
    public command?: { command: string; title: string; arguments?: unknown[] };

    public constructor(
        insertText: string | SnippetString,
        range?: Range,
        command?: { command: string; title: string; arguments?: unknown[] },
    ) {
        this.insertText = insertText;
        this.range = range;
        this.command = command;
    }
}

/** Список инлайн-подсказок (`vscode.InlineCompletionList`). */
export class InlineCompletionList {
    public items: InlineCompletionItem[];

    public constructor(items: InlineCompletionItem[]) {
        this.items = items;
    }
}

/**
 * Текст вставки со сниппет-синтаксисом (`vscode.SnippetString`). Сниппет-сессий
 * (табстопы, Tab-переходы) у нас нет — класс нужен как носитель значения:
 * languageclient оборачивает в него `insertText` пунктов с
 * `insertTextFormat = Snippet`, а хост-сериализатор читает `.value` и вырезает
 * плейсхолдеры, чтобы синтаксис сниппета не попал в буфер.
 */
export class SnippetString {
    public value: string;

    public constructor(value = "") {
        this.value = value;
    }

    public appendText(value: string): this {
        this.value += value;
        return this;
    }
}

/**
 * Ссылка на цвет из реестра цветов темы (`vscode.ThemeColor`). Расширение
 * создаёт `new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")`;
 * хост-сериализатор превращает её в `{ $themeColor: id }`, а resolve в конкретный
 * packed-RGB делает уже сторона host'а через тему (см. IThemeColorResolver).
 */
export class ThemeColor implements vscode.ThemeColor {
    public readonly id: string;

    public constructor(id: string) {
        this.id = id;
    }
}

/**
 * `vscode.RelativePattern` — glob, привязанный к базовому каталогу.
 *
 * Базой может быть папка воркспейса, `Uri` или голая строка-путь. `base` и
 * `baseUri` держатся синхронно: upstream объявляет оба поля, причём `base`
 * задокументирован как «обновление этого значения обновит baseUri» — поэтому
 * это не два независимых поля, а аксессор поверх одного `Uri`.
 */
export class RelativePattern {
    private baseUriValue: Uri;
    public pattern: string;

    public constructor(base: vscode.WorkspaceFolder | Uri | string, pattern: string) {
        this.baseUriValue = toBaseUri(base);
        this.pattern = pattern;
    }

    public get baseUri(): Uri {
        return this.baseUriValue;
    }

    public set baseUri(value: Uri) {
        this.baseUriValue = value;
    }

    /** @deprecated upstream — оставлен ради дословности поверхности. */
    public get base(): string {
        return this.baseUriValue.fsPath;
    }

    public set base(value: string) {
        this.baseUriValue = Uri.file(value);
    }
}

/** База `RelativePattern` → `Uri`: WorkspaceFolder (у него есть `.uri`), Uri или путь строкой. */
function toBaseUri(base: vscode.WorkspaceFolder | Uri | string): Uri {
    if (typeof base === "string") return Uri.file(base);
    if (base instanceof Uri) return base;
    const folderUri = (base as { uri?: unknown }).uri;
    if (folderUri instanceof Uri) return folderUri;
    // Чужая реализация Uri (другой рантайм внутри расширения) — берём её строку.
    if (typeof folderUri === "object" && folderUri !== null)
        return Uri.parse((folderUri as { toString(): string }).toString());
    throw new TypeError("RelativePattern: base must be a WorkspaceFolder, Uri or string");
}

/**
 * Позиция change-бара в overview ruler. Значение важно как *признак*
 * «это gutter/overview-декорация» — host заводит gutter-тип только у декораций
 * с `overviewRulerColor` (см. ExtensionHost RPC-реестр).
 */
export enum OverviewRulerLane {
    Left = 1,
    Center = 2,
    Right = 4,
    Full = 7,
}

/** Поведение диапазона декорации при правках на его границах. */
export enum DecorationRangeBehavior {
    OpenOpen = 0,
    ClosedClosed = 1,
    OpenClosed = 2,
    ClosedOpen = 3,
}

/**
 * Декорация файла в дереве (`vscode.FileDecoration`): короткий бейдж, тултип и
 * цвет из реестра темы. `provideFileDecoration` провайдера возвращает её;
 * host-мост сериализует `color.id` в `colorId` и резолвит в цвет имени файла.
 */
export class FileDecoration implements vscode.FileDecoration {
    public badge?: string;
    public tooltip?: string;
    public color?: ThemeColor;
    public propagate?: boolean;

    public constructor(badge?: string, tooltip?: string, color?: ThemeColor) {
        this.badge = badge;
        this.tooltip = tooltip;
        this.color = color;
    }
}

/**
 * Совместимый с `vscode.EventEmitter<T>`. `fire` итерирует снапшот списка
 * слушателей — расширения нередко отписываются во время dispatch.
 */
export class EventEmitter<T> implements vscode.EventEmitter<T> {
    private readonly listeners: ((e: T) => unknown)[] = [];

    public readonly event: vscode.Event<T> = (
        listener: (e: T) => unknown,
        thisArgs?: unknown,
        disposables?: vscode.Disposable[],
    ): vscode.Disposable => {
        const bound: (e: T) => unknown = thisArgs != null ? (e) => listener.call(thisArgs, e) : listener;
        this.listeners.push(bound);
        const disposable = new DisposableImpl(() => {
            const idx = this.listeners.indexOf(bound);
            if (idx >= 0) this.listeners.splice(idx, 1);
        });
        if (disposables !== undefined) disposables.push(disposable);
        return disposable;
    };

    public fire(data: T): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(data);
            } catch {
                // Падение одного слушателя не должно валить fire (как в vscode).
            }
        }
    }

    public dispose(): void {
        this.listeners.length = 0;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Value-типы, которых требует стоковый `vscode-languageclient`: многие из них
// он `extends`-ит уже на этапе require (protocol*-конвертеры), поэтому они
// обязаны быть конструируемыми классами, а enum'ы — настоящими значениями.
// Семантика наивная (хранение без поведения) — глубина добавляется по мере
// закрытия стабов (docs/TODO/LSP.md, таблица стабов).
// ─────────────────────────────────────────────────────────────────────────────

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

/** Где показан терминал (`vscode.TerminalLocation`); Diode держит все терминалы в панели. */
export enum TerminalLocation {
    Panel = 1,
    Editor = 2,
}

/** Почему терминал закрылся (`vscode.TerminalExitReason`). */
export enum TerminalExitReason {
    Unknown = 0,
    Shutdown = 1,
    Process = 2,
    User = 3,
    Extension = 4,
}

/**
 * Вид активной темы (`vscode.ColorThemeKind`) — то, что расширение читает у
 * `window.activeColorTheme.kind`. Значения дословно из upstream; наш
 * {@link WorkbenchTheme}`.type` маппится в них на стороне host'а
 * (`themeColorResolverAdapter.ts`).
 */
export enum ColorThemeKind {
    Light = 1,
    Dark = 2,
    HighContrast = 3,
    HighContrastLight = 4,
}

/**
 * Источник смены выделения (`vscode.TextEditorSelectionChangeKind`) в событии
 * `window.onDidChangeTextEditorSelection`. Хост распознаёт не любую смену —
 * см. `cursorChangeSource.ts`; нераспознанная приезжает с `kind === undefined`
 * (upstream это допускает явно).
 */
export enum TextEditorSelectionChangeKind {
    Keyboard = 1,
    Mouse = 2,
    Command = 3,
}

export enum ProgressLocation {
    SourceControl = 1,
    Window = 10,
    Notification = 15,
}

export enum LogLevel {
    Off = 0,
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warning = 4,
    Error = 5,
}

export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
}

export enum DiagnosticTag {
    Unnecessary = 1,
    Deprecated = 2,
}

export enum LanguageStatusSeverity {
    Information = 0,
    Warning = 1,
    Error = 2,
}

export enum CompletionItemTag {
    Deprecated = 1,
}

export enum DocumentHighlightKind {
    Text = 0,
    Read = 1,
    Write = 2,
}

export enum SymbolTag {
    Deprecated = 1,
}

export enum SymbolKind {
    File = 0,
    Module = 1,
    Namespace = 2,
    Package = 3,
    Class = 4,
    Method = 5,
    Property = 6,
    Field = 7,
    Constructor = 8,
    Enum = 9,
    Interface = 10,
    Function = 11,
    Variable = 12,
    Constant = 13,
    String = 14,
    Number = 15,
    Boolean = 16,
    Array = 17,
    Object = 18,
    Key = 19,
    Null = 20,
    EnumMember = 21,
    Struct = 22,
    Event = 23,
    Operator = 24,
    TypeParameter = 25,
}

/** Иерархический тег вида code-action (`vscode.CodeActionKind` — класс, не enum). */
export class CodeActionKind implements vscode.CodeActionKind {
    public static readonly Empty = new CodeActionKind("");
    public static readonly QuickFix = new CodeActionKind("quickfix");
    public static readonly Refactor = new CodeActionKind("refactor");
    public static readonly RefactorExtract = new CodeActionKind("refactor.extract");
    public static readonly RefactorInline = new CodeActionKind("refactor.inline");
    public static readonly RefactorMove = new CodeActionKind("refactor.move");
    public static readonly RefactorRewrite = new CodeActionKind("refactor.rewrite");
    public static readonly Source = new CodeActionKind("source");
    public static readonly SourceOrganizeImports = new CodeActionKind("source.organizeImports");
    public static readonly SourceFixAll = new CodeActionKind("source.fixAll");
    public static readonly Notebook = new CodeActionKind("notebook");

    public readonly value: string;

    public constructor(value: string) {
        this.value = value;
    }

    public append(parts: string): CodeActionKind {
        return new CodeActionKind(this.value ? this.value + "." + parts : parts);
    }

    public intersects(other: CodeActionKind): boolean {
        return this.contains(other) || other.contains(this);
    }

    public contains(other: CodeActionKind): boolean {
        return this.value === other.value || other.value.startsWith(this.value + ".");
    }
}

/** Чем спровоцирован запрос code actions (`vscode.CodeActionTriggerKind`). */
export enum CodeActionTriggerKind {
    /** Явный запрос пользователя или расширения (команда). */
    Invoke = 1,
    /** Автоматический запрос (смена выделения/правка) — у нас пока не используется. */
    Automatic = 2,
}

/**
 * `vscode.DiagnosticRelatedInformation` — сопутствующее сообщение с местом в
 * коде («а здесь это объявлено»).
 *
 * Класс-ловушка: конвертер vscode-languageclient конструирует его на КАЖДУЮ
 * диагностику с related information, а такие шлёт любой сервер (у tsserver это
 * TS2741 «Property … is missing», дубликаты идентификаторов и далее по списку).
 * Без класса падал `new code.DiagnosticRelatedInformation(...)`, и вместе с ним
 * — вся пачка диагностик: файл оставался вообще без squiggle, а ошибка была
 * видна только в output-канале клиента.
 */
export class DiagnosticRelatedInformation implements vscode.DiagnosticRelatedInformation {
    public location: Location;
    public message: string;

    public constructor(location: Location, message: string) {
        this.location = location;
        this.message = message;
    }
}

export class Diagnostic implements vscode.Diagnostic {
    public range: Range;
    public message: string;
    public severity: DiagnosticSeverity;
    public source?: string;
    public code?: string | number | { value: string | number; target: Uri };
    /** Наивность: до маркеров не доезжает (wire его не несёт) — см. docs/TODO/LSP.md. */
    public relatedInformation?: DiagnosticRelatedInformation[];
    public tags?: DiagnosticTag[];

    public constructor(range: Range, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
        this.range = range;
        this.message = message;
        this.severity = severity;
    }
}

export class CodeLens {
    public range: Range;
    public command?: unknown;

    public constructor(range: Range, command?: unknown) {
        this.range = range;
        this.command = command;
    }

    public get isResolved(): boolean {
        return this.command !== undefined;
    }
}

export class CodeAction implements vscode.CodeAction {
    public title: string;
    public kind?: CodeActionKind;
    public edit?: vscode.WorkspaceEdit;
    public diagnostics?: Diagnostic[];
    public command?: vscode.Command;
    public isPreferred?: boolean;
    public disabled?: { readonly reason: string };

    public constructor(title: string, kind?: CodeActionKind) {
        this.title = title;
        this.kind = kind;
    }
}

export class DocumentLink {
    public range: Range;
    public target?: Uri;
    public tooltip?: string;

    public constructor(range: Range, target?: Uri) {
        this.range = range;
        this.target = target;
    }
}

export class InlayHint {
    public position: Position;
    public label: unknown;
    public kind?: unknown;

    public constructor(position: Position, label: unknown, kind?: unknown) {
        this.position = position;
        this.label = label;
        this.kind = kind;
    }
}

export class SymbolInformation {
    public name: string;
    public kind: SymbolKind;
    public containerName: string;
    public location: Location;

    public constructor(name: string, kind: SymbolKind, containerName: string, location: Location) {
        this.name = name;
        this.kind = kind;
        this.containerName = containerName;
        this.location = location;
    }
}

export class CallHierarchyItem {
    public constructor(
        public kind: SymbolKind,
        public name: string,
        public detail: string,
        public uri: Uri,
        public range: Range,
        public selectionRange: Range,
    ) {}
}

export class TypeHierarchyItem {
    public constructor(
        public kind: SymbolKind,
        public name: string,
        public detail: string,
        public uri: Uri,
        public range: Range,
        public selectionRange: Range,
    ) {}
}

/** Ошибка отмены (`vscode.CancellationError extends Error`). */
export class CancellationError extends Error {
    public constructor() {
        super("Canceled");
        this.name = "Canceled";
    }
}

/** Источник токенов отмены (клиент создаёт по одному на запрос). */
export class CancellationTokenSource {
    private readonly emitter = new EventEmitter<unknown>();
    private cancelled = false;

    public readonly token: vscode.CancellationToken;

    public constructor() {
        // Геттер объекта-литерала стрелкой быть не может, поэтому до состояния
        // источника он добирается через замыкание, а не через алиас `this`.
        const isCancelled = (): boolean => this.cancelled;
        this.token = {
            get isCancellationRequested(): boolean {
                return isCancelled();
            },
            onCancellationRequested: this.emitter.event,
        };
    }

    public cancel(): void {
        if (this.cancelled) return;
        this.cancelled = true;
        this.emitter.fire(undefined);
    }

    public dispose(): void {
        this.emitter.dispose();
    }
}

export class MarkdownString implements vscode.MarkdownString {
    public value: string;
    public isTrusted?: boolean;
    public supportThemeIcons?: boolean;
    public supportHtml?: boolean;
    public baseUri?: Uri;

    public constructor(value = "") {
        this.value = value;
    }

    public appendText(value: string): this {
        this.value += value;
        return this;
    }

    public appendMarkdown(value: string): this {
        this.value += value;
        return this;
    }

    public appendCodeblock(value: string, language = ""): this {
        this.value += `\n\`\`\`${language}\n${value}\n\`\`\`\n`;
        return this;
    }
}

export class Hover implements vscode.Hover {
    public contents: vscode.Hover["contents"];
    public range?: Range;

    public constructor(contents: ConstructorParameters<typeof vscode.Hover>[0], range?: Range) {
        this.contents = Array.isArray(contents) ? contents : [contents];
        this.range = range;
    }
}

/**
 * Режим запуска расширения (`context.extensionMode`). У нас расширения всегда
 * работают как установленные (`Production`): режимов `--extensionDevelopmentPath`
 * / `--extensionTestsPath` в Diode нет. Расширения сравнивают значение с enum'ом
 * (`context.extensionMode === ExtensionMode.Development` у basedpyright), поэтому
 * enum обязан существовать в namespace.
 */
export enum ExtensionMode {
    Production = 1,
    Development = 2,
    Test = 3,
}

/**
 * Где работает расширение (`Extension.extensionKind`). У нас всегда `UI`, и это
 * не упрощение, а буква контракта `vscode.d.ts`: «When no remote extension host
 * exists, the value is `ExtensionKind.UI`» — удалённого extension host'а в Diode
 * нет. Значение обязано быть рантайм-enum'ом: расширение сравнивает с ним
 * (`ext.extensionKind === vscode.ExtensionKind.Workspace`), и без настоящего
 * поля сравнение всегда давало бы `false` вместо честного ответа.
 */
export enum ExtensionKind {
    UI = 1,
    Workspace = 2,
}

/**
 * Из какого UI расширение видят (`env.uiKind`). В Diode всегда `Desktop`:
 * редактор — настольное приложение, пусть и в терминале, а `Web` в контракте
 * значит «доступ из браузера» (vscode.dev). Enum обязан быть рантайм-значением:
 * `redhat.java` разбирает `switch (env.uiKind) { case UIKind.Desktop: ... }`
 * прямо в `activate()`, и без него активация падала на первом же обращении.
 */
export enum UIKind {
    Desktop = 1,
    Web = 2,
}

/**
 * Как был вызван signature-help-провайдер. Значения — из vscode API; их читает
 * конвертер стокового клиента (`codeConverter.asSignatureHelpTriggerKind`
 * сравнивает `code.SignatureHelpTriggerKind.*` на КАЖДОМ запросе), поэтому
 * enum обязан существовать, даже если бы мы его сами не использовали.
 */
export enum SignatureHelpTriggerKind {
    Invoke = 1,
    TriggerCharacter = 2,
    ContentChange = 3,
}

/**
 * Параметр сигнатуры. `label` — либо подстрока метки сигнатуры, либо пара
 * офсетов `[start, end)` внутри неё: клиент объявляет серверу
 * `labelOffsetSupport: true`, так что вторая форма — легальный ответ.
 */
export class ParameterInformation implements vscode.ParameterInformation {
    public label: string | [number, number];
    public documentation?: string | MarkdownString;

    public constructor(label: string | [number, number], documentation?: string | MarkdownString) {
        this.label = label;
        this.documentation = documentation;
    }
}

/** Одна сигнатура (перегрузка) вызываемого символа. */
export class SignatureInformation implements vscode.SignatureInformation {
    public label: string;
    public documentation?: string | MarkdownString;
    public parameters: ParameterInformation[] = [];
    public activeParameter?: number;

    public constructor(label: string, documentation?: string | MarkdownString) {
        this.label = label;
        this.documentation = documentation;
    }
}

/**
 * Подсказка параметров целиком. Конструктор БЕЗ аргументов — `protocolConverter`
 * клиента делает `new code.SignatureHelp()` и заполняет поля присваиванием (та
 * же грабля, что с `CompletionList`: без класса конвертация ответа падала бы
 * целиком, а след ушёл бы только в `client.outputChannel`).
 */
export class SignatureHelp implements vscode.SignatureHelp {
    public signatures: SignatureInformation[] = [];
    public activeSignature = 0;
    public activeParameter = 0;
}

/** Полный набор правок одного ресурса — внутренняя проекция для сериализации applyEdit. */
export interface IResourceEditEntry {
    readonly uri: Uri;
    readonly edits: readonly (TextEdit | SnippetTextEdit)[];
}

/** Опции файловых операций `WorkspaceEdit` (`overwrite` бьёт `ignoreIfExists`). */
export interface IFileOperationOptions {
    readonly overwrite?: boolean;
    readonly ignoreIfExists?: boolean;
    readonly ignoreIfNotExists?: boolean;
    /** Начальное содержимое создаваемого файла, уже приведённое к строке. */
    readonly contents?: string;
}

/**
 * Одна операция внутри {@link WorkspaceEdit} — ровно в том порядке, в котором
 * её добавило расширение. Текстовая операция адресует ОДИН ресурс и копит все
 * его правки: координаты правок одного ресурса исходные (друг друга они не
 * сдвигают), поэтому хранить их россыпью незачем.
 */
export type WorkspaceEditOperation =
    | { readonly kind: "text"; readonly uri: Uri; readonly edits: (TextEdit | SnippetTextEdit)[] }
    | { readonly kind: "create"; readonly uri: Uri; readonly options: IFileOperationOptions }
    | { readonly kind: "delete"; readonly uri: Uri; readonly options: IFileOperationOptions }
    | { readonly kind: "rename"; readonly from: Uri; readonly to: Uri; readonly options: IFileOperationOptions };

/**
 * Правки уровня workspace (`vscode.WorkspaceEdit`).
 *
 * Внутри — УПОРЯДОЧЕННЫЙ список операций ({@link operations}), как у upstream:
 * порядок значим, потому что файловые операции и текстовые правки зависят друг
 * от друга («Move to a new file» создаёт файл и тут же пишет в него).
 * Текстовые правки группируются по ресурсу в первой его операции — `set`
 * заменяет накопленное, `replace`/`insert`/`delete` дописывают.
 *
 * `set` принимает обе формы конвертера стокового LSP-клиента — `TextEdit[]` и
 * пары `[TextEdit, metadata]` (metadata отбрасывается). По dts `get`/`entries`
 * отдают только `TextEdit`; сниппет-правки хранятся и видны через
 * {@link resourceEdits} — их приземляет сериализация `workspace.applyEdit`
 * (плейсхолдеры вырезаются, как у completion).
 */
export class WorkspaceEdit implements vscode.WorkspaceEdit {
    private readonly ops: WorkspaceEditOperation[] = [];

    public replace(uri: Uri, range: Range, newText: string): void {
        this.push(uri, new TextEdit(range, newText));
    }

    public insert(uri: Uri, position: Position, newText: string): void {
        this.push(uri, new TextEdit(new Range(position, position), newText));
    }

    public delete(uri: Uri, range: Range): void {
        this.push(uri, new TextEdit(range, ""));
    }

    public has(uri: Uri): boolean {
        return this.textOpFor(uri) !== undefined;
    }

    public set(
        uri: Uri,
        edits:
            | readonly (TextEdit | SnippetTextEdit)[]
            | readonly [TextEdit | SnippetTextEdit, unknown][]
            | null
            | undefined,
    ): void {
        const existing = this.textOpFor(uri);
        if (edits === null || edits === undefined || edits.length === 0) {
            // Пустой набор снимает правки ресурса целиком — вместе с операцией,
            // иначе `has`/`size` продолжали бы её считать.
            if (existing !== undefined) this.ops.splice(this.ops.indexOf(existing), 1);
            return;
        }
        const list: (TextEdit | SnippetTextEdit)[] = [];
        for (const entry of edits) {
            const edit = Array.isArray(entry) ? entry[0] : entry;
            if (edit instanceof TextEdit || edit instanceof SnippetTextEdit) list.push(edit);
        }
        if (existing !== undefined) {
            existing.edits.length = 0;
            existing.edits.push(...list);
            return;
        }
        this.ops.push({ kind: "text", uri, edits: list });
    }

    public get(uri: Uri): TextEdit[] {
        const op = this.textOpFor(uri);
        if (op === undefined) return [];
        return op.edits.filter((edit): edit is TextEdit => edit instanceof TextEdit);
    }

    public entries(): [Uri, TextEdit[]][] {
        return this.resourceEdits().map((entry) => [entry.uri, this.get(entry.uri)]);
    }

    /** Все правки по ресурсам, включая сниппетные (вне vscode API — для сериализации). */
    public resourceEdits(): readonly IResourceEditEntry[] {
        return this.ops.flatMap((op) => (op.kind === "text" ? [{ uri: op.uri, edits: op.edits }] : []));
    }

    /** Операции в порядке добавления (вне vscode API — для сериализации applyEdit). */
    public operations(): readonly WorkspaceEditOperation[] {
        return this.ops;
    }

    public createFile(uri: Uri, options?: ICreateFileOptions): void {
        this.ops.push({ kind: "create", uri, options: createFileOptionsOf(options) });
    }

    public deleteFile(uri: Uri, options?: { readonly ignoreIfNotExists?: boolean }): void {
        this.ops.push({
            kind: "delete",
            uri,
            options: { ...(options?.ignoreIfNotExists === true ? { ignoreIfNotExists: true } : {}) },
        });
    }

    public renameFile(
        oldUri: Uri,
        newUri: Uri,
        options?: { readonly overwrite?: boolean; readonly ignoreIfExists?: boolean },
    ): void {
        this.ops.push({ kind: "rename", from: oldUri, to: newUri, options: overwriteOptionsOf(options) });
    }

    /** Есть ли файловые операции (create/rename/delete). */
    public get hasFileOperations(): boolean {
        return this.ops.some((op) => op.kind !== "text");
    }

    /** Число затронутых ресурсов — текстовых и файловых (дословно `size` из dts). */
    public get size(): number {
        return this.ops.length;
    }

    private textOpFor(uri: Uri): { kind: "text"; uri: Uri; edits: (TextEdit | SnippetTextEdit)[] } | undefined {
        const key = uri.toString();
        return this.ops.find(
            (op): op is { kind: "text"; uri: Uri; edits: (TextEdit | SnippetTextEdit)[] } =>
                op.kind === "text" && op.uri.toString() === key,
        );
    }

    private push(uri: Uri, edit: TextEdit): void {
        const existing = this.textOpFor(uri);
        if (existing !== undefined) {
            existing.edits.push(edit);
            return;
        }
        this.ops.push({ kind: "text", uri, edits: [edit] });
    }
}

/** Опции `createFile` из dts: `contents` приезжает байтами или файлом DataTransfer. */
interface ICreateFileOptions {
    readonly overwrite?: boolean;
    readonly ignoreIfExists?: boolean;
    readonly contents?: Uint8Array | { data(): Thenable<Uint8Array> };
}

/**
 * Опции создания в нашей форме. `contents` приводится к строке здесь:
 * создаём мы текстовый файл, а `DataTransferFile` (асинхронные байты из
 * drag-and-drop) у нас взяться негде — такой `contents` игнорируется, файл
 * создаётся пустым.
 */
function createFileOptionsOf(options: ICreateFileOptions | undefined): IFileOperationOptions {
    const contents = options?.contents;
    return {
        ...overwriteOptionsOf(options),
        ...(contents instanceof Uint8Array ? { contents: new TextDecoder().decode(contents) } : {}),
    };
}

function overwriteOptionsOf(
    options: { readonly overwrite?: boolean; readonly ignoreIfExists?: boolean } | undefined,
): IFileOperationOptions {
    return {
        ...(options?.overwrite === true ? { overwrite: true } : {}),
        ...(options?.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
    };
}

/**
 * Колонка редактора (`vscode.ViewColumn`): символические `Active`/`Beside` для
 * открытия и разрешённые 1..9 у существующих редакторов (полоса групп Diode).
 */
export enum ViewColumn {
    Active = -1,
    Beside = -2,
    One = 1,
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
}

// ─── TabInput* (vscode.window.tabGroups) ─────────────────────────────────────
// Все семь видов — runtime-классами, хотя Diode производит только текст и дифф:
// расширения перебирают вкладки instanceof-каскадом по ВСЕМ видам, и
// `tab.input instanceof vscode.TabInputNotebook` при отсутствующем классе — это
// TypeError, а не false. Классы тривиальны (Uri + string), несуществующие виды
// вкладок просто никогда не встречаются в снимке.

/** Вкладка с текстовым ресурсом. */
export class TabInputText implements vscode.TabInputText {
    public constructor(public readonly uri: Uri) {}
}

/** Вкладка-дифф двух текстовых ресурсов. */
export class TabInputTextDiff implements vscode.TabInputTextDiff {
    public constructor(
        public readonly original: Uri,
        public readonly modified: Uri,
    ) {}
}

/** Вкладка custom-редактора (Diode не производит). */
export class TabInputCustom implements vscode.TabInputCustom {
    public constructor(
        public readonly uri: Uri,
        public readonly viewType: string,
    ) {}
}

/** Вкладка webview (Diode не производит). */
export class TabInputWebview implements vscode.TabInputWebview {
    public constructor(public readonly viewType: string) {}
}

/** Вкладка notebook (Diode не производит). */
export class TabInputNotebook implements vscode.TabInputNotebook {
    public constructor(
        public readonly uri: Uri,
        public readonly notebookType: string,
    ) {}
}

/** Вкладка-дифф notebook'ов (Diode не производит). */
export class TabInputNotebookDiff implements vscode.TabInputNotebookDiff {
    public constructor(
        public readonly original: Uri,
        public readonly modified: Uri,
        public readonly notebookType: string,
    ) {}
}

/**
 * Вкладка терминала (Diode не производит). Пустой класс — это и есть поверхность
 * upstream (`vscode.TabInputTerminal`): расширения узнают её через `instanceof`,
 * так что заменить объектом или функцией, как предлагает правило, нельзя.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- см. комментарий выше
export class TabInputTerminal implements vscode.TabInputTerminal {}

/**
 * Строгость сообщения валидации InputBox (`vscode.InputBoxValidationSeverity`).
 * `Error` блокирует Enter; `Warning` и `Info` только показываются.
 */
export enum InputBoxValidationSeverity {
    Info = 1,
    Warning = 2,
    Error = 3,
}

// ── Задачи (`extHostTypes.ts` эталона) ────────────────────────────────────────

/** Когда показывать терминал задачи (`vscode.TaskRevealKind`). */
export enum TaskRevealKind {
    Always = 1,
    Silent = 2,
    Never = 3,
}

/** Чей терминал занимает задача (`vscode.TaskPanelKind`). */
export enum TaskPanelKind {
    Shared = 1,
    Dedicated = 2,
    New = 3,
}

/** Правило экранирования аргумента шелла (`vscode.ShellQuoting`). */
export enum ShellQuoting {
    Escape = 1,
    Strong = 2,
    Weak = 3,
}

/** Область задачи (`vscode.TaskScope`); `Global` (пользовательские задачи) не поддержан. */
export enum TaskScope {
    Global = 1,
    Workspace = 2,
}

function illegalTaskArgument(name: string): Error {
    return new Error(`Illegal argument: ${name}`);
}

/**
 * Группа задачи (`vscode.TaskGroup`). Хранится и уезжает в ядро, но групп
 * build/test у нас пока нет — на запуск она не влияет (docs/TODO/Tasks.md).
 */
export class TaskGroup implements vscode.TaskGroup {
    public isDefault: boolean | undefined;
    private readonly groupId: string;

    public static Clean: TaskGroup = new TaskGroup("clean", "Clean");
    public static Build: TaskGroup = new TaskGroup("build", "Build");
    public static Rebuild: TaskGroup = new TaskGroup("rebuild", "Rebuild");
    public static Test: TaskGroup = new TaskGroup("test", "Test");

    public static from(value: string): TaskGroup | undefined {
        return BUILTIN_TASK_GROUPS.get(value);
    }

    public constructor(
        id: string,
        public readonly label: string,
    ) {
        if (typeof id !== "string") throw illegalTaskArgument("name");
        if (typeof label !== "string") throw illegalTaskArgument("name");
        this.groupId = id;
    }

    public get id(): string {
        return this.groupId;
    }
}

const BUILTIN_TASK_GROUPS: ReadonlyMap<string, TaskGroup> = new Map([
    ["clean", TaskGroup.Clean],
    ["build", TaskGroup.Build],
    ["rebuild", TaskGroup.Rebuild],
    ["test", TaskGroup.Test],
]);

/** `computeTaskExecutionId` эталона: значения через запятую, свои запятые удвоены. */
function computeTaskExecutionId(values: readonly string[]): string {
    return values.map((value) => `${value.replace(/,/g, ",,")},`).join("");
}

/** Задача — процесс без шелла (`vscode.ProcessExecution`). */
export class ProcessExecution implements vscode.ProcessExecution {
    private processValue: string;
    private argsValue: string[] = [];
    private optionsValue: vscode.ProcessExecutionOptions | undefined;

    public constructor(process: string, options?: vscode.ProcessExecutionOptions);
    public constructor(process: string, args: string[], options?: vscode.ProcessExecutionOptions);
    public constructor(
        process: string,
        varg1?: string[] | vscode.ProcessExecutionOptions,
        varg2?: vscode.ProcessExecutionOptions,
    ) {
        if (typeof process !== "string") throw illegalTaskArgument("process");
        this.processValue = process;
        if (Array.isArray(varg1)) {
            this.argsValue = varg1;
            this.optionsValue = varg2;
        } else {
            this.optionsValue = varg1;
        }
    }

    public get process(): string {
        return this.processValue;
    }

    public set process(value: string) {
        if (typeof value !== "string") throw illegalTaskArgument("process");
        this.processValue = value;
    }

    public get args(): string[] {
        return this.argsValue;
    }

    public set args(value: string[]) {
        this.argsValue = Array.isArray(value) ? value : [];
    }

    public get options(): vscode.ProcessExecutionOptions | undefined {
        return this.optionsValue;
    }

    public set options(value: vscode.ProcessExecutionOptions | undefined) {
        this.optionsValue = value;
    }

    public computeId(): string {
        return computeTaskExecutionId(["process", this.processValue, ...this.argsValue]);
    }
}

/** Задача — командная строка шелла или команда с аргументами (`vscode.ShellExecution`). */
export class ShellExecution implements vscode.ShellExecution {
    private commandLineValue: string | undefined;
    private commandValue: string | vscode.ShellQuotedString | undefined;
    private argsValue: (string | vscode.ShellQuotedString)[] = [];
    private optionsValue: vscode.ShellExecutionOptions | undefined;

    public constructor(commandLine: string, options?: vscode.ShellExecutionOptions);
    public constructor(
        command: string | vscode.ShellQuotedString,
        args: (string | vscode.ShellQuotedString)[],
        options?: vscode.ShellExecutionOptions,
    );
    public constructor(
        arg0: string | vscode.ShellQuotedString,
        arg1?: vscode.ShellExecutionOptions | (string | vscode.ShellQuotedString)[],
        arg2?: vscode.ShellExecutionOptions,
    ) {
        if (Array.isArray(arg1)) {
            if (
                typeof arg0 !== "string" &&
                typeof (arg0 as Partial<vscode.ShellQuotedString> | null)?.value !== "string"
            ) {
                throw illegalTaskArgument("command");
            }
            if (arg0 === "") throw illegalTaskArgument("command can't be undefined or null");
            this.commandValue = arg0;
            this.argsValue = arg1;
            this.optionsValue = arg2;
        } else {
            if (typeof arg0 !== "string") throw illegalTaskArgument("commandLine");
            this.commandLineValue = arg0;
            this.optionsValue = arg1;
        }
    }

    public get commandLine(): string | undefined {
        return this.commandLineValue;
    }

    public set commandLine(value: string | undefined) {
        if (typeof value !== "string") throw illegalTaskArgument("commandLine");
        this.commandLineValue = value;
    }

    public get command(): string | vscode.ShellQuotedString {
        return this.commandValue ?? "";
    }

    public set command(value: string | vscode.ShellQuotedString) {
        if (
            typeof value !== "string" &&
            typeof (value as Partial<vscode.ShellQuotedString> | null)?.value !== "string"
        ) {
            throw illegalTaskArgument("command");
        }
        this.commandValue = value;
    }

    public get args(): (string | vscode.ShellQuotedString)[] {
        return this.argsValue;
    }

    public set args(value: (string | vscode.ShellQuotedString)[] | undefined) {
        this.argsValue = value ?? [];
    }

    public get options(): vscode.ShellExecutionOptions | undefined {
        return this.optionsValue;
    }

    public set options(value: vscode.ShellExecutionOptions | undefined) {
        this.optionsValue = value;
    }

    public computeId(): string {
        const values = ["shell"];
        if (this.commandLineValue !== undefined) values.push(this.commandLineValue);
        if (this.commandValue !== undefined) {
            values.push(typeof this.commandValue === "string" ? this.commandValue : this.commandValue.value);
        }
        for (const arg of this.argsValue) values.push(typeof arg === "string" ? arg : arg.value);
        return computeTaskExecutionId(values);
    }
}

/** Задача, процессом которой владеет расширение — pty из колбэка (`vscode.CustomExecution`). */
export class CustomExecution implements vscode.CustomExecution {
    public constructor(
        public callback: (resolvedDefinition: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>,
    ) {}

    public computeId(): string {
        return `customExecution${globalThis.crypto.randomUUID()}`;
    }
}

/** Исполнение задачи: свои классы и любые объекты той же формы (`instanceof` проверяет класс). */
type TaskExecutionKind = vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution;
type TaskScopeValue = vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder;

/**
 * Задача (`vscode.Task`, `Task` в `extHostTypes.ts` эталона). `handleId` —
 * id задачи у ядра (`_id` эталона): он есть у задачи, пришедшей из ядра
 * (`fetchTasks`, событие старта), и по нему её исполняют без пересылки
 * описания. Любой сеттер его сбрасывает (`clear` эталона): изменённая задача
 * — уже другая, и уезжает описанием целиком; определение «встроенного» типа
 * (`shell`/`process`/`$empty`) тогда пересчитывается по исполнению.
 */
export class Task implements vscode.Task {
    private static readonly ExtensionCallbackType = "customExecution";
    private static readonly ProcessType = "process";
    private static readonly ShellType = "shell";
    private static readonly EmptyType = "$empty";

    private idValue: string | undefined;
    private readonly deprecatedValue: boolean = false;
    private definitionValue: vscode.TaskDefinition;
    private scopeValue: TaskScopeValue | undefined;
    private nameValue: string;
    private executionValue: TaskExecutionKind | undefined;
    private problemMatchersValue: string[];
    private hasDefinedMatchersValue: boolean;
    private isBackgroundValue = false;
    private sourceValue: string;
    private groupValue: vscode.TaskGroup | undefined;
    private presentationOptionsValue: vscode.TaskPresentationOptions = Object.create(
        null,
    ) as vscode.TaskPresentationOptions;
    private runOptionsValue: vscode.RunOptions = Object.create(null) as vscode.RunOptions;
    private detailValue: string | undefined;

    public constructor(
        definition: vscode.TaskDefinition,
        name: string,
        source: string,
        execution?: TaskExecutionKind,
        problemMatchers?: string | string[],
    );
    public constructor(
        definition: vscode.TaskDefinition,
        scope: TaskScopeValue,
        name: string,
        source: string,
        execution?: TaskExecutionKind,
        problemMatchers?: string | string[],
    );
    public constructor(
        definition: vscode.TaskDefinition,
        arg2: string | TaskScopeValue,
        arg3: string,
        arg4?: string | TaskExecutionKind,
        arg5?: TaskExecutionKind | string | string[],
        arg6?: string | string[],
    ) {
        this.definitionValue = definition;
        this.definition = definition;
        let problemMatchers: string | string[] | undefined;
        if (typeof arg2 === "string") {
            this.nameValue = arg2;
            this.sourceValue = arg3;
            this.execution = arg4 as TaskExecutionKind | undefined;
            problemMatchers = arg5 as string | string[] | undefined;
            this.deprecatedValue = true;
        } else {
            this.scopeValue = arg2;
            this.nameValue = arg3;
            this.sourceValue = arg4 as string;
            this.execution = arg5 as TaskExecutionKind | undefined;
            problemMatchers = arg6;
        }
        this.name = this.nameValue;
        this.source = this.sourceValue;
        this.problemMatchersValue = typeof problemMatchers === "string" ? [problemMatchers] : (problemMatchers ?? []);
        this.hasDefinedMatchersValue = problemMatchers !== undefined;
    }

    /** Id задачи у ядра (`_id` эталона); `undefined` — задача своя или изменена. */
    public get handleId(): string | undefined {
        return this.idValue;
    }

    public set handleId(value: string | undefined) {
        this.idValue = value;
    }

    /** Создана устаревшим конструктором без области. */
    public get deprecated(): boolean {
        return this.deprecatedValue;
    }

    private clear(): void {
        if (this.idValue === undefined) return;
        this.idValue = undefined;
        this.scopeValue = undefined;
        this.computeDefinitionBasedOnExecution();
    }

    private computeDefinitionBasedOnExecution(): void {
        const execution = this.executionValue;
        if (execution instanceof ProcessExecution) {
            this.definitionValue = { type: Task.ProcessType, id: execution.computeId() };
        } else if (execution instanceof ShellExecution) {
            this.definitionValue = { type: Task.ShellType, id: execution.computeId() };
        } else if (execution instanceof CustomExecution) {
            this.definitionValue = { type: Task.ExtensionCallbackType, id: execution.computeId() };
        } else {
            this.definitionValue = { type: Task.EmptyType, id: globalThis.crypto.randomUUID() };
        }
    }

    public get definition(): vscode.TaskDefinition {
        return this.definitionValue;
    }

    public set definition(value: vscode.TaskDefinition) {
        if ((value as vscode.TaskDefinition | null | undefined) === undefined || (value as unknown) === null) {
            throw illegalTaskArgument("Kind can't be undefined or null");
        }
        this.clear();
        this.definitionValue = value;
    }

    public get scope(): TaskScopeValue | undefined {
        return this.scopeValue;
    }

    /** Область задачи (`target` эталона): ядро ставит её задачам из своих DTO. */
    public set target(value: TaskScopeValue) {
        this.clear();
        this.scopeValue = value;
    }

    public get name(): string {
        return this.nameValue;
    }

    public set name(value: string) {
        if (typeof value !== "string") throw illegalTaskArgument("name");
        this.clear();
        this.nameValue = value;
    }

    public get execution(): TaskExecutionKind | undefined {
        return this.executionValue;
    }

    public set execution(value: TaskExecutionKind | undefined) {
        this.clear();
        this.executionValue = value ?? undefined;
        const type = this.definitionValue.type;
        if (
            Task.EmptyType === type ||
            Task.ProcessType === type ||
            Task.ShellType === type ||
            Task.ExtensionCallbackType === type
        ) {
            this.computeDefinitionBasedOnExecution();
        }
    }

    public get problemMatchers(): string[] {
        return this.problemMatchersValue;
    }

    public set problemMatchers(value: string[]) {
        this.clear();
        if (!Array.isArray(value)) {
            this.problemMatchersValue = [];
            this.hasDefinedMatchersValue = false;
            return;
        }
        this.problemMatchersValue = value;
        this.hasDefinedMatchersValue = true;
    }

    public get hasDefinedMatchers(): boolean {
        return this.hasDefinedMatchersValue;
    }

    public get isBackground(): boolean {
        return this.isBackgroundValue;
    }

    public set isBackground(value: boolean) {
        this.clear();
        // Не-булево от расширения без типов — `false`, как у эталона.
        this.isBackgroundValue = (value as unknown) === true;
    }

    public get source(): string {
        return this.sourceValue;
    }

    public set source(value: string) {
        if (typeof value !== "string" || value.length === 0) {
            throw illegalTaskArgument("source must be a string of length > 0");
        }
        this.clear();
        this.sourceValue = value;
    }

    public get group(): vscode.TaskGroup | undefined {
        return this.groupValue;
    }

    public set group(value: vscode.TaskGroup | undefined) {
        this.clear();
        this.groupValue = value ?? undefined;
    }

    public get detail(): string | undefined {
        return this.detailValue;
    }

    public set detail(value: string | undefined) {
        this.detailValue = value ?? undefined;
    }

    public get presentationOptions(): vscode.TaskPresentationOptions {
        return this.presentationOptionsValue;
    }

    public set presentationOptions(value: vscode.TaskPresentationOptions) {
        this.clear();
        // Расширение без типов может прислать null/undefined — эталон заменяет пустым.
        this.presentationOptionsValue =
            (value as vscode.TaskPresentationOptions | null | undefined) ??
            (Object.create(null) as vscode.TaskPresentationOptions);
    }

    public get runOptions(): vscode.RunOptions {
        return this.runOptionsValue;
    }

    public set runOptions(value: vscode.RunOptions) {
        this.clear();
        this.runOptionsValue =
            (value as vscode.RunOptions | null | undefined) ?? (Object.create(null) as vscode.RunOptions);
    }
}

// ── Деревья (`extHostTypes.ts` эталона) ───────────────────────────────────────

/**
 * Ссылка на codicon по id (`vscode.ThemeIcon`). Значки в TUI не рисуются, но
 * класс обязан быть значением: расширения конструируют его при сборке
 * `TreeItem` (`new ThemeIcon("sync~spin")`) и читают статики `File`/`Folder`.
 * Без `isThemeIcon` эталона — им проверяет вход только рендер дерева.
 */
export class ThemeIcon implements vscode.ThemeIcon {
    public static readonly File = new ThemeIcon("file");
    public static readonly Folder = new ThemeIcon("folder");

    public readonly id: string;
    public readonly color?: vscode.ThemeColor;

    public constructor(id: string, color?: vscode.ThemeColor) {
        this.id = id;
        this.color = color;
    }
}

/** Состояние раскрытия узла дерева (`vscode.TreeItemCollapsibleState`). */
export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

/** Состояние чекбокса узла дерева (`vscode.TreeItemCheckboxState`). */
export enum TreeItemCheckboxState {
    Unchecked = 0,
    Checked = 1,
}

/**
 * Узел дерева (`vscode.TreeItem`). Деревья расширений пока не рисуются
 * (`treeViewNoop.ts`), но класс обязан быть настоящим: провайдер объявляет
 * `class Node extends vscode.TreeItem` на уровне модуля, и без значения точка
 * входа расширения не загружается вовсе («Class extends value undefined»).
 *
 * Перегрузки и дефолт — эталонные: подпись (строка или `TreeItemLabel`) либо
 * `Uri` ресурса, `collapsibleState` по умолчанию `None`. Необязательные поля —
 * `declare`: у эталона (`useDefineForClassFields: false`) они не становятся
 * собственными свойствами экземпляра, и геттер подкласса (`get tooltip()`) не
 * затеняется `undefined`. Отступление: нет статического `isTreeItem` — им
 * проверяет ответ провайдера только рендер дерева, которого у нас нет.
 */
export class TreeItem implements vscode.TreeItem {
    declare public label?: string | vscode.TreeItemLabel;
    declare public id?: string;
    declare public iconPath?: string | vscode.IconPath;
    declare public description?: string | boolean;
    declare public resourceUri?: vscode.Uri;
    declare public tooltip?: string | vscode.MarkdownString;
    declare public command?: vscode.Command;
    declare public contextValue?: string;
    declare public accessibilityInformation?: vscode.AccessibilityInformation;
    declare public checkboxState?: vscode.TreeItem["checkboxState"];
    public collapsibleState?: vscode.TreeItemCollapsibleState;

    // Две перегрузки эталона (подпись | Uri) — одной сигнатурой: так требует линт.
    public constructor(
        arg: string | vscode.TreeItemLabel | vscode.Uri,
        collapsibleState: vscode.TreeItemCollapsibleState = TreeItemCollapsibleState.None,
    ) {
        this.collapsibleState = collapsibleState;
        if (arg instanceof Uri) {
            this.resourceUri = arg;
        } else {
            // `vscode.Uri` в d.ts — класс, и `instanceof` нашего `Uri` его не сужает.
            this.label = arg as string | vscode.TreeItemLabel;
        }
    }
}

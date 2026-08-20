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
export class DisposableImpl {
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
export class Position {
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
export class Range {
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
export class Selection extends Range {
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
export class Location {
    public uri: Uri;
    public range: Range;

    public constructor(uri: Uri, rangeOrPosition: Range | Position) {
        this.uri = uri;
        this.range =
            rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
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
export class TextEdit {
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
export class FoldingRange {
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

export class FileSystemError extends Error {
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

/** Элемент автодополнения. Сериализуется хостом в `WireCompletionItem` (WP8). */
export class CompletionItem {
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
export class CompletionList<T extends CompletionItem = CompletionItem> {
    public items: T[];
    public isIncomplete: boolean;

    public constructor(items: T[] = [], isIncomplete = false) {
        this.items = items;
        this.isIncomplete = isIncomplete;
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

    public appendText(value: string): SnippetString {
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
export class ThemeColor {
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
    if (typeof folderUri === "object" && folderUri !== null) return Uri.parse(String(folderUri));
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
export class FileDecoration {
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
export class EventEmitter<T> {
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
        if (disposables !== undefined) disposables.push(disposable as unknown as vscode.Disposable);
        return disposable as unknown as vscode.Disposable;
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
export class CodeActionKind {
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

export class Diagnostic {
    public range: Range;
    public message: string;
    public severity: DiagnosticSeverity;
    public source?: string;
    public code?: string | number | { value: string | number; target: Uri };
    public relatedInformation?: unknown[];
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

export class CodeAction {
    public title: string;
    public kind?: CodeActionKind;
    public edit?: unknown;
    public diagnostics?: Diagnostic[];
    public command?: unknown;
    public isPreferred?: boolean;

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
        const self = this;
        this.token = {
            get isCancellationRequested(): boolean {
                return self.cancelled;
            },
            onCancellationRequested: this.emitter.event,
        } as unknown as vscode.CancellationToken;
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

export class MarkdownString {
    public value: string;
    public isTrusted?: boolean;
    public supportThemeIcons?: boolean;

    public constructor(value = "") {
        this.value = value;
    }

    public appendText(value: string): MarkdownString {
        this.value += value;
        return this;
    }

    public appendMarkdown(value: string): MarkdownString {
        this.value += value;
        return this;
    }

    public appendCodeblock(value: string, _language?: string): MarkdownString {
        this.value += value;
        return this;
    }
}

export class Hover {
    public contents: unknown[];
    public range?: Range;

    public constructor(contents: unknown, range?: Range) {
        this.contents = Array.isArray(contents) ? contents : [contents];
        this.range = range;
    }
}

/** Наивный WorkspaceEdit — хранит правки, применение — за `workspace.applyEdit`. */
export class WorkspaceEdit {
    private readonly edits = new Map<string, { range: Range; newText: string }[]>();

    public replace(uri: Uri, range: Range, newText: string): void {
        this.push(uri, { range, newText });
    }

    public insert(uri: Uri, position: Position, newText: string): void {
        this.push(uri, { range: new Range(position, position), newText });
    }

    public delete(uri: Uri, range: Range): void {
        this.push(uri, { range, newText: "" });
    }

    public has(uri: Uri): boolean {
        return this.edits.has(uri.toString());
    }

    public get(uri: Uri): { range: Range; newText: string }[] {
        return this.edits.get(uri.toString()) ?? [];
    }

    public get size(): number {
        return this.edits.size;
    }

    private push(uri: Uri, edit: { range: Range; newText: string }): void {
        const key = uri.toString();
        const list = this.edits.get(key) ?? [];
        list.push(edit);
        this.edits.set(key, list);
    }
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
export class TabInputText {
    public constructor(public readonly uri: Uri) {}
}

/** Вкладка-дифф двух текстовых ресурсов. */
export class TabInputTextDiff {
    public constructor(
        public readonly original: Uri,
        public readonly modified: Uri,
    ) {}
}

/** Вкладка custom-редактора (Diode не производит). */
export class TabInputCustom {
    public constructor(
        public readonly uri: Uri,
        public readonly viewType: string,
    ) {}
}

/** Вкладка webview (Diode не производит). */
export class TabInputWebview {
    public constructor(public readonly viewType: string) {}
}

/** Вкладка notebook (Diode не производит). */
export class TabInputNotebook {
    public constructor(
        public readonly uri: Uri,
        public readonly notebookType: string,
    ) {}
}

/** Вкладка-дифф notebook'ов (Diode не производит). */
export class TabInputNotebookDiff {
    public constructor(
        public readonly original: Uri,
        public readonly modified: Uri,
        public readonly notebookType: string,
    ) {}
}

/** Вкладка терминала (Diode не производит). */
export class TabInputTerminal {
    public constructor() {}
}

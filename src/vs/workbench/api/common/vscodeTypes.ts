import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

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

export class Location implements vscode.Location {
    public uri: Uri;
    public range: Range;

    public constructor(uri: Uri, rangeOrPosition: Range | Position) {
        this.uri = uri;
        this.range = rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
    }
}

export enum EndOfLine {
    LF = 1,
    CRLF = 2,
}

export enum TextDocumentSaveReason {
    Manual = 1,
    AfterDelay = 2,
    FocusOut = 3,
}

export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
}

export enum TextDocumentChangeReason {
    Undo = 1,
    Redo = 2,
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

export enum FileChangeType {
    Changed = 1,
    Created = 2,
    Deleted = 3,
}

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

/** The languageclient converter calls `new code.SnippetTextEdit`; without the class the whole `WorkspaceEdit` fails. No tabstops: applying strips placeholders. */
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

export enum FoldingRangeKind {
    Comment = 1,
    Imports = 2,
    Region = 3,
}

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

export class SelectionRange implements vscode.SelectionRange {
    public range: Range;
    public parent?: SelectionRange;

    public constructor(range: Range, parent?: SelectionRange) {
        this.range = range;
        this.parent = parent;
        if (parent !== undefined && !parent.range.contains(this.range)) {
            throw new Error("Invalid argument: parent must contain this range");
        }
    }
}

export class Color implements vscode.Color {
    public readonly red: number;
    public readonly green: number;
    public readonly blue: number;
    public readonly alpha: number;

    public constructor(red: number, green: number, blue: number, alpha: number) {
        this.red = red;
        this.green = green;
        this.blue = blue;
        this.alpha = alpha;
    }
}

export class ColorInformation implements vscode.ColorInformation {
    public range: Range;
    public color: Color;

    public constructor(range: Range, color: Color) {
        // A falsy color passes, as upstream (`color && !(color instanceof Color)`).
        const raw: unknown = color;
        if (raw && !(raw instanceof Color)) {
            throw new Error("Illegal argument: color");
        }
        if (!isRangeLike(range) || range.isEmpty) {
            throw new Error("Illegal argument: range");
        }
        this.range = range;
        this.color = color;
    }
}

/** Accepted for the type's sake: there is no color picker, `provideColorPresentations` is never called. */
export class ColorPresentation implements vscode.ColorPresentation {
    public label: string;
    public textEdit?: TextEdit;
    public additionalTextEdits?: TextEdit[];

    public constructor(label: string) {
        if (!label || typeof label !== "string") {
            throw new Error("Illegal argument: label");
        }
        this.label = label;
    }
}

export class SemanticTokensLegend implements vscode.SemanticTokensLegend {
    public readonly tokenTypes: string[];
    public readonly tokenModifiers: string[];

    public constructor(tokenTypes: string[], tokenModifiers: string[] = []) {
        this.tokenTypes = tokenTypes;
        this.tokenModifiers = tokenModifiers;
    }
}

function isPositionLike(arg: unknown): arg is vscode.Position {
    const p = arg as Partial<vscode.Position> | null | undefined;
    return typeof p?.line === "number" && typeof p.character === "number";
}

/** Upstream `Range.isRange`: an object with `start`/`end` positions (a `Range` instance qualifies too). */
function isRangeLike(arg: unknown): arg is vscode.Range {
    const r = arg as Partial<vscode.Range> | null | undefined;
    return isPositionLike(r?.start) && isPositionLike(r.end);
}

function isStrArrayOrUndefined(arg: unknown): arg is string[] | undefined {
    return arg === undefined || (Array.isArray(arg) && (arg as unknown[]).every((a) => typeof a === "string"));
}

/**
 * Deviation: upstream encodes on the fly while `push` calls are ordered; here `build()`
 * sorts stably (ties keep `push` order), with the same result.
 */
export class SemanticTokensBuilder implements vscode.SemanticTokensBuilder {
    /** `[line, char, length, tokenType, tokenModifiers]` in `push` order. */
    private readonly tokens: [number, number, number, number, number][] = [];
    private readonly tokenTypeStrToInt = new Map<string, number>();
    private readonly tokenModifierStrToInt = new Map<string, number>();
    private readonly hasLegend: boolean;

    public constructor(legend?: vscode.SemanticTokensLegend) {
        this.hasLegend = legend !== undefined;
        if (legend) {
            legend.tokenTypes.forEach((type, i) => this.tokenTypeStrToInt.set(type, i));
            legend.tokenModifiers.forEach((modifier, i) => this.tokenModifierStrToInt.set(modifier, i));
        }
    }

    public push(line: number, char: number, length: number, tokenType: number, tokenModifiers?: number): void;
    public push(range: vscode.Range, tokenType: string, tokenModifiers?: readonly string[]): void;
    public push(arg0: unknown, arg1: unknown, arg2?: unknown, arg3?: unknown, arg4?: unknown): void {
        if (
            typeof arg0 === "number" &&
            typeof arg1 === "number" &&
            typeof arg2 === "number" &&
            typeof arg3 === "number" &&
            (typeof arg4 === "number" || arg4 === undefined)
        ) {
            this.tokens.push([arg0, arg1, arg2, arg3, arg4 ?? 0]);
            return;
        }
        if (isRangeLike(arg0) && typeof arg1 === "string" && isStrArrayOrUndefined(arg2)) {
            this.pushRange(arg0, arg1, arg2);
            return;
        }
        throw new Error("Illegal argument");
    }

    public build(resultId?: string): SemanticTokens {
        return new SemanticTokens(SemanticTokensBuilder.sortAndDeltaEncode(this.tokens), resultId);
    }

    private pushRange(range: vscode.Range, tokenType: string, tokenModifiers: readonly string[] | undefined): void {
        if (!this.hasLegend) {
            throw new Error("Legend must be provided in constructor");
        }
        if (range.start.line !== range.end.line) {
            throw new Error("`range` cannot span multiple lines");
        }
        const nTokenType = this.tokenTypeStrToInt.get(tokenType);
        if (nTokenType === undefined) {
            throw new Error("`tokenType` is not in the provided legend");
        }
        let nTokenModifiers = 0;
        for (const tokenModifier of tokenModifiers ?? []) {
            const nTokenModifier = this.tokenModifierStrToInt.get(tokenModifier);
            if (nTokenModifier === undefined) {
                throw new Error("`tokenModifier` is not in the provided legend");
            }
            nTokenModifiers |= (1 << nTokenModifier) >>> 0;
        }
        this.tokens.push([
            range.start.line,
            range.start.character,
            range.end.character - range.start.character,
            nTokenType,
            nTokenModifiers,
        ]);
    }

    private static sortAndDeltaEncode(tokens: readonly (readonly number[])[]): Uint32Array {
        const sorted = [...tokens].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const result = new Uint32Array(5 * sorted.length);
        let prevLine = 0;
        let prevChar = 0;
        sorted.forEach(([line, char, length, tokenType, tokenModifiers], i) => {
            const pushLine = line - prevLine;
            result.set([pushLine, pushLine === 0 ? char - prevChar : char, length, tokenType, tokenModifiers], 5 * i);
            prevLine = line;
            prevChar = char;
        });
        return result;
    }
}

export class SemanticTokens implements vscode.SemanticTokens {
    public readonly resultId: string | undefined;
    public readonly data: Uint32Array;

    public constructor(data: Uint32Array, resultId?: string) {
        this.resultId = resultId;
        this.data = data;
    }
}

export class SemanticTokensEdit implements vscode.SemanticTokensEdit {
    public readonly start: number;
    public readonly deleteCount: number;
    public readonly data: Uint32Array | undefined;

    public constructor(start: number, deleteCount: number, data?: Uint32Array) {
        this.start = start;
        this.deleteCount = deleteCount;
        this.data = data;
    }
}

export class SemanticTokensEdits implements vscode.SemanticTokensEdits {
    public readonly resultId: string | undefined;
    public readonly edits: SemanticTokensEdit[];

    public constructor(edits: SemanticTokensEdit[], resultId?: string) {
        this.resultId = resultId;
        this.edits = edits;
    }
}

export { Uri };

/**
 * `name` uses the VS Code format `"${providerCode} (FileSystemError)"`: editorconfig-vscode
 * matches on `err.name === "EntryNotFound (FileSystemError)"`, not on `code`.
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

export enum CompletionTriggerKind {
    Invoke = 0,
    TriggerCharacter = 1,
    TriggerForIncompleteCompletions = 2,
}

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
    public additionalTextEdits?: TextEdit[];

    public constructor(label: string, kind?: CompletionItemKind) {
        this.label = label;
        this.kind = kind;
    }
}

export class CompletionList<T extends vscode.CompletionItem = CompletionItem> implements vscode.CompletionList<T> {
    public items: T[];
    public isIncomplete: boolean;

    public constructor(items: T[] = [], isIncomplete = false) {
        this.items = items;
        this.isIncomplete = isIncomplete;
    }
}

export enum InlineCompletionTriggerKind {
    Invoke = 0,
    Automatic = 1,
}

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

export class InlineCompletionList {
    public items: InlineCompletionItem[];

    public constructor(items: InlineCompletionItem[]) {
        this.items = items;
    }
}

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

export class ThemeColor implements vscode.ThemeColor {
    public readonly id: string;

    public constructor(id: string) {
        this.id = id;
    }
}

/** `base` is an accessor over `baseUri`: upstream documents that writing `base` updates `baseUri`. */
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

    /** @deprecated upstream; kept to match the API surface exactly. */
    public get base(): string {
        return this.baseUriValue.fsPath;
    }

    public set base(value: string) {
        this.baseUriValue = Uri.file(value);
    }
}

function toBaseUri(base: vscode.WorkspaceFolder | Uri | string): Uri {
    if (typeof base === "string") return Uri.file(base);
    if (base instanceof Uri) return base;
    const folderUri = (base as { uri?: unknown }).uri;
    if (folderUri instanceof Uri) return folderUri;
    // A foreign Uri implementation (another runtime inside the extension): take its string form.
    if (typeof folderUri === "object" && folderUri !== null)
        return Uri.parse((folderUri as { toString(): string }).toString());
    throw new TypeError("RelativePattern: base must be a WorkspaceFolder, Uri or string");
}

export enum OverviewRulerLane {
    Left = 1,
    Center = 2,
    Right = 4,
    Full = 7,
}

export enum DecorationRangeBehavior {
    OpenOpen = 0,
    ClosedClosed = 1,
    OpenClosed = 2,
    ClosedOpen = 3,
}

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

/** `fire` iterates a snapshot of listeners: extensions unsubscribe during dispatch. */
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
                // One failing listener must not break fire (as in vscode).
            }
        }
    }

    public dispose(): void {
        this.listeners.length = 0;
    }
}

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

export enum TerminalLocation {
    Panel = 1,
    Editor = 2,
}

/** Values match the wire (`platform/terminal/common/environmentVariable.ts`). */
export enum EnvironmentVariableMutatorType {
    Replace = 1,
    Append = 2,
    Prepend = 3,
}

export enum TerminalShellExecutionCommandLineConfidence {
    Low = 0,
    Medium = 1,
    High = 2,
}

export enum TerminalExitReason {
    Unknown = 0,
    Shutdown = 1,
    Process = 2,
    User = 3,
    Extension = 4,
}

export enum ColorThemeKind {
    Light = 1,
    Dark = 2,
    HighContrast = 3,
    HighContrastLight = 4,
}

export enum TextEditorSelectionChangeKind {
    Keyboard = 1,
    Mouse = 2,
    Command = 3,
}

export enum TextEditorCursorStyle {
    Line = 1,
    Block = 2,
    Underline = 3,
    LineThin = 4,
    BlockOutline = 5,
    UnderlineThin = 6,
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

export enum IndentAction {
    None = 0,
    Indent = 1,
    IndentOutdent = 2,
    Outdent = 3,
}

export enum SyntaxTokenType {
    Other = 0,
    Comment = 1,
    String = 2,
    RegEx = 3,
}

export enum QuickPickItemKind {
    Separator = -1,
    Default = 0,
}

export enum NotebookCellKind {
    Markup = 1,
    Code = 2,
}

export enum DocumentHighlightKind {
    Text = 0,
    Read = 1,
    Write = 2,
}

export class DocumentHighlight implements vscode.DocumentHighlight {
    public range: Range;
    public kind: DocumentHighlightKind;

    public constructor(range: Range, kind: DocumentHighlightKind = DocumentHighlightKind.Text) {
        this.range = range;
        this.kind = kind;
    }

    public toJSON(): unknown {
        return { range: this.range, kind: DocumentHighlightKind[this.kind] };
    }
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

export enum CodeActionTriggerKind {
    Invoke = 1,
    Automatic = 2,
}

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
    /** Never reaches the markers: the wire does not carry it. */
    public relatedInformation?: DiagnosticRelatedInformation[];
    public tags?: DiagnosticTag[];

    public constructor(range: Range, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
        this.range = range;
        this.message = message;
        this.severity = severity;
    }
}

export class CodeLens implements vscode.CodeLens {
    public range: Range;
    public command?: vscode.Command;

    public constructor(range: Range, command?: vscode.Command) {
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

/** Upstream `InlayHintKind`. */
export enum InlayHintKind {
    Type = 1,
    Parameter = 2,
}

/** Only `value` goes over the wire: a hint has no hover or click yet (docs/TODO/InlayHintsCodeLens.md). */
export class InlayHintLabelPart implements vscode.InlayHintLabelPart {
    public value: string;
    public tooltip?: string | vscode.MarkdownString;
    public location?: vscode.Location;
    public command?: vscode.Command;

    public constructor(value: string) {
        this.value = value;
    }
}

/** `tooltip` and `textEdits` stay here: a hint has no hover or double click yet (docs/TODO/InlayHintsCodeLens.md). */
export class InlayHint implements vscode.InlayHint {
    public position: Position;
    public label: string | InlayHintLabelPart[];
    public tooltip?: string | vscode.MarkdownString;
    public kind?: vscode.InlayHintKind;
    public textEdits?: TextEdit[];
    public paddingLeft?: boolean;
    public paddingRight?: boolean;

    public constructor(position: Position, label: string | InlayHintLabelPart[], kind?: vscode.InlayHintKind) {
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

export class DocumentSymbol {
    public static validate(candidate: DocumentSymbol): void {
        if (!candidate.name) throw new Error("name must not be falsy");
        if (!candidate.range.contains(candidate.selectionRange)) {
            throw new Error("selectionRange must be contained in fullRange");
        }
        // The types promise an array, but a JS extension may have overwritten it.
        (candidate.children as DocumentSymbol[] | undefined)?.forEach((child) => {
            DocumentSymbol.validate(child);
        });
    }

    public tags?: SymbolTag[];
    public children: DocumentSymbol[] = [];

    public constructor(
        public name: string,
        public detail: string,
        public kind: SymbolKind,
        public range: Range,
        public selectionRange: Range,
    ) {
        DocumentSymbol.validate(this);
    }
}

export class CallHierarchyItem {
    public tags?: SymbolTag[];

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

export class CancellationError extends Error {
    public constructor() {
        super("Canceled");
        this.name = "Canceled";
    }
}

export class CancellationTokenSource {
    private readonly emitter = new EventEmitter<unknown>();
    private cancelled = false;

    public readonly token: vscode.CancellationToken;

    public constructor() {
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

export enum ExtensionMode {
    Production = 1,
    Development = 2,
    Test = 3,
}

export enum ExtensionKind {
    UI = 1,
    Workspace = 2,
}

export enum UIKind {
    Desktop = 1,
    Web = 2,
}

export enum SignatureHelpTriggerKind {
    Invoke = 1,
    TriggerCharacter = 2,
    ContentChange = 3,
}

export class ParameterInformation implements vscode.ParameterInformation {
    public label: string | [number, number];
    public documentation?: string | MarkdownString;

    public constructor(label: string | [number, number], documentation?: string | MarkdownString) {
        this.label = label;
        this.documentation = documentation;
    }
}

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

/** No arguments: the client's `protocolConverter` calls `new code.SignatureHelp()` and fills fields by assignment. */
export class SignatureHelp implements vscode.SignatureHelp {
    public signatures: SignatureInformation[] = [];
    public activeSignature = 0;
    public activeParameter = 0;
}

export interface IResourceEditEntry {
    readonly uri: Uri;
    readonly edits: readonly (TextEdit | SnippetTextEdit)[];
}

/** `overwrite` wins over `ignoreIfExists`. */
export interface IFileOperationOptions {
    readonly overwrite?: boolean;
    readonly ignoreIfExists?: boolean;
    readonly ignoreIfNotExists?: boolean;
    readonly contents?: string;
    /** Bytes that are not valid UTF-8. */
    readonly contentsBase64?: string;
}

/**
 * A text operation accumulates the edits of one resource up to the next file operation: their coordinates are
 * original and do not shift each other. After a file operation the coordinates are of the text at that point.
 */
export type WorkspaceEditOperation =
    | { readonly kind: "text"; readonly uri: Uri; readonly edits: (TextEdit | SnippetTextEdit)[] }
    | { readonly kind: "create"; readonly uri: Uri; readonly options: IFileOperationOptions }
    | { readonly kind: "delete"; readonly uri: Uri; readonly options: IFileOperationOptions }
    | { readonly kind: "rename"; readonly from: Uri; readonly to: Uri; readonly options: IFileOperationOptions };

type ITextOperation = Extract<WorkspaceEditOperation, { kind: "text" }>;

/**
 * Operation order matters: "Move to a new file" creates the file and writes to it right away.
 * `set` also accepts the LSP client converter's `[TextEdit, metadata]` pairs (metadata
 * is dropped); snippet edits are visible only through {@link resourceEdits}.
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
        return this.textOpsFor(uri).length > 0;
    }

    public set(
        uri: Uri,
        edits:
            | readonly (TextEdit | SnippetTextEdit)[]
            | readonly [TextEdit | SnippetTextEdit, unknown][]
            | null
            | undefined,
    ): void {
        // As upstream: the new edits replace the resource's old ones and take the position of a new operation.
        for (const existing of this.textOpsFor(uri)) this.ops.splice(this.ops.indexOf(existing), 1);
        if (edits === null || edits === undefined || edits.length === 0) return;
        const list: (TextEdit | SnippetTextEdit)[] = [];
        for (const entry of edits) {
            const edit = Array.isArray(entry) ? entry[0] : entry;
            if (edit instanceof TextEdit || edit instanceof SnippetTextEdit) list.push(edit);
        }
        this.ops.push({ kind: "text", uri, edits: list });
    }

    public get(uri: Uri): TextEdit[] {
        return this.textOpsFor(uri)
            .flatMap((op) => op.edits)
            .filter((edit): edit is TextEdit => edit instanceof TextEdit);
    }

    public entries(): [Uri, TextEdit[]][] {
        const seen = new Set<string>();
        const result: [Uri, TextEdit[]][] = [];
        for (const { uri } of this.resourceEdits()) {
            if (seen.has(uri.toString())) continue;
            seen.add(uri.toString());
            result.push([uri, this.get(uri)]);
        }
        return result;
    }

    /** Not part of the vscode API: used to serialize applyEdit. */
    public resourceEdits(): readonly IResourceEditEntry[] {
        return this.ops.flatMap((op) => (op.kind === "text" ? [{ uri: op.uri, edits: op.edits }] : []));
    }

    /** Not part of the vscode API: used to serialize applyEdit. */
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

    public get hasFileOperations(): boolean {
        return this.ops.some((op) => op.kind !== "text");
    }

    public get size(): number {
        return this.ops.length;
    }

    private textOpsFor(uri: Uri): ITextOperation[] {
        const key = uri.toString();
        return this.ops.filter((op): op is ITextOperation => op.kind === "text" && op.uri.toString() === key);
    }

    /** Only into the run of text operations after the last file operation: an earlier one has other coordinates. */
    private push(uri: Uri, edit: TextEdit): void {
        const key = uri.toString();
        for (let i = this.ops.length - 1; i >= 0; i--) {
            const op = this.ops[i];
            if (op.kind !== "text") break;
            if (op.uri.toString() === key) {
                op.edits.push(edit);
                return;
            }
        }
        this.ops.push({ kind: "text", uri, edits: [edit] });
    }
}

interface ICreateFileOptions {
    readonly overwrite?: boolean;
    readonly ignoreIfExists?: boolean;
    readonly contents?: Uint8Array | { data(): Thenable<Uint8Array> };
}

/** A `DataTransferFile` (async drag-and-drop bytes) cannot occur here, so such `contents` is ignored. */
function createFileOptionsOf(options: ICreateFileOptions | undefined): IFileOperationOptions {
    const contents = options?.contents;
    return {
        ...overwriteOptionsOf(options),
        ...(contents instanceof Uint8Array ? wireContentsOf(contents) : {}),
    };
}

function wireContentsOf(contents: Uint8Array): Pick<IFileOperationOptions, "contents" | "contentsBase64"> {
    try {
        return { contents: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(contents) };
    } catch {
        return { contentsBase64: Buffer.from(contents).toString("base64") };
    }
}

function overwriteOptionsOf(
    options: { readonly overwrite?: boolean; readonly ignoreIfExists?: boolean } | undefined,
): IFileOperationOptions {
    return {
        // `false` is not the same as absent: upstream skips an occupied target only when `overwrite` is not given.
        ...(typeof options?.overwrite === "boolean" ? { overwrite: options.overwrite } : {}),
        ...(options?.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
    };
}

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

// Every TabInput* kind is a class even though Diode produces only text and diff:
// `instanceof` against a missing class is a TypeError, not false.

export class TabInputText implements vscode.TabInputText {
    public constructor(public readonly uri: Uri) {}
}

export class TabInputTextDiff implements vscode.TabInputTextDiff {
    public constructor(
        public readonly original: Uri,
        public readonly modified: Uri,
    ) {}
}

export class TabInputCustom implements vscode.TabInputCustom {
    public constructor(
        public readonly uri: Uri,
        public readonly viewType: string,
    ) {}
}

export class TabInputWebview implements vscode.TabInputWebview {
    public constructor(public readonly viewType: string) {}
}

export class TabInputNotebook implements vscode.TabInputNotebook {
    public constructor(
        public readonly uri: Uri,
        public readonly notebookType: string,
    ) {}
}

export class TabInputNotebookDiff implements vscode.TabInputNotebookDiff {
    public constructor(
        public readonly original: Uri,
        public readonly modified: Uri,
        public readonly notebookType: string,
    ) {}
}

/** An empty class is the upstream surface: extensions identify the tab via `instanceof`. */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- see the comment above
export class TabInputTerminal implements vscode.TabInputTerminal {}

export enum InputBoxValidationSeverity {
    Info = 1,
    Warning = 2,
    Error = 3,
}

export enum TaskRevealKind {
    Always = 1,
    Silent = 2,
    Never = 3,
}

export enum TaskPanelKind {
    Shared = 1,
    Dedicated = 2,
    New = 3,
}

export enum ShellQuoting {
    Escape = 1,
    Strong = 2,
    Weak = 3,
}

export enum TaskScope {
    Global = 1,
    Workspace = 2,
}

function illegalTaskArgument(name: string): Error {
    return new Error(`Illegal argument: ${name}`);
}

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

/** Upstream `computeTaskExecutionId`: comma-separated values, with their own commas doubled. */
function computeTaskExecutionId(values: readonly string[]): string {
    return values.map((value) => `${value.replace(/,/g, ",,")},`).join("");
}

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

export class CustomExecution implements vscode.CustomExecution {
    public constructor(
        public callback: (resolvedDefinition: vscode.TaskDefinition) => Thenable<vscode.Pseudoterminal>,
    ) {}

    public computeId(): string {
        return `customExecution${globalThis.crypto.randomUUID()}`;
    }
}

type TaskExecutionKind = vscode.ProcessExecution | vscode.ShellExecution | vscode.CustomExecution;
type TaskScopeValue = vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder;

/**
 * `handleId` is the task's id in the core (upstream `_id`): it lets the task run without resending
 * its definition. Any setter clears it (upstream `clear`), so a modified task
 * is sent as a full definition.
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

    public get handleId(): string | undefined {
        return this.idValue;
    }

    public set handleId(value: string | undefined) {
        this.idValue = value;
    }

    /** Created by the deprecated constructor without a scope. */
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

    /** Task scope (upstream `target`): the core sets it on tasks built from its DTOs. */
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
        // A non-boolean from an untyped extension becomes `false`, as upstream.
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
        // An untyped extension may pass null/undefined; upstream replaces it with an empty value.
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

/** Deviation: no upstream `isThemeIcon`; only the tree renderer uses it to check input. */
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

export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

export enum TreeItemCheckboxState {
    Unchecked = 0,
    Checked = 1,
}

/**
 * Optional fields are `declare`, as upstream (`useDefineForClassFields: false`):
 * otherwise an instance `undefined` would shadow a subclass getter (`get tooltip()`).
 * Deviation: no static `isTreeItem`, since there is no tree renderer.
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

    // The two upstream overloads (label | Uri) as a single signature: the linter requires it.
    public constructor(
        arg: string | vscode.TreeItemLabel | vscode.Uri,
        collapsibleState: vscode.TreeItemCollapsibleState = TreeItemCollapsibleState.None,
    ) {
        this.collapsibleState = collapsibleState;
        if (arg instanceof Uri) {
            this.resourceUri = arg;
        } else {
            // `vscode.Uri` in the d.ts is a class, and `instanceof` against our `Uri` does not narrow it.
            this.label = arg as string | vscode.TreeItemLabel;
        }
    }
}

export class TelemetryTrustedValue<T = unknown> implements vscode.TelemetryTrustedValue<T> {
    // Upstream marker: the instance is lost on serialization, the flag is not.
    public readonly isTrustedTelemetryValue = true;
    public readonly value: T;

    public constructor(value: T) {
        this.value = value;
    }
}

export enum CommentThreadCollapsibleState {
    Collapsed = 0,
    Expanded = 1,
}

export enum CommentMode {
    Editing = 0,
    Preview = 1,
}

export enum CommentThreadState {
    Unresolved = 0,
    Resolved = 1,
}

/** `type/subtype[;parameters]`: upstream `_simplePattern` (`base/common/mime.ts`). */
const MIME_PATTERN = /^(.+)\/(.+?)(;.+)?$/;

/**
 * Upstream strict `normalizeMimeType`: type and subtype are lowercased,
 * parameters kept as is (RFC 2045, 5.1); a non-mime gives `undefined`.
 */
function normalizeMimeType(mime: string): string | undefined {
    const match = MIME_PATTERN.exec(mime);
    if (match === null) return undefined;
    const [, type, subtype, parameters = ""] = match;
    return `${type.toLowerCase()}/${subtype.toLowerCase()}${parameters}`;
}

export class NotebookCellOutputItem implements vscode.NotebookCellOutputItem {
    public data: Uint8Array;
    public mime: string;

    public constructor(data: Uint8Array, mime: string) {
        const normalized = normalizeMimeType(mime);
        if (normalized === undefined) {
            throw new Error(`INVALID mime type: ${mime}. Must be in the format "type/subtype[;optionalparameter]"`);
        }
        this.data = data;
        this.mime = normalized;
    }

    public static error(err: Error | { name: string; message?: string; stack?: string }): NotebookCellOutputItem {
        return NotebookCellOutputItem.json(
            { name: err.name, message: err.message, stack: err.stack },
            "application/vnd.code.notebook.error",
        );
    }

    public static stdout(value: string): NotebookCellOutputItem {
        return NotebookCellOutputItem.text(value, "application/vnd.code.notebook.stdout");
    }

    public static stderr(value: string): NotebookCellOutputItem {
        return NotebookCellOutputItem.text(value, "application/vnd.code.notebook.stderr");
    }

    public static bytes(value: Uint8Array, mime = "application/octet-stream"): NotebookCellOutputItem {
        return new NotebookCellOutputItem(value, mime);
    }

    public static text(value: string, mime = "text/plain"): NotebookCellOutputItem {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as upstream: an untyped extension may pass a non-string too
        return new NotebookCellOutputItem(new TextEncoder().encode(String(value)), mime);
    }

    // The `text/x-json` default comes from the upstream runtime; the d.ts JSDoc promises
    // `application/json`, but extensions see what the upstream runtime returns.
    public static json(value: unknown, mime = "text/x-json"): NotebookCellOutputItem {
        return NotebookCellOutputItem.text(JSON.stringify(value, undefined, "\t"), mime);
    }
}

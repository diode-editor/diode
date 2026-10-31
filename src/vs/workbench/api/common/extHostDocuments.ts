import type * as vscode from "vscode";

import {
    DEFAULT_WORD_REGEXP,
    getWordAtText,
    regExpMatchesEmptyString,
} from "../../../editor/common/core/wordHelper.ts";

import { EndOfLine, EventEmitter, Position, Range, TextDocumentChangeReason, Uri } from "./vscodeTypes.ts";
import type { IWireDocumentChangedEvent, IWireDocumentContentChange, IWireDocumentStateChanged } from "./wireTypes.ts";

/**
 * editorconfig compares documents by reference (`activeTextEditor.document ===
 * doc`), so there is exactly one {@link ExtHostTextDocument} per resource for the whole
 * session: updates mutate the existing object instead of creating a new one.
 */

export interface ExtHostDocumentMeta {
    /** `uri.toString()` is the identity; `fileName` is derived from it. */
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    readonly encoding?: string;
    /** 1=LF, 2=CRLF. */
    readonly eol?: EndOfLine;
}

export interface ExtHostDocumentSnapshot extends ExtHostDocumentMeta {
    readonly text: string;
    /** LSP requires a monotonic per-document version; without one the version is bumped locally (will-save). */
    readonly version?: number;
}

export interface TextLine {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: Range;
    readonly rangeIncludingLineBreak: Range;
    readonly firstNonWhitespaceCharacterIndex: number;
    readonly isEmptyOrWhitespace: boolean;
}

/**
 * `implements` guards against "declared in d.ts, never implemented": the object goes to
 * extensions as `vscode.TextDocument` without a cast.
 */
/** Like upstream `getWordDefinitionFor`, except the table lives in {@link DocumentRegistry}, not in the module. */
export type WordDefinitionLookup = (languageId: string) => RegExp | undefined;

const NO_WORD_DEFINITIONS: WordDefinitionLookup = () => undefined;

export type DocumentSaver = (uri: Uri) => Promise<boolean>;

const NO_SAVER: DocumentSaver = () => Promise.resolve(false);

export class ExtHostTextDocument implements vscode.TextDocument {
    public readonly uri: Uri;
    /** Reopening a resource "revives" the same object: identity is stable. */
    public isClosed = false;

    public encoding = "utf8";

    /** Per `vscode.d.ts`, shorthand for `uri.fsPath`: derived from the uri, not the other way round. */
    public get fileName(): string {
        return this.uri.fsPath;
    }

    public get isUntitled(): boolean {
        return this.uri.scheme === "untitled";
    }

    public eol: EndOfLine = EndOfLine.LF;

    public languageId = "plaintext";
    public isDirty = false;
    public version = 0;

    /** Source of truth is the lines, without line breaks, as upstream's mirror: edits modify them, {@link eol} joins them. */
    private lineStore: string[] = [""];
    /** Cache, built lazily from the lines until the next mutation. */
    private textCache: string | null = "";

    public constructor(
        uri: Uri,
        private readonly wordDefinitionFor: WordDefinitionLookup = NO_WORD_DEFINITIONS,
        private readonly saver: DocumentSaver = NO_SAVER,
    ) {
        this.uri = uri;
    }

    public applyMeta(meta: ExtHostDocumentMeta): void {
        if (meta.languageId !== undefined) this.languageId = meta.languageId;
        if (meta.isDirty !== undefined) this.isDirty = meta.isDirty;
        if (meta.encoding !== undefined) this.encoding = meta.encoding;
        if (meta.eol !== undefined) this.eol = meta.eol;
    }

    /** The model's `versionId` from the snapshot wins over the local counter. */
    public applyFull(snapshot: ExtHostDocumentSnapshot): void {
        // A text with its own line breaks and no word from the host (a virtual document) speaks for itself.
        if (snapshot.eol === undefined && snapshot.text.includes("\r\n")) this.eol = EndOfLine.CRLF;
        this.applyMeta(snapshot);
        this.lineStore = splitLines(snapshot.text);
        // Stryker disable next-line ConditionalExpression,StringLiteral: an empty cache is only rebuilt, to the same text
        this.textCache = this.eol === EndOfLine.LF && !snapshot.text.includes("\r") ? snapshot.text : null;
        this.version = snapshot.version ?? this.version + 1;
    }

    /**
     * Edits come in wire order (descending, in coordinates before each
     * edit); `rangeOffset`/`rangeLength` are computed on the lines BEFORE the edit, as in
     * upstream `mirrorTextModel`.
     */
    public acceptChanges(version: number, changes: readonly IWireDocumentContentChange[]): IDocumentContentChange[] {
        const lines = this.lines();
        const result: IDocumentContentChange[] = [];
        for (const { range: wire, text } of changes) {
            const range = this.validateRange(
                new Range(wire.start.line, wire.start.character, wire.end.line, wire.end.character),
            );
            const rangeOffset = this.offsetAt(range.start);
            const rangeLength = this.offsetAt(range.end) - rangeOffset;
            const prefix = lines[range.start.line].slice(0, range.start.character);
            const suffix = lines[range.end.line].slice(range.end.character);
            const inserted = splitLines(prefix + text + suffix);
            spliceLines(lines, range.start.line, range.end.line - range.start.line + 1, inserted);
            this.textCache = null;
            result.push({ range, rangeOffset, rangeLength, text });
        }
        this.version = version;
        return result;
    }

    /** `false`: nothing an extension could see changed. */
    public acceptState(state: { version: number; isDirty: boolean; eol: EndOfLine }): boolean {
        const changed = state.version !== this.version || state.isDirty !== this.isDirty || state.eol !== this.eol;
        this.textCache = null;
        this.eol = state.eol;
        this.isDirty = state.isDirty;
        this.version = state.version;
        return changed;
    }

    public getText(range?: Range): string {
        if (range === undefined) return (this.textCache ??= this.lines().join(this.eolText));
        // Per the `vscode.d.ts` contract the range "will be adjusted": an extra character
        // from a provider with a stale copy of the text is no reason to throw.
        const valid = this.validateRange(range);
        const lines = this.lines();
        if (valid.start.line === valid.end.line) {
            return lines[valid.start.line].slice(valid.start.character, valid.end.character);
        }
        const parts: string[] = [lines[valid.start.line].slice(valid.start.character)];
        for (let n = valid.start.line + 1; n < valid.end.line; n++) {
            parts.push(lines[n]);
        }
        parts.push(lines[valid.end.line].slice(0, valid.end.character));
        return parts.join(this.eolText);
    }

    /** The host's text comes with `\n` whatever the EOL: only the lines tell whether it differs. */
    public hasSameText(text: string): boolean {
        // Stryker disable next-line StringLiteral: splitting a text without `\r` gives the same text back
        return this.lines().join("\n") === (text.includes("\r") ? splitLines(text).join("\n") : text);
    }

    /** Computed on the {@link getText} text. */
    public offsetAt(position: Position): number {
        const valid = this.validatePosition(position);
        const lines = this.lines();
        let offset = 0;
        for (let n = 0; n < valid.line; n++) offset += lines[n].length + this.eolText.length;
        return offset + valid.character;
    }

    /**
     * An offset beyond the bounds is clamped to them (`vscode.d.ts` contract): this is how
     * `prettier` builds a minimal edit by comparing strings character by character.
     */
    public positionAt(offset: number): Position {
        const lines = this.lines();
        let remaining = Math.max(0, offset);
        // The text length is not taken up front: after an edit that means joining the whole
        // mirror (13 MB per provider call on 200k lines).
        let line = 0;
        while (remaining > lines[line].length) {
            if (line === lines.length - 1) return new Position(line, lines[line].length);
            // Inside the CRLF: the end of the line, as upstream.
            if (remaining < lines[line].length + this.eolText.length) return new Position(line, lines[line].length);
            remaining -= lines[line].length + this.eolText.length;
            line++;
        }
        return new Position(line, remaining);
    }

    /**
     * ALWAYS a new object: the input may be any `{line, character}` from an
     * extension, and returning it would return a foreign type.
     */
    public validatePosition(position: Position): Position {
        const lines = this.lines();
        const line = Math.min(Math.max(0, position.line), lines.length - 1);
        return new Position(line, Math.min(Math.max(0, position.character), lines[line].length));
    }

    public validateRange(range: Range): Range {
        return new Range(this.validatePosition(range.start), this.validatePosition(range.end));
    }

    /** Like upstream `ExtHostDocumentData._getWordRangeAtPosition`, including the exception text. */
    public getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined {
        const valid = this.validatePosition(position);
        if (regex !== undefined && regExpMatchesEmptyString(regex)) {
            throw new Error(
                `[getWordRangeAtPosition]: ignoring custom regexp '${regex.source}' because it matches the empty string.`,
            );
        }
        const definition = regex ?? this.wordDefinitionFor(this.languageId) ?? DEFAULT_WORD_REGEXP;
        const word = getWordAtText(valid.character, definition, this.lines()[valid.line]);
        return word === null ? undefined : new Range(valid.line, word.start, valid.line, word.end);
    }

    /** Rejects on a closed document, as upstream. */
    public save(): Promise<boolean> {
        if (this.isClosed) return Promise.reject(new Error("Document has been closed"));
        return this.saver(this.uri);
    }

    public get lineCount(): number {
        return this.lines().length;
    }

    public lineAt(lineOrPosition: number | Position): TextLine {
        const lineNumber = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
        const lines = this.lines();
        if (lineNumber < 0 || lineNumber >= lines.length) {
            throw new RangeError(`Illegal line number ${lineNumber} (lineCount=${lines.length})`);
        }
        const text = lines[lineNumber];
        const firstNonWhitespaceCharacterIndex = firstNonWhitespace(text);
        const isLast = lineNumber === lines.length - 1;
        return {
            lineNumber,
            text,
            range: new Range(lineNumber, 0, lineNumber, text.length),
            rangeIncludingLineBreak: isLast
                ? new Range(lineNumber, 0, lineNumber, text.length)
                : new Range(lineNumber, 0, lineNumber + 1, 0),
            firstNonWhitespaceCharacterIndex,
            isEmptyOrWhitespace: firstNonWhitespaceCharacterIndex === text.length,
        };
    }

    private lines(): string[] {
        return this.lineStore;
    }

    private get eolText(): string {
        return this.eol === EndOfLine.CRLF ? "\r\n" : "\n";
    }
}

/**
 * Spreading a big insert into `splice` overflows the call stack: a 200k-line edit would be lost to the mirror.
 * Not `spliceInChunks`: `base/common/arrays` would go over the extension host chunk's budget for code shared with main.
 */
function spliceLines(lines: string[], start: number, deleteCount: number, inserted: readonly string[]): void {
    const tail = lines.slice(start + deleteCount);
    lines.length = start;
    for (const line of inserted) lines.push(line);
    for (const line of tail) lines.push(line);
}

function splitLines(text: string): string[] {
    return text.includes("\r") ? text.split(/\r\n|\r|\n/) : text.split("\n");
}

function firstNonWhitespace(text: string): number {
    for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) return i;
    }
    return text.length;
}

/** Keyed by resource, not path: a path is ambiguous for non-file schemes. */
export class DocumentRegistry {
    private readonly documents = new Map<string, ExtHostTextDocument>();
    private readonly wordDefinitions = new Map<string, RegExp | undefined>();

    public readonly wordDefinitionFor: WordDefinitionLookup = (languageId) => this.wordDefinitions.get(languageId);

    public saver: DocumentSaver = NO_SAVER;

    /** Stable wrapper: the document outlives replacing {@link saver}. */
    public readonly saveDocument: DocumentSaver = (uri) => this.saver(uri);

    public setWordDefinitionFor(languageId: string, wordDefinition: RegExp | undefined): void {
        this.wordDefinitions.set(languageId, wordDefinition);
    }

    public get(uri: Uri): ExtHostTextDocument | undefined {
        return this.documents.get(uri.toString());
    }

    /** The document is needed BEFORE the snapshot arrives. */
    public getOrCreate(uri: Uri): ExtHostTextDocument {
        const key = uri.toString();
        let doc = this.documents.get(key);
        if (doc === undefined) {
            doc = new ExtHostTextDocument(uri, this.wordDefinitionFor, this.saveDocument);
            this.documents.set(key, doc);
        }
        return doc;
    }

    public upsertMeta(meta: ExtHostDocumentMeta): ExtHostTextDocument {
        const doc = this.getOrCreate(Uri.parse(meta.uri));
        doc.applyMeta(meta);
        return doc;
    }

    public upsertFull(snapshot: ExtHostDocumentSnapshot): ExtHostTextDocument {
        const doc = this.getOrCreate(Uri.parse(snapshot.uri));
        doc.applyFull(snapshot);
        return doc;
    }

    public all(): ExtHostTextDocument[] {
        return [...this.documents.values()];
    }
}

export interface IDocumentContentChange {
    readonly range: Range;
    readonly rangeOffset: number;
    readonly rangeLength: number;
    readonly text: string;
}

export interface IDocumentChangeEvent {
    readonly document: ExtHostTextDocument;
    readonly contentChanges: readonly IDocumentContentChange[];
    readonly reason: TextDocumentChangeReason | undefined;
}

function changeReasonOf(event: IWireDocumentChangedEvent): TextDocumentChangeReason | undefined {
    if (event.isUndoing === true) return TextDocumentChangeReason.Undo;
    if (event.isRedoing === true) return TextDocumentChangeReason.Redo;
    return undefined;
}

function endOfText(text: string): Position {
    const lines = text.split("\n");
    const last = lines.length - 1;
    return new Position(last, lines[last].length);
}

/**
 * The ONLY entry point of text into the registry. Invariant: an onDidOpen/onDidChange
 * consumer (vscode-languageclient → LSP) sees EVERY transition of the registry text,
 * and the full range of didChange is computed from the previous text.
 * Writing around the tracker broke both: the provider was called before didOpen ("Unexpected
 * resource" from typescript-language-server), and an overwritten oldText produced an edit
 * outside tsserver's copy and crashed it.
 */
export class DocumentSyncTracker {
    private readonly opened = new Set<string>();
    public readonly onDidOpenEmitter = new EventEmitter<ExtHostTextDocument>();
    public readonly onDidChangeEmitter = new EventEmitter<IDocumentChangeEvent>();
    public readonly onDidCloseEmitter = new EventEmitter<ExtHostTextDocument>();

    public constructor(
        private readonly registry: DocumentRegistry,
        private readonly warn: (message: string) => void = (message) => {
            console.warn(`[ext-host] ${message}`);
        },
    ) {}

    /** Changed text → one full-range edit: valid for both Full and Incremental sync. */
    public open(snapshot: ExtHostDocumentSnapshot): ExtHostTextDocument {
        const prev = this.registry.get(Uri.parse(snapshot.uri));
        if (prev === undefined || !this.opened.has(snapshot.uri)) {
            const doc = this.registry.upsertFull(snapshot);
            // Revival after didClose: the same object, isClosed cleared.
            doc.isClosed = false;
            this.opened.add(snapshot.uri);
            this.onDidOpenEmitter.fire(doc);
            return doc;
        }
        if (prev.hasSameText(snapshot.text)) {
            prev.applyMeta(snapshot);
            return prev;
        }
        const oldText = prev.getText();
        // Range BEFORE the upsert: the registry mutates the stable document object.
        const fullRange = new Range(new Position(0, 0), endOfText(oldText));
        const doc = this.registry.upsertFull(snapshot);
        this.onDidChangeEmitter.fire({
            document: doc,
            contentChanges: [{ range: fullRange, rangeOffset: 0, rangeLength: oldText.length, text: snapshot.text }],
            reason: undefined,
        });
        return doc;
    }

    /**
     * Edits for a document that is not open are dropped with a warning: the host
     * sends them only for open ones, and applied to someone else's text they would corrupt the mirror.
     */
    public change(event: IWireDocumentChangedEvent): ExtHostTextDocument | null {
        if (!this.opened.has(event.uri)) {
            this.warn(`document sync: changes for a document that is not open: ${event.uri}`);
            return null;
        }
        // An open document is always in the registry; `getOrCreate` only finds it.
        const doc = this.registry.getOrCreate(Uri.parse(event.uri));
        const contentChanges = doc.acceptChanges(event.version, event.changes);
        doc.applyMeta({ uri: event.uri, isDirty: event.isDirty });
        this.onDidChangeEmitter.fire({ document: doc, contentChanges, reason: changeReasonOf(event) });
        return doc;
    }

    /** Upstream `$acceptDirtyStateChanged` and an EOL change: the event fires with empty `contentChanges`. */
    public changeState(state: IWireDocumentStateChanged): void {
        if (!this.opened.has(state.uri)) return;
        const doc = this.registry.getOrCreate(Uri.parse(state.uri));
        if (doc.acceptState(state))
            this.onDidChangeEmitter.fire({ document: doc, contentChanges: [], reason: undefined });
    }

    /**
     * `null`: the document is not open or the request is stale (the core drops its response
     * anyway). A request version ahead of the mirror is a broken ordering invariant
     * (edits and requests travel on one channel): a warning and `null` too.
     */
    public resolve(uri: string, version: number | undefined, languageId?: unknown): ExtHostTextDocument | null {
        if (!this.opened.has(uri)) return null;
        const doc = this.registry.getOrCreate(Uri.parse(uri));
        if (doc.version !== version) {
            // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent — comparing with `undefined` is always false, and equal versions are filtered out by the condition above
            if (version !== undefined && version > doc.version) {
                this.warn(
                    `document sync: request for ${uri} v${String(version)} is ahead of the mirror v${String(doc.version)}`,
                );
            }
            return null;
        }
        if (typeof languageId === "string") doc.applyMeta({ uri, languageId });
        return doc;
    }

    /**
     * Resets the didOpen dedup: after didClose LSP requires a fresh didOpen. The document
     * stays in the registry: extensions may keep a reference to a closed one.
     */
    public close(uri: Uri): ExtHostTextDocument | null {
        const doc = this.registry.get(uri);
        if (doc === undefined || !this.opened.has(uri.toString())) return null;
        this.opened.delete(uri.toString());
        doc.isClosed = true;
        this.onDidCloseEmitter.fire(doc);
        return doc;
    }
}

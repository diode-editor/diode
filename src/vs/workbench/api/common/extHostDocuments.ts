import type * as vscode from "vscode";

import {
    DEFAULT_WORD_REGEXP,
    getWordAtText,
    regExpMatchesEmptyString,
} from "../../../editor/common/core/wordHelper.ts";

import { EndOfLine, EventEmitter, Position, Range, Uri } from "./vscodeTypes.ts";
import type { IWireDocumentChangedEvent, IWireDocumentContentChange } from "./wireTypes.ts";

/**
 * editorconfig сравнивает документы по ссылке (`activeTextEditor.document ===
 * doc`), поэтому на ресурс — ровно один {@link ExtHostTextDocument} на всю
 * сессию: обновления мутируют существующий объект, а не создают новый.
 */

export interface ExtHostDocumentMeta {
    /** `uri.toString()` — идентичность; `fileName` выводится из неё. */
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    readonly encoding?: string;
    /** 1=LF, 2=CRLF. */
    readonly eol?: EndOfLine;
}

export interface ExtHostDocumentSnapshot extends ExtHostDocumentMeta {
    readonly text: string;
    /** LSP требует монотонной версии per-document; без неё версия инкрементируется локально (will-save). */
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
 * `implements` — страж против «объявили в d.ts, не реализовали»: расширениям
 * объект уходит как `vscode.TextDocument` без каста.
 */
/** Как `getWordDefinitionFor` upstream, только таблица живёт в {@link DocumentRegistry}, а не в модуле. */
export type WordDefinitionLookup = (languageId: string) => RegExp | undefined;

const NO_WORD_DEFINITIONS: WordDefinitionLookup = () => undefined;

export type DocumentSaver = (uri: Uri) => Promise<boolean>;

const NO_SAVER: DocumentSaver = () => Promise.resolve(false);

export class ExtHostTextDocument implements vscode.TextDocument {
    public readonly uri: Uri;
    /** Повторное открытие ресурса «воскрешает» тот же объект: идентичность стабильна. */
    public isClosed = false;

    public encoding = "utf8";

    /** По `vscode.d.ts` — shorthand для `uri.fsPath`: производное от uri, а не наоборот. */
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

    /** Источник правды — строки (разделитель `\n`): их правят правки. */
    private lineStore: string[] = [""];
    /** Кэш, собирается из строк лениво до следующей мутации. */
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

    /** `versionId` модели из снапшота побеждает локальный счётчик. */
    public applyFull(snapshot: ExtHostDocumentSnapshot): void {
        this.applyMeta(snapshot);
        this.textCache = snapshot.text;
        this.lineStore = snapshot.text.split("\n");
        this.version = snapshot.version ?? this.version + 1;
    }

    /**
     * Правки идут в порядке провода (по убыванию, в координатах до каждой
     * правки); `rangeOffset`/`rangeLength` считаются по строкам ДО правки, как у
     * `mirrorTextModel` эталона.
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
            const inserted = (prefix + text + suffix).split("\n");
            lines.splice(range.start.line, range.end.line - range.start.line + 1, ...inserted);
            this.textCache = null;
            result.push({ range, rangeOffset, rangeLength, text });
        }
        this.version = version;
        return result;
    }

    public getText(range?: Range): string {
        if (range === undefined) return (this.textCache ??= this.lines().join("\n"));
        // По контракту `vscode.d.ts` диапазон «will be adjusted»: лишний символ
        // от провайдера с устаревшей копией текста — не повод бросать.
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
        return parts.join("\n");
    }

    /**
     * Считается по тексту {@link getText}: `\r` у CRLF остаётся частью строки,
     * поэтому «длина строки + 1» точна для обоих EOL.
     */
    public offsetAt(position: Position): number {
        const valid = this.validatePosition(position);
        const lines = this.lines();
        let offset = 0;
        for (let n = 0; n < valid.line; n++) offset += lines[n].length + 1;
        return offset + valid.character;
    }

    /**
     * Смещение за границами прижимается к ним (контракт `vscode.d.ts`) — так
     * `prettier` строит минимальную правку, сравнивая строки посимвольно.
     */
    public positionAt(offset: number): Position {
        const lines = this.lines();
        let remaining = Math.max(0, offset);
        // Длину текста заранее не берём: после правки это склейка всего
        // зеркала (на 200k строк — 13 МБ на каждый вызов провайдера).
        let line = 0;
        while (remaining > lines[line].length) {
            if (line === lines.length - 1) return new Position(line, lines[line].length);
            remaining -= lines[line].length + 1;
            line++;
        }
        return new Position(line, remaining);
    }

    /**
     * Новый объект — ВСЕГДА: на входе бывает любой `{line, character}` из
     * расширения, и отдать его обратно — отдать чужой тип.
     */
    public validatePosition(position: Position): Position {
        const lines = this.lines();
        const line = Math.min(Math.max(0, position.line), lines.length - 1);
        return new Position(line, Math.min(Math.max(0, position.character), lines[line].length));
    }

    public validateRange(range: Range): Range {
        return new Range(this.validatePosition(range.start), this.validatePosition(range.end));
    }

    /** Как `ExtHostDocumentData._getWordRangeAtPosition` upstream, вместе с текстом исключения. */
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

    /** Закрытый документ — отказ, как upstream. */
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
}

function firstNonWhitespace(text: string): number {
    for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) return i;
    }
    return text.length;
}

/** Ключ — ресурс, а не путь: путь у не-file схем неоднозначен. */
export class DocumentRegistry {
    private readonly documents = new Map<string, ExtHostTextDocument>();
    private readonly wordDefinitions = new Map<string, RegExp | undefined>();

    public readonly wordDefinitionFor: WordDefinitionLookup = (languageId) => this.wordDefinitions.get(languageId);

    public saver: DocumentSaver = NO_SAVER;

    /** Стабильная обёртка: документ переживает замену {@link saver}. */
    public readonly saveDocument: DocumentSaver = (uri) => this.saver(uri);

    public setWordDefinitionFor(languageId: string, wordDefinition: RegExp | undefined): void {
        this.wordDefinitions.set(languageId, wordDefinition);
    }

    public get(uri: Uri): ExtHostTextDocument | undefined {
        return this.documents.get(uri.toString());
    }

    /** Документ нужен ДО прихода снапшота. */
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
    readonly reason: undefined;
}

function endOfText(text: string): Position {
    const lines = text.split("\n");
    const last = lines.length - 1;
    return new Position(last, lines[last].length);
}

/**
 * ЕДИНСТВЕННАЯ точка входа текста в реестр. Инвариант: потребитель
 * onDidOpen/onDidChange (vscode-languageclient → LSP) видит КАЖДЫЙ переход
 * текста реестра, а full-range у didChange посчитан от предыдущего текста.
 * Запись мимо трекера ломала оба: провайдер звался до didOpen («Unexpected
 * resource» у typescript-language-server), а затёртый oldText давал правку за
 * пределами копии tsserver и ронял его.
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

    /** Изменившийся текст → одна full-range правка: валидно и для Full, и для Incremental sync. */
    public open(snapshot: ExtHostDocumentSnapshot): ExtHostTextDocument {
        const prev = this.registry.get(Uri.parse(snapshot.uri));
        if (prev === undefined || !this.opened.has(snapshot.uri)) {
            const doc = this.registry.upsertFull(snapshot);
            // Воскрешение после didClose: тот же объект, isClosed снят.
            doc.isClosed = false;
            this.opened.add(snapshot.uri);
            this.onDidOpenEmitter.fire(doc);
            return doc;
        }
        const oldText = prev.getText();
        if (oldText === snapshot.text) {
            prev.applyMeta(snapshot);
            return prev;
        }
        // Диапазон — ДО upsert'а: реестр мутирует стабильный объект документа.
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
     * По неоткрытому документу правки отбрасываются с предупреждением: хост
     * шлёт их только открытым, а к чужому тексту они испортили бы зеркало.
     */
    public change(event: IWireDocumentChangedEvent): ExtHostTextDocument | null {
        if (!this.opened.has(event.uri)) {
            this.warn(`document sync: changes for a document that is not open: ${event.uri}`);
            return null;
        }
        // Открытый документ всегда есть в реестре — `getOrCreate` его только находит.
        const doc = this.registry.getOrCreate(Uri.parse(event.uri));
        const contentChanges = doc.acceptChanges(event.version, event.changes);
        doc.applyMeta({ uri: event.uri, isDirty: event.isDirty });
        this.onDidChangeEmitter.fire({ document: doc, contentChanges, reason: undefined });
        return doc;
    }

    /**
     * `null` — документ не открыт или запрос устарел (ядро его ответ всё равно
     * отбросит). Версия запроса впереди зеркала — нарушенный инвариант порядка
     * (правки и запросы едут одним каналом): предупреждение и тоже `null`.
     */
    public resolve(uri: string, version: number | undefined, languageId?: unknown): ExtHostTextDocument | null {
        if (!this.opened.has(uri)) return null;
        const doc = this.registry.getOrCreate(Uri.parse(uri));
        if (doc.version !== version) {
            // Stryker disable next-line ConditionalExpression,EqualityOperator: эквивалентны — сравнение с `undefined` всегда ложно, а равные версии отсеяны условием выше
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
     * Сброс didOpen-дедупа: после didClose LSP требует свежего didOpen. Документ
     * остаётся в реестре — расширения вправе держать ссылку на закрытый.
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

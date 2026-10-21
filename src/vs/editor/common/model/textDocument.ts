import { Emitter } from "../../../base/common/event.ts";
import { UTF8_BOM_CHARACTER } from "../../../base/common/strings.ts";
import { EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import { clampPositionToDocument, comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { Range } from "../core/range.ts";
import type { ITextBuffer, ITextBufferFactory, ITextSnapshot } from "../model.ts";
import { DefaultEndOfLine, EndOfLinePreference, ValidAnnotatedEditOperation } from "../model.ts";

import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import type { IApplyEditsResult, ITextDocument } from "./iTextDocument.ts";
import { PieceTreeTextBufferBuilder } from "./pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts";
import { type IModelDeltaDecoration, TrackedDecorations } from "./trackedDecorations.ts";

/**
 * Адаптер 0-based {@link ITextDocument} к 1-based `PieceTreeTextBuffer` эталона:
 * ±1 живёт только здесь (docs/arch/Editor.md).
 *
 * EOL при загрузке приводится к преобладающему (`normalizeEOL`), одиночный `\r` —
 * тоже перевод строки. Наружу — LF: {@link getText} и правки с `\n`,
 * {@link serialize} — с `eol`.
 */
export class TextDocument implements ITextDocument {
    private buffer: ITextBuffer;
    private readonly onDidChangeContentEmitter = new Emitter<IDocumentContentChange>();
    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;
    private readonly onDidChangeModelContentEmitter = new Emitter<IModelContentChangedEvent>();
    public readonly onDidChangeModelContent = this.onDidChangeModelContentEmitter.event;
    private readonly onDidChangeLanguageEmitter = new Emitter<IDocumentLanguageChange>();
    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;
    private readonly onDidChangeEolEmitter = new Emitter<void>();
    public readonly onDidChangeEol = this.onDidChangeEolEmitter.event;
    private innerVersionId = 0;
    private languageIdValue: string;
    private readonly decorations = new TrackedDecorations();

    public constructor(text: TextSource, languageId = "plaintext") {
        this.buffer = createTextBuffer(text);
        this.languageIdValue = languageId;
    }

    public get versionId(): number {
        return this.innerVersionId;
    }

    public get eol(): EndOfLine {
        return this.buffer.getEOL() === "\r\n" ? EndOfLine.CRLF : EndOfLine.LF;
    }

    public get languageId(): string {
        return this.languageIdValue;
    }

    /** Не трогает `versionId`: смена языка не делает документ dirty. */
    public setLanguage(languageId: string): void {
        if (languageId === this.languageIdValue) return;
        const oldLanguageId = this.languageIdValue;
        this.languageIdValue = languageId;
        this.onDidChangeLanguageEmitter.fire({ oldLanguageId, newLanguageId: languageId });
    }

    public get lineCount(): number {
        return this.buffer.getLineCount();
    }

    public getLineContent(lineIndex: number): string {
        this.assertValidLineIndex(lineIndex);
        return this.buffer.getLineContent(lineIndex + 1);
    }

    /**
     * Через содержимое, а не `buffer.getLineLength`: тот дважды спускается по
     * дереву без кэша. Проход по 200k строк — ~20 мс против ~110 мс.
     */
    public getLineLength(lineIndex: number): number {
        return this.getLineContent(lineIndex).length;
    }

    public getText(): string {
        return this.buffer.getValueInRange(this.fullRange(), EndOfLinePreference.LF);
    }

    public serialize(): string {
        return this.buffer.getValueInRange(this.fullRange(), EndOfLinePreference.TextDefined);
    }

    /** {@link serialize} по кускам; содержимое — на момент вызова, поздние правки не попадут. */
    public createSnapshot(): Iterable<string> {
        return readSnapshot(this.buffer.createSnapshot(false));
    }

    public getLinesContent(): string[] {
        return this.buffer.getLinesContent();
    }

    public setEol(eol: EndOfLine): void {
        if (eol === this.eol) return;
        this.buffer.setEOL(eolToSequence(eol));
        this.onDidChangeEolEmitter.fire();
    }

    /** В том же документе, событием с `isFlush`: перечитка — обычная правка для всех подписчиков. */
    public setText(text: TextSource): void {
        const oldEndLine = this.lineCount - 1;
        const eolBefore = this.eol;
        this.innerVersionId++;
        // Stryker disable next-line CallExpression: у буфера только свой эмиттер без подписчиков — наблюдаемого эффекта нет
        this.buffer.dispose();
        this.buffer = createTextBuffer(text);
        this.decorations.acceptFlush(this);
        this.fireChange({
            startLine: 0,
            oldEndLine,
            newEndLine: this.lineCount - 1,
            isFlush: true,
        });
        this.onDidChangeModelContentEmitter.fire({
            changes: [],
            versionId: this.innerVersionId,
            eol: this.eol,
            isFlush: true,
        });
        if (this.eol !== eolBefore) this.onDidChangeEolEmitter.fire();
    }

    public deltaDecorations(oldIds: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[] {
        return this.decorations.delta(oldIds, newDecorations, this);
    }

    public getDecorationRange(id: string): IRange | null {
        return this.decorations.getRange(id);
    }

    public getTextInRange(range: IRange): string {
        return this.buffer.getValueInRange(toBufferRange(this.validateRange(range)), EndOfLinePreference.LF);
    }

    public applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult {
        if (edits.length === 0) {
            return { appliedVersion: this.innerVersionId, inverseEdits: [] };
        }

        // Тот же порядок, что `_sortOpsAscending` буфера, — обратные правки приходят ровно в нём.
        const docOrder = edits.map((edit) => this.validateEdit(edit)).sort(compareTextEditsInDocumentOrder);
        for (let i = 1; i < docOrder.length; i++) {
            if (comparePositions(docOrder[i].range.start, docOrder[i - 1].range.end) < 0) {
                // Тот же отказ, что у буфера, но до того, как сдвинулись декорации.
                throw new Error("Overlapping ranges are not allowed!");
            }
        }

        this.innerVersionId++;

        // Обратный docOrder, а не сортировка по убыванию: стабильная сортировка
        // оставила бы правки с СОВПАДАЮЩИМИ диапазонами (две вставки в одну
        // точку — обратные правки соседних удалений) задом наперёд.
        const reversed = [...docOrder].reverse();

        // Декорации двигаются, пока текст ещё старый: смещения меряются по
        // прежнему тексту. Снизу вверх нижние правки не трогают строки верхних,
        // поэтому длины берутся из буфера до батча.
        for (const edit of reversed) {
            this.decorations.acceptEdit(edit, (line) => this.getLineLength(line));
        }

        const result = this.buffer.applyEdits(
            docOrder.map((edit) => toBufferOperation(toBufferRange(edit.range), edit.text)),
            // Stryker disable next-line BooleanLiteral: автопробелы буфер считает, но мы их не читаем
            false,
            true,
        );

        // Обратные правки — в координатах УЖЕ ПРИМЕНЁННОГО документа, в
        // документном порядке; текст буфера — с его EOL, наружу — LF.
        // Stryker disable next-line ArrayDeclaration: при computeUndoEdits буфер всегда отдаёт массив
        const reverseEdits = result.reverseEdits ?? [];
        const inverseEdits = reverseEdits.map((op) => createTextEdit(fromBufferRange(op.range), toLf(op.text)));

        // Каждое следующее событие адресует документ, где предыдущие УЖЕ
        // применены, поэтому границы сдвигаются на накопленную разницу строк.
        // Без сдвига `EditorViewState.remapForDocumentChange` падал на
        // `getLineLength` за концом документа.
        let lineShift = 0;
        for (const edit of docOrder) {
            const startLine = edit.range.start.line;
            const oldEndLine = edit.range.end.line;
            const newEndLine = startLine + countLineFeeds(edit.text);
            this.fireChange({
                startLine: startLine + lineShift,
                oldEndLine: oldEndLine + lineShift,
                newEndLine: newEndLine + lineShift,
            });
            lineShift += newEndLine - oldEndLine;
        }

        // `reversed` — порядок применения в исходных координатах: последовательно
        // к копии строк до батча даёт текст после него.
        this.onDidChangeModelContentEmitter.fire({
            changes: reversed.map((edit) => ({ range: edit.range, text: edit.text })),
            versionId: this.innerVersionId,
            eol: this.eol,
            isFlush: false,
        });

        return { appliedVersion: this.innerVersionId, inverseEdits };
    }

    /**
     * Переводы строк текста — к `\n`: буфер считает переводами и `\r`/`\r\n`, а
     * события, декорации и зеркало расширений режут по `\n` — разошлись бы.
     */
    private validateEdit(edit: ITextEdit): ITextEdit {
        return { range: this.validateRange(edit.range), text: toLf(edit.text) };
    }

    private validateRange(range: IRange): IRange {
        return {
            start: clampPositionToDocument(this, range.start),
            end: clampPositionToDocument(this, range.end),
        };
    }

    private fullRange(): Range {
        const lineCount = this.buffer.getLineCount();
        return new Range(1, 1, lineCount, this.buffer.getLineLength(lineCount) + 1);
    }

    private fireChange(change: IDocumentContentChange): void {
        this.onDidChangeContentEmitter.fire(change);
    }

    private assertValidLineIndex(lineIndex: number): void {
        const lineCount = this.buffer.getLineCount();
        if (lineIndex < 0 || lineIndex >= lineCount) {
            throw new RangeError(`Line index ${lineIndex.toString()} out of bounds [0, ${(lineCount - 1).toString()}]`);
        }
    }
}

export type TextSource = string | ITextBufferFactory;

/** Граница куска может резать `\r\n` и суррогатную пару — билдер держит хвост до следующего. */
export function createTextBufferFactoryFromChunks(chunks: Iterable<string>): ITextBufferFactory {
    const builder = new PieceTreeTextBufferBuilder();
    for (const chunk of chunks) builder.acceptChunk(chunk);
    // Stryker disable next-line BooleanLiteral: без нормализации буфер приводит EOL на каждом чтении (регэксп по тексту) — та же семантика, другая цена
    return builder.finish(true);
}

function createTextBuffer(text: TextSource): ITextBuffer {
    const factory = typeof text === "string" ? createTextBufferFactoryFromChunks([text]) : text;
    const { textBuffer } = factory.create(DefaultEndOfLine.LF);
    // Билдер снимает ведущий BOM в отдельное поле, но наш декодер BOM уже снял
    // (`encoding.ts`): здесь U+FEFF — обычный символ, возвращаем его в текст.
    if (textBuffer.getBOM() !== "") {
        // Stryker disable next-line BooleanLiteral: ни автопробелы, ни обратная правка здесь не читаются
        textBuffer.applyEdits([toBufferOperation(new Range(1, 1, 1, 1), UTF8_BOM_CHARACTER)], false, false);
    }
    return textBuffer;
}

/** Порог склейки кусков снимка — как у `TextModelSnapshot` эталона. */
const SNAPSHOT_CHUNK_LENGTH = 64 * 1024;

function* readSnapshot(snapshot: ITextSnapshot): Generator<string> {
    let parts: string[] = [];
    let length = 0;
    for (let piece = snapshot.read(); piece !== null; piece = snapshot.read()) {
        parts.push(piece);
        length += piece.length;
        if (length >= SNAPSHOT_CHUNK_LENGTH) {
            yield parts.join("");
            parts = [];
            length = 0;
        }
    }
    if (parts.length > 0) yield parts.join("");
}

/** `_isTracked` — чтобы буфер не схлопнул батч от 1000 правок в одну (`_reduceOperations`). */
function toBufferOperation(range: Range, text: string): ValidAnnotatedEditOperation {
    // Stryker disable next-line BooleanLiteral: буфер лишь переносит флаг в результат
    const forceMoveMarkers = false;
    // Stryker disable next-line BooleanLiteral: без recordTrimAutoWhitespace флаг не читается
    const isAutoWhitespaceEdit = false;
    return new ValidAnnotatedEditOperation(null, range, text, forceMoveMarkers, isAutoWhitespaceEdit, true);
}

function toBufferRange(range: IRange): Range {
    return new Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}

function fromBufferRange(range: Range): IRange {
    return createRange(range.startLineNumber - 1, range.startColumn - 1, range.endLineNumber - 1, range.endColumn - 1);
}

function toLf(text: string): string {
    return text.replace(/\r\n?/g, "\n");
}

function countLineFeeds(text: string): number {
    let count = 0;
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
    return count;
}

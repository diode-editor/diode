import { Emitter } from "../../../base/common/event.ts";
import { UTF8_BOM_CHARACTER } from "../../../base/common/strings.ts";
import { EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import { clampPositionToDocument, comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { Range } from "../core/range.ts";
import type { ITextBuffer } from "../model.ts";
import { DefaultEndOfLine, EndOfLinePreference, ValidAnnotatedEditOperation } from "../model.ts";

import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import type { IApplyEditsResult, ITextDocument } from "./iTextDocument.ts";
import { PieceTreeTextBufferBuilder } from "./pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts";
import { type IModelDeltaDecoration, TrackedDecorations } from "./trackedDecorations.ts";

/**
 * Документ поверх перенесённого из эталона `PieceTreeTextBuffer` — адаптер
 * между нашим 0-based контрактом {@link ITextDocument} и 1-based буфером
 * (±1 живёт только здесь, docs/arch/Editor.md). Правка, строка, длина строки —
 * O(log n) от размера файла, как в VS Code.
 *
 * EOL — как у эталона по умолчанию (`normalizeEOL` билдера): при загрузке
 * переводы строк приводятся к преобладающему, он и становится {@link eol}
 * документа и буфера; одиночный `\r` — тоже перевод строки. Наружу строки
 * отдаются LF-канонично: {@link getText} и правки — с `\n`, {@link serialize} —
 * с `eol`.
 *
 * Token caches live outside this class — see DocumentTokenStore.
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

    public constructor(text: string, languageId = "plaintext") {
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

    /**
     * Меняет язык документа. Не трогает `versionId`: смена языка не делает
     * документ dirty (isModified у контроллера сравнивает versionId).
     */
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
     * Длина — через содержимое строки, а не `buffer.getLineLength`: тот спускается
     * по дереву дважды (`getOffsetAt` начала этой и следующей строки) без кэша, а
     * `getLineContent` идёт через кэш поиска узла и последней строки. Проход
     * длин по 200k строк после правок — ~20 мс против ~110 мс; `substring` в
     * V8 — срез без копирования. Длину и содержимое одной строки вью почти
     * всегда просит парой.
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

    /** Переписывает переводы строк буфера, как `setEOL` эталона, — O(n), но только по команде. */
    public setEol(eol: EndOfLine): void {
        if (eol === this.eol) return;
        this.buffer.setEOL(eolToSequence(eol));
        this.onDidChangeEolEmitter.fire();
    }

    /**
     * Заменяет содержимое целиком **в том же документе**: версия растёт,
     * подписчики получают событие контента с `isFlush`, EOL пере-детектится (и
     * объявляется, если сменился). Так перечитка — обычная правка для всех, кто
     * держит документ: view, токены, синхронизация с расширениями.
     */
    public setText(text: string): void {
        const oldEndLine = this.lineCount - 1;
        const eolBefore = this.eol;
        this.innerVersionId++;
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

        // Документный порядок — тот же, что `_sortOpsAscending` буфера: для
        // непересекающихся диапазонов сравнение по началу и по концу совпадает,
        // а равные диапазоны стабильная сортировка оставляет в порядке батча
        // (у буфера — по `sortIndex`). Поэтому обратные правки буфера приходят
        // ровно в этом порядке.
        const docOrder = edits.map((edit) => this.validateEdit(edit)).sort(compareTextEditsInDocumentOrder);
        for (let i = 1; i < docOrder.length; i++) {
            if (comparePositions(docOrder[i].range.start, docOrder[i - 1].range.end) < 0) {
                // Тот же отказ, что у буфера, но до того, как сдвинулись декорации.
                throw new Error("Overlapping ranges are not allowed!");
            }
        }

        this.innerVersionId++;

        // Bottom-up = ровно обратный docOrder, а не отдельная сортировка по
        // убыванию: сортировка стабильна, поэтому правки с СОВПАДАЮЩИМИ
        // диапазонами остались бы в исходном порядке батча и, применённые
        // снизу вверх, склеились бы задом наперёд. Такие правки реальны —
        // обратные правки двух соседних удалений схлопываются в две вставки
        // нулевой ширины в одну точку. Тот же порядок у `_sortOpsDescending`
        // буфера.
        const reversed = [...docOrder].reverse();

        // Декорации двигаются, пока текст ещё старый: смещения внутри
        // заменяемого диапазона меряются по прежнему тексту (как `acceptReplace`
        // дерева декораций эталона внутри `applyEdits`). Снизу вверх, как
        // применяется батч; длины нужны только строк правки до её последней, а
        // их нижние правки не трогают — поэтому все длины берутся из буфера до
        // батча.
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

        // События летят в документном порядке: каждое следующее адресует
        // документ, в котором предыдущие УЖЕ применены (слушатель сдвигает свои
        // позиции по каждому событию последовательно), а границы правки — в
        // координатах, где верхних правок ещё не было. Поэтому границы
        // сдвигаются на накопленную разницу строк уже отправленных событий. Без
        // сдвига слушатель получал номера строк мимо документа:
        // `EditorViewState.remapForDocumentChange` падал на `getLineLength` за
        // концом документа, а уцелевшие позиции проскакивали чужую правку и
        // оставались за концом своей строки.
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

        // Батч целиком — уже после построчных событий. `reversed` — ровно
        // порядок применения (по убыванию, в исходных координатах), как у
        // `pieceTreeTextBuffer._sortOpsDescending` эталона: последовательное
        // применение к копии строк до батча даёт текст после него.
        this.onDidChangeModelContentEmitter.fire({
            changes: reversed.map((edit) => ({ range: edit.range, text: edit.text })),
            versionId: this.innerVersionId,
            eol: this.eol,
            isFlush: false,
        });

        return { appliedVersion: this.innerVersionId, inverseEdits };
    }

    // ─── Private ────────────────────────────────────────────

    /**
     * Правка, приведённая к документу (upstream `validateRange`): края — в
     * пределах строк, переводы строк текста — `\n`. Буфер сам считает `\r` и
     * `\r\n` переводами строк, а события, декорации и зеркало расширений режут
     * текст по `\n` — без нормализации они разошлись бы с буфером.
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

/**
 * Буфер из текста — как `createTextBufferFactory` эталона: билдер с
 * `normalizeEOL`, EOL по умолчанию — LF (пустой файл и файл в одну строку).
 */
function createTextBuffer(text: string): ITextBuffer {
    const builder = new PieceTreeTextBufferBuilder();
    builder.acceptChunk(text);
    const { textBuffer } = builder.finish(true).create(DefaultEndOfLine.LF);
    // Билдер снимает ведущий BOM в отдельное поле (у эталона его снимает
    // чтение файла). Наш декодер BOM уже снял (`encoding.ts`), так что здесь
    // U+FEFF — обычный символ текста: возвращаем его в содержимое.
    if (textBuffer.getBOM() !== "") {
        // Stryker disable next-line BooleanLiteral: ни автопробелы, ни обратная правка здесь не читаются
        textBuffer.applyEdits([toBufferOperation(new Range(1, 1, 1, 1), UTF8_BOM_CHARACTER)], false, false);
    }
    return textBuffer;
}

/**
 * Правка для буфера. `_isTracked` — чтобы буфер не схлопнул батч от 1000
 * правок в одну (`_reduceOperations`): обратные правки и события — правка на
 * правку. `forceMoveMarkers` и `isAutoWhitespaceEdit` буфер только переносит в
 * результат, который мы не читаем.
 */
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

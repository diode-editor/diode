import { Emitter } from "../../../base/common/event.ts";
import { detectEndOfLine, EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import type { IPosition } from "../core/iPosition.ts";
import { comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange, IModelContentChangedEvent } from "./iDocumentContentChange.ts";
import type { IDocumentLanguageChange } from "./iDocumentLanguageChange.ts";
import type { IApplyEditsResult, ITextDocument } from "./iTextDocument.ts";

/**
 * Simple array-backed implementation of ITextDocument.
 * Uses string[] for line storage (Piece Table deferred to future iteration).
 *
 * Token caches live outside this class — see DocumentTokenStore.
 */
export class TextDocument implements ITextDocument {
    private lines: string[];
    private readonly onDidChangeContentEmitter = new Emitter<IDocumentContentChange>();
    public readonly onDidChangeContent = this.onDidChangeContentEmitter.event;
    private readonly onDidChangeModelContentEmitter = new Emitter<IModelContentChangedEvent>();
    public readonly onDidChangeModelContent = this.onDidChangeModelContentEmitter.event;
    private readonly onDidChangeLanguageEmitter = new Emitter<IDocumentLanguageChange>();
    public readonly onDidChangeLanguage = this.onDidChangeLanguageEmitter.event;
    private readonly onDidChangeEolEmitter = new Emitter<void>();
    public readonly onDidChangeEol = this.onDidChangeEolEmitter.event;
    private innerVersionId = 0;
    private eolValue: EndOfLine;
    private languageIdValue: string;

    public constructor(text: string, languageId = "plaintext") {
        this.eolValue = detectEndOfLine(text);
        this.lines = text.split(/\r\n|\n/);
        this.languageIdValue = languageId;
    }

    public get versionId(): number {
        return this.innerVersionId;
    }

    public get eol(): EndOfLine {
        return this.eolValue;
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
        return this.lines.length;
    }

    public getLineContent(lineIndex: number): string {
        this.assertValidLineIndex(lineIndex);
        return this.lines[lineIndex];
    }

    public getLineLength(lineIndex: number): number {
        this.assertValidLineIndex(lineIndex);
        return this.lines[lineIndex].length;
    }

    public getText(): string {
        return this.lines.join("\n");
    }

    public serialize(): string {
        return this.lines.join(eolToSequence(this.eolValue));
    }

    public setEol(eol: EndOfLine): void {
        if (eol === this.eolValue) return;
        this.eolValue = eol;
        this.onDidChangeEolEmitter.fire();
    }

    /**
     * Заменяет содержимое целиком **в том же документе**: версия растёт,
     * подписчики получают событие контента с `isFlush`, EOL пере-детектится (и
     * объявляется, если сменился). Так перечитка — обычная правка для всех, кто
     * держит документ: view, токены, синхронизация с расширениями.
     */
    public setText(text: string): void {
        const oldEndLine = this.lines.length - 1;
        const eolBefore = this.eolValue;
        this.innerVersionId++;
        this.eolValue = detectEndOfLine(text);
        this.lines = text.split(/\r\n|\n/);
        this.fireChange({
            startLine: 0,
            oldEndLine,
            newEndLine: this.lines.length - 1,
            isFlush: true,
        });
        this.onDidChangeModelContentEmitter.fire({
            changes: [],
            versionId: this.innerVersionId,
            eol: this.eolValue,
            isFlush: true,
        });
        if (this.eolValue !== eolBefore) this.onDidChangeEolEmitter.fire();
    }

    public getTextInRange(range: IRange): string {
        const { start, end } = range;
        if (start.line === end.line) {
            return this.lines[start.line].substring(start.character, end.character);
        }
        const result: string[] = [];
        result.push(this.lines[start.line].substring(start.character));
        for (let i = start.line + 1; i < end.line; i++) {
            result.push(this.lines[i]);
        }
        result.push(this.lines[end.line].substring(0, end.character));
        return result.join("\n");
    }

    public applyEdits(edits: readonly ITextEdit[]): IApplyEditsResult {
        if (edits.length === 0) {
            return { appliedVersion: this.innerVersionId, inverseEdits: [] };
        }

        this.innerVersionId++;

        // Sort edits in document order (ascending) to collect old texts
        const docOrder = [...edits].sort((a, b) => {
            const cmp = comparePositions(a.range.start, b.range.start);
            if (cmp !== 0) return cmp;
            return comparePositions(a.range.end, b.range.end);
        });

        // Collect old texts BEFORE applying any edits
        const oldTexts = docOrder.map((edit) => this.getTextInRange(edit.range));

        // Bottom-up = ровно обратный docOrder, а не отдельная сортировка по
        // убыванию: сортировка стабильна, поэтому правки с СОВПАДАЮЩИМИ
        // диапазонами остались бы в исходном порядке батча и, применённые
        // снизу вверх, склеились бы задом наперёд. Такие правки реальны —
        // обратные правки двух соседних удалений схлопываются в две вставки
        // нулевой ширины в одну точку.
        const reversed = [...docOrder].reverse();

        // Apply edits bottom-up (so coordinates of earlier edits stay valid),
        // collect changes, then emit them in document order.
        const changesBottomUp: IDocumentContentChange[] = [];
        for (const edit of reversed) {
            changesBottomUp.push(this.applySingleEdit(edit));
        }

        // Compute inverse edits in new-document coordinates
        const inverseEdits = this.computeInverseEdits(docOrder, oldTexts);

        // Правки применены снизу вверх, а события летят в документном порядке:
        // каждое следующее адресует документ, в котором предыдущие УЖЕ применены
        // (слушатель сдвигает свои позиции по каждому событию последовательно), а
        // посчитано оно было в координатах, где верхних правок ещё не было.
        // Поэтому границы сдвигаются на накопленную разницу строк уже
        // отправленных событий. Без сдвига слушатель получал номера строк
        // мимо документа: `EditorViewState.remapForDocumentChange` падал на
        // `getLineLength` за концом документа, а уцелевшие позиции проскакивали
        // чужую правку и оставались за концом своей строки.
        let lineShift = 0;
        for (let i = changesBottomUp.length - 1; i >= 0; i--) {
            const change = changesBottomUp[i];
            this.fireChange({
                startLine: change.startLine + lineShift,
                oldEndLine: change.oldEndLine + lineShift,
                newEndLine: change.newEndLine + lineShift,
            });
            lineShift += change.newEndLine - change.oldEndLine;
        }

        // Батч целиком — уже после построчных событий. `reversed` — ровно
        // порядок применения (по убыванию, в исходных координатах), как у
        // `pieceTreeTextBuffer._sortOpsDescending` эталона: последовательное
        // применение к копии строк до батча корректно по той же причине, что
        // и наш цикл `applySingleEdit`.
        this.onDidChangeModelContentEmitter.fire({
            changes: reversed.map((edit) => ({ range: edit.range, text: edit.text })),
            versionId: this.innerVersionId,
            eol: this.eolValue,
            isFlush: false,
        });

        return { appliedVersion: this.innerVersionId, inverseEdits };
    }

    /**
     * Строит обратные правки в координатах УЖЕ ПРИМЕНЁННОГО документа.
     *
     * Правки не пересекаются и отсортированы по возрастанию, поэтому каждая
     * следующая начинается не раньше конца предыдущей — и её новую позицию
     * достаточно отмерить ОТ КОНЦА предыдущей правки: `prevOldEnd` в старых
     * координатах, `prevNewEnd` в новых. Попала позиция на ту же старую
     * строку, что и `prevOldEnd`, — она уехала на строку `prevNewEnd.line` со
     * сдвигом колонки (так ловится склейка строк при удалении переводов);
     * попала ниже — сдвигается только номер строки, на накопленную разницу
     * `prevNewEnd.line - prevOldEnd.line`. Оба конца `prevNewEnd` абсолютные,
     * так что разница накопительная и композиция правок получается сама.
     */
    private computeInverseEdits(editsInDocOrder: readonly ITextEdit[], oldTexts: string[]): ITextEdit[] {
        const inverse: ITextEdit[] = [];
        // Конец предыдущей правки в двух системах координат — точка отсчёта
        // для следующей. До первой правки координаты совпадают.
        let prev: { readonly oldEnd: IPosition; readonly newEnd: IPosition } | null = null;

        for (let i = 0; i < editsInDocOrder.length; i++) {
            const edit = editsInDocOrder[i];
            const start = edit.range.start;

            let newStartLine: number;
            let newStartChar: number;
            if (prev === null) {
                newStartLine = start.line;
                newStartChar = start.character;
            } else if (start.line === prev.oldEnd.line) {
                newStartLine = prev.newEnd.line;
                newStartChar = prev.newEnd.character + (start.character - prev.oldEnd.character);
            } else {
                newStartLine = start.line + (prev.newEnd.line - prev.oldEnd.line);
                newStartChar = start.character;
            }

            // Конец вставленного текста в новых координатах.
            const insertedLines = edit.text.split("\n");
            const lastInserted = insertedLines[insertedLines.length - 1];
            const newEndLine = newStartLine + insertedLines.length - 1;
            const newEndChar = insertedLines.length === 1 ? newStartChar + lastInserted.length : lastInserted.length;

            // Обратная правка возвращает старый текст на место вставленного.
            inverse.push(createTextEdit(createRange(newStartLine, newStartChar, newEndLine, newEndChar), oldTexts[i]));

            prev = { oldEnd: edit.range.end, newEnd: { line: newEndLine, character: newEndChar } };
        }

        return inverse;
    }

    // ─── Private ────────────────────────────────────────────

    private applySingleEdit(edit: ITextEdit): IDocumentContentChange {
        const { range, text } = edit;
        const { start, end } = range;

        const startLine = start.line;
        const endLine = end.line;
        const startChar = start.character;
        const endChar = end.character;

        // Build the resulting text from prefix + inserted text + suffix
        const prefix = this.lines[startLine].substring(0, startChar);
        const suffix = this.lines[endLine].substring(endChar);
        const insertedText = prefix + text + suffix;
        const newLines = insertedText.split("\n");

        // How many lines we delete vs insert
        const deletedLineCount = endLine - startLine + 1;
        const insertedLineCount = newLines.length;

        this.lines.splice(startLine, deletedLineCount, ...newLines);

        return {
            startLine,
            oldEndLine: endLine,
            newEndLine: startLine + insertedLineCount - 1,
        };
    }

    private fireChange(change: IDocumentContentChange): void {
        this.onDidChangeContentEmitter.fire(change);
    }

    private assertValidLineIndex(lineIndex: number): void {
        if (lineIndex < 0 || lineIndex >= this.lines.length) {
            throw new RangeError(
                `Line index ${lineIndex.toString()} out of bounds [0, ${(this.lines.length - 1).toString()}]`,
            );
        }
    }
}

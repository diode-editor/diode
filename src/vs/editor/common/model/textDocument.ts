import type { IDisposable } from "@tuidom/all/common/disposable";
import { detectEndOfLine, EndOfLine, eolToSequence } from "../core/endOfLine.ts";
import { comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import type { IDocumentContentChange } from "./iDocumentContentChange.ts";
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
    private contentChangeListeners: ((change: IDocumentContentChange) => void)[] = [];
    private languageChangeListeners: ((change: IDocumentLanguageChange) => void)[] = [];
    private eolChangeListeners: (() => void)[] = [];
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
        for (const listener of this.languageChangeListeners) {
            listener({ oldLanguageId, newLanguageId: languageId });
        }
    }

    public onDidChangeLanguage(listener: (change: IDocumentLanguageChange) => void): IDisposable {
        this.languageChangeListeners.push(listener);
        return {
            dispose: () => {
                const i = this.languageChangeListeners.indexOf(listener);
                if (i >= 0) this.languageChangeListeners.splice(i, 1);
            },
        };
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
        for (const listener of [...this.eolChangeListeners]) listener();
    }

    public onDidChangeEol(listener: () => void): IDisposable {
        this.eolChangeListeners.push(listener);
        return {
            dispose: () => {
                const i = this.eolChangeListeners.indexOf(listener);
                if (i >= 0) this.eolChangeListeners.splice(i, 1);
            },
        };
    }

    public setText(text: string): void {
        const oldEndLine = this.lines.length - 1;
        this.innerVersionId++;
        this.eolValue = detectEndOfLine(text);
        this.lines = text.split(/\r\n|\n/);
        this.fireChange({
            startLine: 0,
            oldEndLine,
            newEndLine: this.lines.length - 1,
        });
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

    public onDidChangeContent(listener: (change: IDocumentContentChange) => void): IDisposable {
        this.contentChangeListeners.push(listener);
        return {
            dispose: () => {
                const i = this.contentChangeListeners.indexOf(listener);
                if (i >= 0) this.contentChangeListeners.splice(i, 1);
            },
        };
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

        // Sort edits in reverse document order for safe application
        const reversed = [...edits].sort((a, b) => {
            const cmp = comparePositions(b.range.start, a.range.start);
            if (cmp !== 0) return cmp;
            return comparePositions(b.range.end, a.range.end);
        });

        // Apply edits bottom-up (so coordinates of earlier edits stay valid),
        // collect changes, then emit them in document order.
        const changesBottomUp: IDocumentContentChange[] = [];
        for (const edit of reversed) {
            changesBottomUp.push(this.applySingleEdit(edit));
        }

        // Compute inverse edits in new-document coordinates
        const inverseEdits = this.computeInverseEdits(docOrder, oldTexts);

        for (let i = changesBottomUp.length - 1; i >= 0; i--) {
            this.fireChange(changesBottomUp[i]);
        }

        return { appliedVersion: this.innerVersionId, inverseEdits };
    }

    private computeInverseEdits(editsInDocOrder: readonly ITextEdit[], oldTexts: string[]): ITextEdit[] {
        const inverse: ITextEdit[] = [];
        let accLineDelta = 0;
        let accCharDelta = 0;
        let lastEditLine = -1;

        for (let i = 0; i < editsInDocOrder.length; i++) {
            const edit = editsInDocOrder[i];
            const oldText = oldTexts[i];

            // Compute the new start position (where this edit landed in the new document)
            const newStartLine = edit.range.start.line + accLineDelta;
            const newStartChar =
                edit.range.start.line === lastEditLine
                    ? edit.range.start.character + accCharDelta
                    : edit.range.start.character;

            // Compute the new end position based on the inserted text dimensions
            const insertedLines = edit.text.split("\n");
            const insertedLineCount = insertedLines.length;
            let newEndLine: number;
            let newEndChar: number;

            if (insertedLineCount === 1) {
                newEndLine = newStartLine;
                newEndChar = newStartChar + insertedLines[0].length;
            } else {
                newEndLine = newStartLine + insertedLineCount - 1;
                newEndChar = insertedLines[insertedLineCount - 1].length;
            }

            // The inverse edit replaces the inserted text range with the old text
            inverse.push(createTextEdit(createRange(newStartLine, newStartChar, newEndLine, newEndChar), oldText));

            // Update accumulated deltas
            const deletedLines = edit.range.end.line - edit.range.start.line;
            const lineDelta = insertedLineCount - 1 - deletedLines;
            accLineDelta += lineDelta;

            if (insertedLineCount === 1 && deletedLines === 0) {
                const charDelta = insertedLines[0].length - (edit.range.end.character - edit.range.start.character);
                if (edit.range.start.line === lastEditLine) {
                    accCharDelta += charDelta;
                } else {
                    accCharDelta = charDelta;
                }
                lastEditLine = edit.range.start.line;
            } else {
                accCharDelta = 0;
                lastEditLine = -1;
            }
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
        for (const listener of this.contentChangeListeners) listener(change);
    }

    private assertValidLineIndex(lineIndex: number): void {
        if (lineIndex < 0 || lineIndex >= this.lines.length) {
            throw new RangeError(
                `Line index ${lineIndex.toString()} out of bounds [0, ${(this.lines.length - 1).toString()}]`,
            );
        }
    }
}

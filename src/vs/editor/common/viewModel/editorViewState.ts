import { DisplayLine } from "../../../../../tuidom/common/displayLine.ts";
import type { IDisposable } from "../../../../../tuidom/common/disposable.ts";
import { STOP_RENDERING_LINE_AFTER } from "../../../../../tuidom/common/textLimits.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type { IPosition } from "../core/iPosition.ts";
import { comparePositions } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import {
    createCursorSelection,
    createSelection,
    getIdealColumn,
    isSelectionCollapsed,
    selectionToRange,
} from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { charClass } from "../core/wordClassification.ts";
import { computeNewLinePlan } from "../languages/autoIndent.ts";
import type { ILineTokens } from "../languages/iLineTokens.ts";
import { detectIndentation } from "../model/indentationDetector.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";
import type { IUndoElement } from "../model/iUndoElement.ts";
import type { DocumentTokenStore } from "../tokens/documentTokenStore.ts";

/**
 * Represents the view state for one editor pane.
 * Multiple EditorViewStates can reference the same ITextDocument (split view).
 *
 * Acts as a "lens" (projection) through which the renderer sees the TextDocument:
 * logical lines may differ from visual lines due to code folding.
 */
export class EditorViewState {
    public scrollLeft = 0;
    public scrollTop = 0;
    public viewportWidth = 80;
    public viewportHeight = 24;
    /**
     * Minimum number of lines to keep visible between the primary cursor and the
     * top/bottom edge of the viewport when scrolling it into view (VS Code's
     * `editor.cursorSurroundingLines`). `0` glues the cursor to the very edge.
     */
    public cursorSurroundingLines = 0;
    public tabSize = 4;
    public insertSpaces = false;
    public detectIndentation = true;
    /**
     * Запрещает правку документа через этот view-state (VS Code
     * `EditorOption.readOnly`). Живёт здесь, а не на `EditorElement`, потому что
     * все мутации идут через эту точку — клавиатура и paste, accept completion,
     * rename/bulkEdit и `editor.applyEdit` из расширений. Мутаторы становятся
     * no-op и возвращают `undefined`, как `CodeEditorWidget.executeEdits`
     * возвращает `false` в VS Code.
     *
     * Не трогает view-состояние: курсор, выделение, скролл и фолдинг в read-only
     * работают — как и в VS Code.
     */
    public readOnly = false;
    private selectionsValue!: ISelection[];
    private cursorChangeListeners: (() => void)[] = [];
    /** Ranges of all current search matches to highlight (set by the find controller). */
    public searchMatches: IRange[] = [];
    /** Index into {@link searchMatches} of the active match, or -1 when there is none. */
    public currentSearchMatchIndex = -1;
    public readonly document: ITextDocument;
    public foldedRegions: IFoldingRegion[] = [];
    /**
     * Optional per-document token cache. The renderer is responsible for
     * calling `tokenStore.tokenizeUpTo(visibleBottom)` before reading tokens.
     */
    public tokenStore: DocumentTokenStore | undefined;

    private visibleLinesCache: number[] | null = null;
    private visibleLinesCacheDocVersion = -1;
    private foldsVersion = 0;
    private visibleLinesCacheFoldsVersion = -1;

    public constructor(document: ITextDocument, selections?: ISelection[]) {
        this.document = document;
        this.selections = selections && selections.length > 0 ? selections : [createCursorSelection(0, 0)];
        this.runDetectIndentation();
    }

    /**
     * Единая точка построения {@link DisplayLine} для строк документа — с
     * порогом {@link STOP_RENDERING_LINE_AFTER}. За порогом разбирается только
     * префикс, поэтому экстремально длинная строка перестаёт быть O(длины) на
     * любом пути (рендер, каретка, навигация по словам, hit-test). Виджеты вне
     * редактора строят `DisplayLine` без порога — их короткие строки этого не
     * требуют.
     */
    public displayLineFor(lineContent: string): DisplayLine {
        return new DisplayLine(lineContent, this.tabSize, STOP_RENDERING_LINE_AFTER);
    }

    /**
     * Primary cursor/selection list. Assigning a new array notifies
     * cursor-change listeners (used e.g. by the status bar Ln/Col indicator).
     * In-place mutation of the returned array does NOT fire the event.
     */
    public get selections(): ISelection[] {
        return this.selectionsValue;
    }

    public set selections(value: ISelection[]) {
        this.selectionsValue = value;
        this.fireCursorChange();
    }

    /**
     * Subscribes to cursor/selection changes. Fires whenever `selections` is
     * reassigned — cursor movement, typing, deletion, mouse, undo/redo.
     */
    public onDidChangeCursorPosition(listener: () => void): IDisposable {
        this.cursorChangeListeners.push(listener);
        return {
            dispose: () => {
                const i = this.cursorChangeListeners.indexOf(listener);
                if (i >= 0) this.cursorChangeListeners.splice(i, 1);
            },
        };
    }

    private fireCursorChange(): void {
        for (const listener of [...this.cursorChangeListeners]) {
            listener();
        }
    }

    /**
     * Re-runs indentation detection against the current document content.
     * No-op if `detectIndentation` is false or the document has no indented lines.
     */
    public runDetectIndentation(): void {
        if (!this.detectIndentation) return;
        const result = detectIndentation(this.document);
        if (result !== null) {
            this.insertSpaces = result.insertSpaces;
            this.tabSize = result.tabSize;
        }
    }

    // ─── Folding API ────────────────────────────────────────

    /**
     * Replaces the entire folding regions array.
     * Useful for external folding providers.
     */
    public setFoldingRegions(regions: IFoldingRegion[]): void {
        this.foldedRegions = regions;
        this.foldsVersion++;
    }

    /**
     * Toggles the collapsed state of the folding region whose startLine matches the given line.
     * No-op if no region starts at that line.
     */
    public toggleFold(line: number): void {
        for (const region of this.foldedRegions) {
            if (region.startLine === line) {
                region.isCollapsed = !region.isCollapsed;
                this.foldsVersion++;
                this.reconcileHiddenCursors();
                return;
            }
        }
    }

    /**
     * Returns the innermost region covering `line` (header line included) that
     * satisfies `accept`, or `undefined`. "Innermost" = the candidate with the
     * greatest `startLine`.
     */
    private innermostRegionContaining(
        line: number,
        accept: (region: IFoldingRegion) => boolean,
    ): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            const covers = region.startLine <= line && line <= region.endLine && accept(region);
            if (covers && (best === undefined || region.startLine > best.startLine)) {
                best = region;
            }
        }
        return best;
    }

    /**
     * Returns the innermost folding region that spans `line` (header line
     * included), or `undefined` when no region covers it.
     */
    public foldingRegionContaining(line: number): IFoldingRegion | undefined {
        return this.innermostRegionContaining(line, () => true);
    }

    /**
     * Collapses the innermost expanded region covering `line`. Repeated calls
     * fold outward (each pass collapses the next enclosing region). No-op when
     * no expanded region covers the line.
     */
    public foldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => !region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = true;
            this.foldsVersion++;
            this.reconcileHiddenCursors();
        }
    }

    /**
     * Expands the innermost collapsed region covering `line`. No-op when no
     * collapsed region covers the line.
     */
    public unfoldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = false;
            this.foldsVersion++;
        }
    }

    /**
     * Toggles the collapsed state of the innermost region covering `line`.
     * No-op when no region covers the line.
     */
    public toggleFoldContaining(line: number): void {
        const region = this.foldingRegionContaining(line);
        if (region !== undefined) {
            region.isCollapsed = !region.isCollapsed;
            this.foldsVersion++;
            this.reconcileHiddenCursors();
        }
    }

    /**
     * Collapses all folding regions.
     */
    public foldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = true;
        }
        this.foldsVersion++;
        this.reconcileHiddenCursors();
    }

    /**
     * Expands all folding regions.
     */
    public unfoldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = false;
        }
        this.foldsVersion++;
    }

    /**
     * Collapses the innermost region at `line` together with every region nested
     * inside it (VS Code's "Fold Recursively").
     */
    public foldRecursively(line: number): void {
        this.setCollapsedRecursively(line, true);
    }

    /**
     * Expands the innermost region at `line` together with every region nested
     * inside it (VS Code's "Unfold Recursively").
     */
    public unfoldRecursively(line: number): void {
        this.setCollapsedRecursively(line, false);
    }

    private setCollapsedRecursively(line: number, collapsed: boolean): void {
        const root = this.foldingRegionContaining(line);
        if (root === undefined) return;
        for (const region of this.foldedRegions) {
            if (region.startLine >= root.startLine && region.endLine <= root.endLine) {
                region.isCollapsed = collapsed;
            }
        }
        this.foldsVersion++;
        if (collapsed) this.reconcileHiddenCursors();
    }

    /**
     * Folds every region at nesting level ≥ `level` and unfolds the rest, showing
     * the document structure down to that level (VS Code's "Fold Level N").
     */
    public foldLevel(level: number): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = this.regionNestingLevel(region) >= level;
        }
        this.foldsVersion++;
        this.reconcileHiddenCursors();
    }

    /** 1-based nesting depth: 1 for an outermost region, +1 per enclosing region. */
    private regionNestingLevel(region: IFoldingRegion): number {
        let level = 1;
        for (const other of this.foldedRegions) {
            if (other === region) continue;
            if (other.startLine <= region.startLine && region.endLine <= other.endLine) {
                level++;
            }
        }
        return level;
    }

    /**
     * Moves the caret to the header of the next foldable region below `line`,
     * revealing it if hidden. No-op when there is no later region.
     */
    public gotoNextFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine > line && (target === undefined || region.startLine < target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    /**
     * Moves the caret to the header of the previous foldable region above `line`.
     * No-op when there is no earlier region.
     */
    public gotoPreviousFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine < line && (target === undefined || region.startLine > target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    /**
     * The collapsed region hiding `line` with the smallest `startLine` — the
     * outermost one, whose header line is always visible. `undefined` if `line`
     * is not hidden by any collapsed region.
     */
    private outermostCollapsedRegionHiding(line: number): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && region.startLine < line && line <= region.endLine) {
                if (best === undefined || region.startLine < best.startLine) best = region;
            }
        }
        return best;
    }

    /**
     * After a fold operation hides a cursor, moves it onto the header of the
     * region that hides it (VS Code snaps the caret to the fold header rather
     * than stranding it on an invisible line). No-op for cursors still visible.
     */
    private reconcileHiddenCursors(): void {
        const previous = this.selections;
        this.selections = previous.map((sel) => {
            if (this.logicalToVisualLine(sel.active.line) >= 0) return sel;
            const region = this.outermostCollapsedRegionHiding(sel.active.line);
            /* v8 ignore start -- defensive: fold ops only hide valid document lines, which are always inside a collapsed region here */
            if (region === undefined) return sel;
            /* v8 ignore stop */
            const char = Math.min(sel.active.character, this.document.getLineLength(region.startLine));
            return createCursorSelection(region.startLine, char);
        });
        const changed = this.selections.some((sel, i) => sel !== previous[i]);
        if (changed) {
            this.normalizeSelections();
            this.ensureCursorVisible();
        }
    }

    // ─── Scroll API ─────────────────────────────────────────

    public scrollLineUp(): void {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
    }

    public scrollLineDown(): void {
        const maxScrollTop = Math.max(0, this.getViewLineCount() - this.viewportHeight);
        this.scrollTop = Math.min(maxScrollTop, this.scrollTop + 1);
    }

    // ─── View API (projection for renderer) ─────────────────

    /**
     * Returns the number of visible lines (accounting for collapsed regions).
     */
    public getViewLineCount(): number {
        return this.buildVisibleLines().length;
    }

    /**
     * Returns the text content of a visual line.
     * The visualLineNumber is 0-based index into the visible lines array.
     */
    public getViewLine(visualLineNumber: number): string {
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return "";
        }
        return this.document.getLineContent(logicalLine);
    }

    /**
     * Returns tokens for a visual line (from the attached token store, if any).
     * Does NOT trigger lazy tokenization — the renderer must call
     * `tokenStore.tokenizeUpTo(...)` first.
     */
    public getViewLineTokens(visualLineNumber: number): ILineTokens | undefined {
        if (!this.tokenStore) return undefined;
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return undefined;
        }
        return this.tokenStore.getLineTokens(logicalLine);
    }

    // ─── Line Mapping ───────────────────────────────────────

    /**
     * Translates a logical (document) line number to a visual (screen) line number.
     * Returns -1 if the line is hidden inside a collapsed region.
     */
    public logicalToVisualLine(logicalLine: number): number {
        const visible = this.buildVisibleLines();
        const idx = visible.indexOf(logicalLine);
        return idx;
    }

    /**
     * Translates a visual (screen) line number to a logical (document) line number.
     * Returns -1 if the visual line is out of range.
     */
    public visualToLogicalLine(visualLine: number): number {
        const visible = this.buildVisibleLines();
        if (visualLine < 0 || visualLine >= visible.length) {
            return -1;
        }
        return visible[visualLine];
    }

    /**
     * Returns the text covered by the primary (first) selection.
     * Returns an empty string when the selection is collapsed (cursor only).
     */
    public getSelectedText(): string {
        const sel = this.selections[0];
        if (isSelectionCollapsed(sel)) {
            return "";
        }
        return this.document.getTextInRange(selectionToRange(sel));
    }

    /**
     * Inserts text at every cursor/selection, replacing any selected content.
     * Delegates to type() which already handles selection replacement.
     */
    public insertText(text: string): IUndoElement | undefined {
        return this.type(text);
    }

    /**
     * Types text at every cursor/selection.
     * If a selection is non-collapsed, the selected text is replaced.
     */
    public type(text: string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const edits = this.buildEditsFromSelections(text);
        const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.computeSelectionsAfterEdits(edits);
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Applies an arbitrary batch of edits as a single undoable operation.
     *
     * Unlike {@link type}, the edits are supplied by the caller instead of
     * being derived from the current selections — used by external/programmatic
     * edits (e.g. trim-trailing-whitespace, save participants). Returns an
     * {@link IUndoElement} to push onto the undo stack, or `undefined` when
     * there is nothing to apply.
     */
    public applyEdits(edits: readonly ITextEdit[], label: string): IUndoElement | undefined {
        if (this.readOnly || edits.length === 0) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.computeSelectionsAfterEdits(edits);
        this.ensureCursorVisible();
        return {
            label,
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Inserts a newline at every cursor, carrying over the current line's
     * indentation (and expanding bracket pairs). See {@link computeNewLinePlan}.
     */
    public insertNewLine(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();
        const plans = sorted.map((sel) => {
            const range = selectionToRange(sel);
            return computeNewLinePlan({
                lineContent: this.document.getLineContent(range.start.line),
                column: range.start.character,
                tabSize: this.tabSize,
                insertSpaces: this.insertSpaces,
            });
        });
        const edits = sorted.map((sel, i) => createTextEdit(selectionToRange(sel), plans[i].editText));
        const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // computeSelectionsAfterEdits lands the cursor at the end of the inserted
        // text. For a block expansion the closer occupies the last inserted line,
        // so move that cursor up one line onto the empty middle line.
        this.selections = this.computeSelectionsAfterEdits(edits).map((sel, i) =>
            plans[i].blockExpand ? createCursorSelection(sel.active.line - 1, plans[i].cursorColumn) : sel,
        );
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Deletes one character to the left of each cursor, or deletes the selection.
     */
    public deleteLeft(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                // Collapsed: expand one grapheme left
                const pos = sel.active;
                if (pos.character > 0) {
                    const lineContent = this.document.getLineContent(pos.line);
                    const dl = this.displayLineFor(lineContent);
                    let prevOffset: number;
                    if (pos.character >= lineContent.length) {
                        /* v8 ignore start -- the `: 0` arm is unreachable: this branch needs pos.character > 0 AND >= line length, so the line is non-empty and always has slots */
                        prevOffset = dl.slots.length > 0 ? dl.slots[dl.slots.length - 1].offset : 0;
                        /* v8 ignore stop */
                    } else {
                        const slotIndex = dl.slotIndexAtOffset(pos.character);
                        prevOffset = slotIndex > 0 ? dl.slots[slotIndex - 1].offset : 0;
                    }
                    edits.push(createTextEdit(createRange(pos.line, prevOffset, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteLeft",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    // ─── Cursor Navigation ───────────────────────────────────

    /**
     * Moves each cursor one character to the left.
     * At the start of a line, wraps to the end of the previous visible line.
     * Updates idealColumn to the new activeColumn.
     */
    public cursorLeft(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            let newLine = pos.line;
            let newChar: number;

            if (pos.character > 0) {
                const lineContent = this.document.getLineContent(pos.line);
                const dl = this.displayLineFor(lineContent);
                if (pos.character >= lineContent.length) {
                    /* v8 ignore start -- the `: 0` arm is unreachable: this branch needs pos.character > 0 AND >= line length, so the line is non-empty and always has slots */
                    newChar = dl.slots.length > 0 ? dl.slots[dl.slots.length - 1].offset : 0;
                    /* v8 ignore stop */
                } else {
                    const slotIndex = dl.slotIndexAtOffset(pos.character);
                    newChar = slotIndex > 0 ? dl.slots[slotIndex - 1].offset : 0;
                }
            } else if (pos.line > 0) {
                const prevVisible = this.previousVisibleLine(pos.line);
                /* v8 ignore start -- the else is unreachable: line 0 is always visible, so previousVisibleLine never returns -1 for a line>0 cursor */
                if (prevVisible >= 0) {
                    newLine = prevVisible;
                    newChar = this.document.getLineLength(prevVisible);
                } else {
                    return sel;
                }
                /* v8 ignore stop */
            } else {
                return sel;
            }

            const targetDl = this.displayLineFor(this.document.getLineContent(newLine));
            return this.buildSelection(sel, newLine, newChar, targetDl.offsetToColumn(newChar), inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one character to the right.
     * At the end of a line, wraps to the start of the next visible line.
     * Updates idealColumn to the new activeColumn.
     */
    public cursorRight(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const lineLen = this.document.getLineLength(pos.line);
            let newLine = pos.line;
            let newChar: number;

            if (pos.character < lineLen) {
                const lineContent = this.document.getLineContent(pos.line);
                const dl = this.displayLineFor(lineContent);
                const slotIndex = dl.slotIndexAtOffset(pos.character);
                if (slotIndex >= 0 && slotIndex < dl.slots.length - 1) {
                    newChar = dl.slots[slotIndex + 1].offset;
                } else {
                    newChar = lineLen;
                }
            } else {
                const nextVisible = this.nextVisibleLine(pos.line);
                if (nextVisible >= 0) {
                    newLine = nextVisible;
                    newChar = 0;
                } else {
                    return sel;
                }
            }

            const targetDl = this.displayLineFor(this.document.getLineContent(newLine));
            return this.buildSelection(sel, newLine, newChar, targetDl.offsetToColumn(newChar), inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one visual line up.
     * Skips over collapsed folding regions.
     * Does NOT change idealColumn — vertical navigation preserves it.
     */
    public cursorUp(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const prevVisible = this.previousVisibleLine(pos.line);
            if (prevVisible >= 0) {
                let ideal = getIdealColumn(sel);
                if (sel.idealColumn === undefined) {
                    const currentDl = this.displayLineFor(this.document.getLineContent(pos.line));
                    ideal = currentDl.offsetToColumn(pos.character);
                }
                const targetDl = this.displayLineFor(this.document.getLineContent(prevVisible));
                const newChar = targetDl.columnToOffset(ideal);
                return this.buildSelection(sel, prevVisible, newChar, ideal, inSelectionMode);
            }
            return sel;
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one visual line down.
     * Skips over collapsed folding regions.
     * Does NOT change idealColumn — vertical navigation preserves it.
     */
    public cursorDown(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const nextVisible = this.nextVisibleLine(pos.line);
            if (nextVisible >= 0) {
                let ideal = getIdealColumn(sel);
                if (sel.idealColumn === undefined) {
                    const currentDl = this.displayLineFor(this.document.getLineContent(pos.line));
                    ideal = currentDl.offsetToColumn(pos.character);
                }
                const targetDl = this.displayLineFor(this.document.getLineContent(nextVisible));
                const newChar = targetDl.columnToOffset(ideal);
                return this.buildSelection(sel, nextVisible, newChar, ideal, inSelectionMode);
            }
            return sel;
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the very beginning of the document (line 0, char 0).
     */
    public cursorTop(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, 0, 0, 0, inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the very end of the document (last line, last char).
     */
    public cursorBottom(inSelectionMode = false): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        const dl = this.displayLineFor(this.document.getLineContent(lastLine));
        const idealCol = dl.offsetToColumn(lastChar);
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, lastLine, lastChar, idealCol, inSelectionMode);
        });
        this.normalizeSelections();
        this.reconcileHiddenCursors();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the "smart home" position of its line, VS Code style:
     * first press lands on the first non-whitespace character (after the indent),
     * a second press (when already there) collapses to column 0, toggling between
     * the two. Lines with no indentation always go to column 0.
     * idealColumn tracks the display column of the target so Up/Down stays aligned
     * even with tabs.
     */
    public cursorHome(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const content = this.document.getLineContent(sel.active.line);
            const firstNonWs = firstNonWhitespaceIndex(content);
            const target = sel.active.character === firstNonWs && firstNonWs !== 0 ? 0 : firstNonWs;
            const idealCol = this.displayLineFor(content).offsetToColumn(target);
            return this.buildSelection(sel, sel.active.line, target, idealCol, inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the end of its line.
     * Sets idealColumn to MAX_SAFE_INTEGER so subsequent Up/Down "stick" to the right edge.
     */
    public cursorEnd(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const lineLen = this.document.getLineLength(sel.active.line);
            return this.buildSelection(sel, sel.active.line, lineLen, Number.MAX_SAFE_INTEGER, inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one word to the left.
     * At the start of a line, wraps to the end of the previous visible line.
     */
    public cursorWordLeft(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            if (pos.character === 0) {
                const prevLine = this.previousVisibleLine(pos.line);
                if (prevLine >= 0) {
                    const lineLen = this.document.getLineLength(prevLine);
                    const dl = this.displayLineFor(this.document.getLineContent(prevLine));
                    return this.buildSelection(sel, prevLine, lineLen, dl.offsetToColumn(lineLen), inSelectionMode);
                }
                return sel;
            }
            const line = this.document.getLineContent(pos.line);
            const newChar = findWordBoundaryLeft(line, pos.character);
            const dl = this.displayLineFor(line);
            return this.buildSelection(sel, pos.line, newChar, dl.offsetToColumn(newChar), inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one word to the right.
     * At the end of a line, wraps to the start of the next visible line.
     */
    public cursorWordRight(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const lineLen = this.document.getLineLength(pos.line);
            if (pos.character >= lineLen) {
                const nextLine = this.nextVisibleLine(pos.line);
                if (nextLine >= 0) {
                    return this.buildSelection(sel, nextLine, 0, 0, inSelectionMode);
                }
                return sel;
            }
            const line = this.document.getLineContent(pos.line);
            const newChar = findWordBoundaryRight(line, pos.character);
            const dl = this.displayLineFor(line);
            return this.buildSelection(sel, pos.line, newChar, dl.offsetToColumn(newChar), inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Selects the entire document content.
     */
    public selectAll(): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        this.selections = [createSelection(0, 0, lastLine, lastChar)];
    }

    /**
     * Moves each cursor one page (viewportHeight lines) down.
     * Preserves idealColumn for vertical navigation.
     */
    public cursorPageDown(inSelectionMode = false): void {
        const pageSize = Math.max(1, this.viewportHeight - 1);
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            let ideal = getIdealColumn(sel);
            if (sel.idealColumn === undefined) {
                const currentDl = this.displayLineFor(this.document.getLineContent(pos.line));
                ideal = currentDl.offsetToColumn(pos.character);
            }
            let targetLine = pos.line;
            for (let i = 0; i < pageSize; i++) {
                const next = this.nextVisibleLine(targetLine);
                if (next < 0) break;
                targetLine = next;
            }
            const targetDl = this.displayLineFor(this.document.getLineContent(targetLine));
            const newChar = targetDl.columnToOffset(ideal);
            return this.buildSelection(sel, targetLine, newChar, ideal, inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one page (viewportHeight lines) up.
     * Preserves idealColumn for vertical navigation.
     */
    public cursorPageUp(inSelectionMode = false): void {
        const pageSize = Math.max(1, this.viewportHeight - 1);
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            let ideal = getIdealColumn(sel);
            if (sel.idealColumn === undefined) {
                const currentDl = this.displayLineFor(this.document.getLineContent(pos.line));
                ideal = currentDl.offsetToColumn(pos.character);
            }
            let targetLine = pos.line;
            for (let i = 0; i < pageSize; i++) {
                const prev = this.previousVisibleLine(targetLine);
                if (prev < 0) break;
                targetLine = prev;
            }
            const targetDl = this.displayLineFor(this.document.getLineContent(targetLine));
            const newChar = targetDl.columnToOffset(ideal);
            return this.buildSelection(sel, targetLine, newChar, ideal, inSelectionMode);
        });
        this.normalizeSelections();
        this.ensureCursorVisible();
    }

    /**
     * Deletes one character to the right of each cursor, or deletes the selection.
     */
    public deleteRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                // Collapsed: expand one grapheme right
                const pos = sel.active;
                const lineLen = this.document.getLineLength(pos.line);
                if (pos.character < lineLen) {
                    const lineContent = this.document.getLineContent(pos.line);
                    const dl = this.displayLineFor(lineContent);
                    const slotIndex = dl.slotIndexAtOffset(pos.character);
                    let nextEnd: number;
                    /* v8 ignore start -- the else is unreachable: Segmenter slots contiguously cover the line, so every in-range offset maps to a slot */
                    if (slotIndex >= 0) {
                        const slot = dl.slots[slotIndex];
                        nextEnd = slot.offset + slot.length;
                    } else {
                        nextEnd = Math.min(pos.character + 1, lineLen);
                    }
                    /* v8 ignore stop */
                    edits.push(createTextEdit(createRange(pos.line, pos.character, pos.line, nextEnd), ""));
                } else if (pos.line < this.document.lineCount - 1) {
                    edits.push(createTextEdit(createRange(pos.line, lineLen, pos.line + 1, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    /**
     * Deletes one word to the left of each cursor, or deletes the selection.
     */
    public deleteWordLeft(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                if (pos.character > 0) {
                    const line = this.document.getLineContent(pos.line);
                    const wordStart = findWordBoundaryLeft(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, wordStart, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteWordLeft",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    /**
     * Deletes one word to the right of each cursor, or deletes the selection.
     */
    public deleteWordRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                const lineLen = this.document.getLineLength(pos.line);
                if (pos.character < lineLen) {
                    const line = this.document.getLineContent(pos.line);
                    const wordEnd = findWordBoundaryRight(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, pos.character, pos.line, wordEnd), ""));
                } else if (pos.line < this.document.lineCount - 1) {
                    edits.push(createTextEdit(createRange(pos.line, lineLen, pos.line + 1, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteWordRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    // ─── Indentation ────────────────────────────────────────

    /**
     * Increases the indentation of the current selections (Tab).
     *
     * With a collapsed cursor or a single-line selection this inserts one
     * indent unit at the cursor (replacing the selection) — identical to typing.
     * With a selection spanning multiple lines it prepends one indent unit to
     * every touched line and keeps the selection covering them.
     */
    public indentLines(): IUndoElement | undefined {
        const spansMultipleLines = this.selections.some((sel) => {
            const range = selectionToRange(sel);
            return range.start.line !== range.end.line;
        });
        if (!spansMultipleLines) {
            return this.type(this.indentUnit());
        }
        return this.shiftIndent(1);
    }

    /**
     * Decreases the indentation of every line touched by a selection (Shift+Tab),
     * removing up to one indent level of leading whitespace from each. Operates
     * on the cursor's line when the selection is collapsed. Returns `undefined`
     * when no line has leading whitespace to remove.
     */
    public outdentLines(): IUndoElement | undefined {
        return this.shiftIndent(-1);
    }

    private indentUnit(): string {
        return this.insertSpaces ? " ".repeat(this.tabSize) : "\t";
    }

    /**
     * Shifts the leading indentation of the touched lines one level in the given
     * direction (+1 indent, −1 outdent), applying the edits as a single undoable
     * operation and remapping the selections to follow the shifted text.
     */
    private shiftIndent(direction: 1 | -1): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const unit = this.indentUnit();
        const perLine = new Map<number, number>();
        const edits: ITextEdit[] = [];
        for (const line of this.collectTouchedLines()) {
            if (direction === 1) {
                edits.push(createTextEdit(createRange(line, 0, line, 0), unit));
                perLine.set(line, unit.length);
            } else {
                const removed = computeOutdentRemoval(this.document.getLineContent(line), this.tabSize);
                if (removed > 0) {
                    edits.push(createTextEdit(createRange(line, 0, line, removed), ""));
                    perLine.set(line, -removed);
                }
            }
        }

        if (edits.length === 0) return undefined;

        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.document.applyEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selections.map((sel) => this.remapSelectionForIndent(sel, perLine));
        this.ensureCursorVisible();
        return {
            label: direction === 1 ? "indent" : "outdent",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Collects the logical lines touched by any selection, in ascending order.
     * A selection whose end sits at column 0 of a later line does not pull that
     * trailing line in (matches VS Code — the empty tail is excluded).
     */
    private collectTouchedLines(): number[] {
        const lines = new Set<number>();
        for (const sel of this.selections) {
            const range = selectionToRange(sel);
            let endLine = range.end.line;
            if (endLine > range.start.line && range.end.character === 0) {
                endLine--;
            }
            for (let line = range.start.line; line <= endLine; line++) {
                lines.add(line);
            }
        }
        return [...lines].sort((a, b) => a - b);
    }

    /**
     * Remaps a selection after an indent/outdent, shifting each endpoint on an
     * edited line by that line's delta. Line-start endpoints stay anchored at
     * column 0 on indent; on outdent an endpoint inside the removed run clamps
     * to the new line start.
     */
    private remapSelectionForIndent(sel: ISelection, perLine: Map<number, number>): ISelection {
        const remap = (pos: IPosition): IPosition => {
            const delta = perLine.get(pos.line);
            if (delta === undefined) return pos;
            if (delta > 0) {
                return { line: pos.line, character: pos.character === 0 ? 0 : pos.character + delta };
            }
            return { line: pos.line, character: Math.max(0, pos.character + delta) };
        };
        const anchor = remap(sel.anchor);
        const active = remap(sel.active);
        return createSelection(anchor.line, anchor.character, active.line, active.character);
    }

    // ─── Auto-expand ────────────────────────────────────────

    /**
     * Ensures a logical line is visible by expanding any collapsed region that hides it.
     * A line is hidden if it falls in the range (startLine+1 .. endLine) of a collapsed region.
     */
    public ensureLineVisible(logicalLine: number): void {
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && logicalLine > region.startLine && logicalLine <= region.endLine) {
                region.isCollapsed = false;
                this.foldsVersion++;
            }
        }
    }

    /**
     * Scrolls the viewport so that `range` is brought into view, first expanding
     * any collapsed fold that hides its start line.
     */
    public revealRange(range: IRange): void {
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(range.start);
    }

    /**
     * Ensures the primary cursor is visible: expands any collapsed region hiding
     * its line, then scrolls it into view. Used after a folding recompute that
     * may have re-collapsed a region around the just-edited line, so the caret
     * (and the text under it) stays visible — VS Code keeps the edited line shown.
     */
    public ensurePrimaryCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    /** Number of logical lines in the underlying document. */
    public get lineCount(): number {
        return this.document.lineCount;
    }

    /** 0-based line of the primary cursor (0 when there is no selection). */
    public get primaryCursorLine(): number {
        return this.selections[0]?.active.line ?? 0;
    }

    /** 0-based character offset of the primary cursor (0 when there is no selection). */
    public get primaryCursorColumn(): number {
        return this.selections[0]?.active.character ?? 0;
    }

    /**
     * Moves the primary cursor to (`line`, `character`) — both 0-based — clamping
     * to document/line bounds, collapsing any selection, and revealing the target
     * (expanding a fold that hides it). Used by Go-to-Line navigation.
     */
    public goToPosition(line: number, character = 0): void {
        const clampedLine = Math.max(0, Math.min(line, this.document.lineCount - 1));
        const clampedChar = Math.max(0, Math.min(character, this.document.getLineLength(clampedLine)));
        this.selections = [createCursorSelection(clampedLine, clampedChar)];
        this.ensureLineVisible(clampedLine);
        this.revealPosition(this.selections[0].active);
    }

    /**
     * Restores selections from a saved snapshot (used by UndoManager).
     */
    public restoreSelections(selections: readonly ISelection[]): void {
        this.selections = [...selections];
        // Undo/redo may restore the caret into a region that is still collapsed;
        // reveal it (like goToPosition) rather than leaving it on a hidden line.
        if (this.selections.length > 0) this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    // ─── Private ────────────────────────────────────────────

    private ensureCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.revealPosition(this.selections[0].active);
    }

    /** Scrolls the viewport (vertically + horizontally) to bring `pos` into view. */
    private revealPosition(pos: IPosition): void {
        if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

        const visualLine = this.logicalToVisualLine(pos.line);
        /* v8 ignore start -- callers (goToPosition/revealRange/restoreSelections) expand folds before revealing, so a hidden line never reaches here */
        if (visualLine < 0) return;
        /* v8 ignore stop */

        // Keep `margin` lines between the cursor and the top/bottom edge so the
        // cursor "steps back" from the edge (VS Code's `cursorSurroundingLines`).
        // Cap the margin at half the viewport, otherwise the two edges collide
        // and the cursor could be pushed out of view.
        const maxMargin = Math.floor((this.viewportHeight - 1) / 2);
        const margin = Math.max(0, Math.min(this.cursorSurroundingLines, maxMargin));

        if (visualLine < this.scrollTop + margin) {
            this.scrollTop = Math.max(0, visualLine - margin);
        } else if (visualLine > this.scrollTop + this.viewportHeight - 1 - margin) {
            this.scrollTop = visualLine - this.viewportHeight + 1 + margin;
        }

        const lineContent = this.document.getLineContent(pos.line);
        const dl = this.displayLineFor(lineContent);
        const col = dl.offsetToColumn(pos.character);
        if (col < this.scrollLeft) {
            this.scrollLeft = col;
        } else if (col >= this.scrollLeft + this.viewportWidth) {
            this.scrollLeft = col - this.viewportWidth + 1;
        }
    }

    /**
     * Builds an array of logical line indices that are currently visible.
     * A line is hidden if it falls in range (startLine+1 .. endLine) of a collapsed region.
     */
    private buildVisibleLines(): number[] {
        if (
            this.visibleLinesCache !== null &&
            this.visibleLinesCacheDocVersion === this.document.versionId &&
            this.visibleLinesCacheFoldsVersion === this.foldsVersion
        ) {
            return this.visibleLinesCache;
        }

        // Collect all hidden line ranges from collapsed regions
        const hiddenRanges: { from: number; to: number }[] = [];
        for (const region of this.foldedRegions) {
            if (region.isCollapsed) {
                hiddenRanges.push({ from: region.startLine + 1, to: region.endLine });
            }
        }

        // Sort by start line for efficient processing
        hiddenRanges.sort((a, b) => a.from - b.from);

        const visible: number[] = [];
        const hiddenIdx = 0;

        for (let line = 0; line < this.document.lineCount; line++) {
            let isHidden = false;
            // Check against all hidden ranges
            for (let h = hiddenIdx; h < hiddenRanges.length; h++) {
                const range = hiddenRanges[h];
                if (line < range.from) {
                    break; // past all relevant ranges
                }
                if (line >= range.from && line <= range.to) {
                    isHidden = true;
                    break;
                }
            }
            if (!isHidden) {
                visible.push(line);
            }
        }

        this.visibleLinesCache = visible;
        this.visibleLinesCacheDocVersion = this.document.versionId;
        this.visibleLinesCacheFoldsVersion = this.foldsVersion;
        return visible;
    }

    /**
     * Returns the previous visible logical line before the given logical line, or -1.
     */
    private previousVisibleLine(logicalLine: number): number {
        const visible = this.buildVisibleLines();
        const currentIdx = visible.indexOf(logicalLine);
        if (currentIdx > 0) {
            return visible[currentIdx - 1];
        }
        // If current line is not in visible list (hidden), find the last visible line before it
        if (currentIdx === -1) {
            for (let i = visible.length - 1; i >= 0; i--) {
                if (visible[i] < logicalLine) {
                    return visible[i];
                }
            }
        }
        return -1;
    }

    /**
     * Returns the next visible logical line after the given logical line, or -1.
     */
    private nextVisibleLine(logicalLine: number): number {
        const visible = this.buildVisibleLines();
        const currentIdx = visible.indexOf(logicalLine);
        if (currentIdx >= 0 && currentIdx < visible.length - 1) {
            return visible[currentIdx + 1];
        }
        // If current line is not in visible list (hidden), find the first visible line after it
        if (currentIdx === -1) {
            for (const vLine of visible) {
                if (vLine > logicalLine) {
                    return vLine;
                }
            }
        }
        return -1;
    }

    /**
     * Adjusts folding region boundaries after document edits.
     * Processes edits in reverse document order to avoid cascading adjustments.
     * Public because {@link UndoManager} applies edits straight to the document
     * (bypassing {@link applyEdits}) and must shift regions the same way, so the
     * subsequent recompute re-keys collapsed state by the correct `startLine`.
     */
    public adjustFoldingRegionsForEdits(edits: readonly ITextEdit[]): void {
        // Sort edits in reverse document order (bottom-to-top)
        const sorted = [...edits].sort((a, b) => comparePositions(b.range.start, a.range.start));

        for (const edit of sorted) {
            const editStartLine = edit.range.start.line;
            const editEndLine = edit.range.end.line;
            const insertedLineCount = edit.text.split("\n").length;
            const deletedLineCount = editEndLine - editStartLine;
            const lineDelta = insertedLineCount - 1 - deletedLineCount;

            this.foldedRegions = this.foldedRegions.filter((region) => {
                // Edit completely after the region → no change
                if (editStartLine > region.endLine) {
                    return true;
                }

                // Edit completely before the region → shift both boundaries
                if (editEndLine < region.startLine) {
                    region.startLine += lineDelta;
                    region.endLine += lineDelta;
                    return true;
                }

                // Edit starts before region starts and ends inside/after region → remove
                if (editStartLine <= region.startLine && editEndLine >= region.startLine) {
                    return false;
                }

                // Edit is completely inside the region → adjust endLine
                if (editStartLine > region.startLine && editEndLine <= region.endLine) {
                    region.endLine += lineDelta;
                    return region.endLine > region.startLine; // remove if region became empty
                }

                // Edit starts inside region and extends beyond → remove
                /* v8 ignore start -- the fall-through else and the final `return true` are unreachable: reaching here needs editStartLine>endLine, but that case already returned at the "completely after" check */
                if (
                    editStartLine > region.startLine &&
                    editStartLine <= region.endLine &&
                    editEndLine > region.endLine
                ) {
                    return false;
                }

                return true;
                /* v8 ignore stop */
            });
        }
    }

    /**
     * Returns selections sorted by position in document order.
     */
    private sortedSelections(): ISelection[] {
        return [...this.selections].sort((a, b) => {
            const rangeA = selectionToRange(a);
            const rangeB = selectionToRange(b);
            return comparePositions(rangeA.start, rangeB.start);
        });
    }

    /**
     * Builds text edits from all current selections.
     */
    private buildEditsFromSelections(text: string): ITextEdit[] {
        return this.sortedSelections().map((sel) => {
            const range = selectionToRange(sel);
            return createTextEdit(range, text);
        });
    }

    /**
     * After edits are applied, computes the new cursor positions.
     * Each cursor moves to the end of the inserted text.
     */
    private computeSelectionsAfterEdits(edits: readonly ITextEdit[]): ISelection[] {
        // Sort edits in document order (ascending)
        const sorted = [...edits].sort((a, b) => comparePositions(a.range.start, b.range.start));

        const newSelections: ISelection[] = [];
        let accLineDelta = 0;
        let accCharDelta = 0;
        let lastEditEndLine = -1;

        for (const edit of sorted) {
            const range = edit.range;
            const insertedLines = edit.text.split("\n");
            const insertedLineCount = insertedLines.length;

            // End position of the inserted text
            let newLine: number;
            let newChar: number;

            if (insertedLineCount === 1) {
                // Single-line insert: cursor goes to start + text length
                newLine = range.start.line + accLineDelta;
                const startChar =
                    range.start.line === lastEditEndLine ? range.start.character + accCharDelta : range.start.character;
                newChar = startChar + insertedLines[0].length;
            } else {
                // Multi-line insert: cursor goes to the last inserted line
                newLine = range.start.line + accLineDelta + insertedLineCount - 1;
                newChar = insertedLines[insertedLineCount - 1].length;
            }

            newSelections.push(createCursorSelection(newLine, newChar));

            // Update accumulated deltas
            const deletedLines = range.end.line - range.start.line;
            const lineDelta = insertedLineCount - 1 - deletedLines;
            accLineDelta += lineDelta;

            if (insertedLineCount === 1 && deletedLines === 0) {
                // Same-line edit: accumulate character delta
                const charDelta = insertedLines[0].length - (range.end.character - range.start.character);
                if (range.start.line === lastEditEndLine) {
                    accCharDelta += charDelta;
                } else {
                    accCharDelta = charDelta;
                }
                lastEditEndLine = range.start.line;
            } else {
                accCharDelta = 0;
                lastEditEndLine = -1;
            }
        }

        /* v8 ignore start -- the `: [...]` fallback is unreachable: callers only invoke this with a non-empty edit list, and every document has at least one selection, so newSelections is never empty */
        return newSelections.length > 0 ? newSelections : [createCursorSelection(0, 0)];
        /* v8 ignore stop */
    }

    /**
     * Constructs a new selection after a cursor movement.
     * If inSelectionMode is false, anchor collapses to the new active position.
     * If true, the original anchor is preserved.
     */
    private buildSelection(
        original: ISelection,
        newLine: number,
        newChar: number,
        idealColumn: number,
        inSelectionMode: boolean,
    ): ISelection {
        if (inSelectionMode) {
            return createSelection(original.anchor.line, original.anchor.character, newLine, newChar, idealColumn);
        }
        return createCursorSelection(newLine, newChar, idealColumn);
    }

    /**
     * Sorts selections by their start position in document order.
     * Does not merge overlapping selections (kept simple for now).
     */
    private normalizeSelections(): void {
        this.selections.sort((a, b) => {
            const rangeA = selectionToRange(a);
            const rangeB = selectionToRange(b);
            return comparePositions(rangeA.start, rangeB.start);
        });
    }

    public cloneSelections(): ISelection[] {
        return this.selections.map((s) => ({ ...s, anchor: { ...s.anchor }, active: { ...s.active } }));
    }
}

/**
 * Number of leading characters to strip to remove one indent level from a line:
 * a single leading tab, or up to `tabSize` leading spaces (fewer if the run is
 * shorter). Returns 0 when the line has no leading whitespace.
 */
function computeOutdentRemoval(content: string, tabSize: number): number {
    if (content.length === 0) return 0;
    if (content.startsWith("\t")) return 1;
    let count = 0;
    while (count < tabSize && content[count] === " ") {
        count++;
    }
    return count;
}

/**
 * Index of the first non-whitespace character in `content`, or the line length
 * when the line is empty or all whitespace.
 */
function firstNonWhitespaceIndex(content: string): number {
    for (let i = 0; i < content.length; i++) {
        if (!/\s/.test(content[i])) return i;
    }
    return content.length;
}

// ─── Word Boundary Helpers ──────────────────────────────────

/**
 * Finds the start of the previous word boundary, scanning left from `offset`.
 * Mirrors VS Code Ctrl+Left behavior: skip whitespace, then skip same-class characters.
 */
function findWordBoundaryLeft(line: string, offset: number): number {
    let pos = offset;
    // Skip whitespace
    while (pos > 0 && charClass(line[pos - 1]) === 0) {
        pos--;
    }
    if (pos === 0) return 0;
    // Skip same-class chars
    const cls = charClass(line[pos - 1]);
    while (pos > 0 && charClass(line[pos - 1]) === cls) {
        pos--;
    }
    return pos;
}

/**
 * Finds the end of the next word boundary, scanning right from `offset`.
 * Mirrors VS Code Ctrl+Right behavior: skip same-class characters, then skip whitespace.
 */
function findWordBoundaryRight(line: string, offset: number): number {
    let pos = offset;
    const len = line.length;
    /* v8 ignore start -- unreachable via callers: both cursorWordRight and deleteWordRight only call this when offset < line length */
    if (pos >= len) return len;
    /* v8 ignore stop */
    // Skip same-class chars
    const cls = charClass(line[pos]);
    while (pos < len && charClass(line[pos]) === cls) {
        pos++;
    }
    // Skip whitespace
    while (pos < len && charClass(line[pos]) === 0) {
        pos++;
    }
    return pos;
}

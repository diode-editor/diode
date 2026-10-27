import * as path from "node:path";

import type { CursorStyle } from "@tuidom/core/common/cursorStyle";
import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";

import { Emitter, Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { EditorCursorStyleSetting } from "../../../../editor/common/config/editorCursorStyle.ts";
import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { DEFAULT_ENCODING } from "../../../../editor/common/model/encoding.ts";
import type { IDocumentLanguageChange } from "../../../../editor/common/model/iDocumentLanguageChange.ts";
import type { IGhostText } from "../../../../editor/common/model/iGhostText.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import type { EditorViewState, WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { ICursorStateComputer } from "../../../../editor/common/viewModel/trackedSelections.ts";
import type { IColorDecoratorsOptions } from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { WorkbenchColorKey } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import { type SaveOutcome, TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import type { EditorComponent, IIndentConfiguration, ScrollbarMarkersSetting } from "./editorComponent.ts";
import { DEFAULT_EDITOR_ID, type IEditorPane } from "./iEditorPane.ts";

/**
 * The "model + view component" pair of one text editor; owns both.
 * Anything not in {@link IEditorPane} (saving, EOL, encoding, folding) is available
 * only to callers that explicitly ask for a text pane.
 */
export class TextEditorPane<TModel extends BaseTextEditorModel = BaseTextEditorModel>
    extends Disposable
    implements IEditorPane
{
    private readonly onDidChangeReadOnlyEmitter = this.register(new Emitter<void>());
    /**
     * An editor outside the tab strip (Output in the bottom panel): it becomes `getActivePane()`
     * through focus, but consumers that work with tabs must skip it.
     */
    public detached = false;

    public readonly editorId = DEFAULT_EDITOR_ID;

    /**
     * @param modelOwnership — a model registry reference to dispose instead of the model itself: the model
     * dies with the last reference, so tabs of one file in different groups survive closing any one
     * of them. Without it the pane owns the model.
     */
    public constructor(
        public readonly model: TModel,
        public readonly component: EditorComponent,
        modelOwnership?: IDisposable,
    ) {
        super();
        this.register(component);
        this.register(modelOwnership ?? model);
        // The large-file mode (docs/arch/Editor.md): a deviation from upstream, where the file stays editable.
        // Every tab of the model opens read-only; "Enable Editing" releases them all through the model event,
        // whose only transition is true → false.
        if (model.isTooLargeForTokenization) component.viewState.readOnly = true;
        this.register(
            model.onDidChangeTooLargeForTokenization(() => {
                this.readOnly = false;
            }),
        );
    }

    /** The model's large-file mode; consumers that skip work on it (quick diff) read it from the pane. */
    public get isTooLargeForTokenization(): boolean {
        return this.model.isTooLargeForTokenization;
    }

    public onDidChangeTooLargeForTokenization(listener: () => void): IDisposable {
        return this.model.onDidChangeTooLargeForTokenization(listener);
    }

    public onDidChangeState(cb: () => void): IDisposable {
        const subscriptions = [
            this.onDidChangeContent(cb),
            this.onDidChangeEol(cb),
            this.onDidChangeDiskState(cb),
            this.onDidChangeReadOnly(cb),
            // The model event, not the onDidSave slot: a document can have several
            // tabs, and every one of them must repaint.
            this.onDidSave(cb),
        ];
        return {
            dispose: () => {
                for (const subscription of subscriptions) subscription.dispose();
            },
        };
    }

    /** `null` for synthetic buffers (Output, a virtual document, a snapshot). */
    public get fileModel(): TextFileModel | null {
        return this.model instanceof TextFileModel ? this.model : null;
    }

    public get uri(): Uri {
        return this.model.uri;
    }

    /** For when the resource can't express the label: `a.ts (dev)` can't be derived from a `git:` uri with a JSON query. */
    public labelOverride: string | null = null;

    public get label(): string {
        if (this.labelOverride !== null) return this.labelOverride;
        const uri = this.model.uri;
        return uri.scheme === "file" ? path.basename(uri.fsPath) : uri.path;
    }

    public get fileName(): string | null {
        return this.fileModel?.fileName ?? null;
    }

    public get absoluteFilePath(): string | null {
        return this.fileModel?.absoluteFilePath ?? null;
    }

    public get isModified(): boolean {
        return this.model.isModified;
    }

    public get isOrphaned(): boolean {
        return this.fileModel?.isOrphaned ?? false;
    }

    public get eol(): EndOfLine {
        return this.model.eol;
    }

    public get encoding(): string {
        return this.fileModel?.encoding ?? DEFAULT_ENCODING;
    }

    public get languageId(): string {
        return this.model.languageId;
    }

    public get hasDiskConflict(): boolean {
        return this.fileModel?.hasDiskConflict ?? false;
    }

    public get undoContext(): string {
        return this.model.undoContext;
    }

    public get onDidSave(): Event<void> {
        return this.fileModel?.onDidSaveDocument ?? Event.None;
    }

    public set backgroundToken(token: WorkbenchColorKey) {
        this.component.backgroundToken = token;
    }

    public onDidChangeSelection(cb: () => void): IDisposable {
        return this.component.onDidChangeSelection(cb);
    }

    private requireFileModel(operation: string): TextFileModel {
        const fileModel = this.fileModel;
        if (fileModel === null) throw new Error(`${operation}: buffer ${this.uri.toString()} has no file`);
        return fileModel;
    }

    public openFile(uri: Uri): void {
        this.requireFileModel("openFile").openFile(uri);
    }

    public save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        return this.fileModel?.save(options) ?? Promise.resolve("no-file");
    }

    public saveWithEncoding(encoding: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        return this.fileModel?.saveWithEncoding(encoding, options) ?? Promise.resolve("no-file");
    }

    /** For a synthetic buffer, the caller writes the copy to disk (`fileActions`, like upstream). */
    public saveAs(newPath: string): Promise<void> {
        return this.requireFileModel("saveAs").saveAs(newPath);
    }

    public revertToDisk(): boolean {
        return this.fileModel?.revertToDisk() ?? false;
    }

    public reopenWithEncoding(encoding: string): Promise<boolean> {
        return this.fileModel?.reopenWithEncoding(encoding) ?? Promise.resolve(false);
    }

    public setEncoding(encoding: string): void {
        if (this.readOnly) return;
        this.fileModel?.setEncoding(encoding);
    }

    public setEol(eol: EndOfLine): void {
        if (this.readOnly) return;
        this.model.setEol(eol, this.component.editTarget);
    }

    public setLanguage(languageId: string): void {
        this.model.setLanguage(languageId);
    }

    public getText(): string {
        return this.model.getText();
    }

    /** Cheaper than `getText().split("\n")`. */
    public getLinesContent(): string[] {
        return this.model.document.getLinesContent();
    }

    /**
     * `computeCursorState` sets the selections after the batch (inverse edits come in `edits`
     * order); without it selections shift with the edits, like `editor.executeEdits`.
     */
    public applyExternalEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState?: ICursorStateComputer,
    ): void {
        this.model.applyExternalEdits(edits, label, this.component.editTarget, computeCursorState);
    }

    /**
     * Returns the undo step to the caller instead of pushing it to the document's bucket, so a bulk
     * edit can build ONE step for the whole `workspace.applyEdit`.
     */
    public applyExternalEditsDetached(edits: readonly ITextEdit[], label: string): IUndoRedoElement | null {
        return this.model.applyExternalEditsDetached(edits, label, this.component.editTarget);
    }

    public undo(): void {
        if (this.readOnly) return;
        // This view is the acting one: the step's selection snapshot is restored into it.
        this.model.undo(this.component.viewState);
    }

    public redo(): void {
        if (this.readOnly) return;
        this.model.redo(this.component.viewState);
    }

    public onDidChangeContent(listener: () => void): IDisposable {
        return this.model.onDidChangeContent(listener);
    }

    public onDidChangeLanguage(listener: (change: IDocumentLanguageChange) => void): IDisposable {
        return this.model.onDidChangeLanguage(listener);
    }

    public onDidChangeEol(listener: () => void): IDisposable {
        return this.model.onDidChangeEol(listener);
    }

    public onDidChangeEncoding(listener: () => void): IDisposable {
        return (this.fileModel?.onDidChangeEncoding ?? Event.None)(listener);
    }

    public onDidChangeDiskState(listener: () => void): IDisposable {
        return (this.fileModel?.onDidChangeDiskState ?? Event.None)(listener);
    }

    public get view(): ScrollBarDecorator {
        return this.component.view;
    }

    public get viewState(): EditorViewState {
        return this.component.viewState;
    }

    public getSelectedTexts(): string[] {
        return this.component.viewState.getSelectedTexts();
    }

    /**
     * `EditorViewState` itself blocks edits; the flag covers the paths that bypass it: undo/redo,
     * EOL and encoding go to `TextFileModel` directly.
     */
    public get readOnly(): boolean {
        return this.component.viewState.readOnly;
    }

    public set readOnly(value: boolean) {
        if (this.component.viewState.readOnly === value) return;
        this.component.viewState.readOnly = value;
        this.onDidChangeReadOnlyEmitter.fire();
    }

    public readonly onDidChangeReadOnly = this.onDidChangeReadOnlyEmitter.event;

    public onDidChangeCursorPosition(listener: () => void): IDisposable {
        return this.component.onDidChangeCursorPosition(listener);
    }

    public onDidType(listener: (text: string) => void): IDisposable {
        return this.component.onDidType(listener);
    }

    public getCaretAnchor(): OverlayAnchorPosition | null {
        return this.component.getCaretAnchor();
    }

    public showContextMenu(): void {
        this.component.showContextMenu();
    }

    public focusEditor(): void {
        this.component.focus();
    }

    public pushUndo(element: IUndoElement | undefined): void {
        this.component.pushUndo(element);
    }

    public setIndentOptions(patch: { tabSize?: number; insertSpaces?: boolean }): void {
        this.component.setIndentOptions(patch);
    }

    public onDidChangeIndentOptions(listener: () => void): IDisposable {
        return this.component.onDidChangeIndentOptions(listener);
    }

    public applyIndentConfiguration(config: IIndentConfiguration): void {
        this.component.applyIndentConfiguration(config);
    }

    public setOccurrenceHighlightEnabled(enabled: boolean): void {
        this.component.setOccurrenceHighlightEnabled(enabled);
    }

    /** `diode.icons.nerdFont`: the glyph set of the folding chevrons. */
    public setNerdFont(nerdFont: boolean): void {
        this.component.setNerdFont(nerdFont);
    }

    /**
     * `TextEditor.options.cursorStyle` from an extension: beats `editor.cursorStyle` while the pane lives
     * and is never written to settings (upstream `updateOptions` on the code editor).
     */
    public cursorStyleOverride: EditorCursorStyleSetting | undefined = undefined;

    public setCursorStyle(style: CursorStyle | null): void {
        this.component.setCursorStyle(style);
    }

    public setCursorSurroundingLines(lines: number): void {
        this.component.setCursorSurroundingLines(lines);
    }

    public setScrollbarMarkers(placement: ScrollbarMarkersSetting): void {
        this.component.setScrollbarMarkers(placement);
    }

    public setFoldingMaximumRegions(limit: number): void {
        this.component.setFoldingMaximumRegions(limit);
    }

    public setColorDecorators(options: IColorDecoratorsOptions): void {
        this.component.setColorDecorators(options);
    }

    /**
     * Diff sides are aligned by view lines, and wrapping would break that. The override lives in
     * the setter rather than in the callers, so it covers both config live reload and Alt+Z.
     */
    public wordWrapForcedOff = false;

    public setWordWrap(mode: WordWrapMode, column: number): void {
        this.component.setWordWrap(this.wordWrapForcedOff ? "off" : mode, column);
    }

    public setSearchDecorations(matches: IRange[], currentIndex: number): void {
        this.component.setSearchDecorations(matches, currentIndex);
    }

    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        this.component.setMarkerDecorations(decorations);
    }

    public setGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void {
        this.component.setGutterChangeDecorations(decorations);
    }

    public setExtensionGutterChangeDecorations(decorations: readonly IGutterChangeDecoration[]): void {
        this.component.setExtensionGutterChangeDecorations(decorations);
    }

    public setGhostText(ghost: IGhostText | null): void {
        this.component.setGhostText(ghost);
    }

    public revealRange(range: IRange): void {
        this.component.revealRange(range);
    }

    public get lineCount(): number {
        return this.component.lineCount;
    }

    public get primaryCursorLine(): number {
        return this.component.primaryCursorLine;
    }

    public get primaryCursorColumn(): number {
        return this.component.primaryCursorColumn;
    }

    public goToPosition(line: number, column = 0): void {
        this.component.goToPosition(line, column);
    }

    public foldAtCursor(): void {
        this.component.foldAtCursor();
    }

    public unfoldAtCursor(): void {
        this.component.unfoldAtCursor();
    }

    public toggleFoldAtCursor(): void {
        this.component.toggleFoldAtCursor();
    }

    public foldAll(): void {
        this.component.foldAll();
    }

    public unfoldAll(): void {
        this.component.unfoldAll();
    }

    public foldRecursivelyAtCursor(): void {
        this.component.foldRecursivelyAtCursor();
    }

    public unfoldRecursivelyAtCursor(): void {
        this.component.unfoldRecursivelyAtCursor();
    }

    public foldLevel(level: number): void {
        this.component.foldLevel(level);
    }

    public gotoNextFold(): void {
        this.component.gotoNextFold();
    }

    public gotoPreviousFold(): void {
        this.component.gotoPreviousFold();
    }
}

/** A bare `instanceof` on the generic class narrows to `TextEditorPane<any>`. */
export function isTextEditorPane(pane: unknown): pane is TextEditorPane {
    return pane instanceof TextEditorPane;
}

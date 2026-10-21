import * as path from "node:path";

import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";

import { Emitter, Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
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
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { WorkbenchColorKey } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import { type SaveOutcome, TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import type { EditorComponent, IIndentConfiguration } from "./editorComponent.ts";
import type { IEditorPane } from "./iEditorPane.ts";

/**
 * Пара «модель + view-компонент» одного текстового редактора, владеет обоими.
 * Всё, чего нет в {@link IEditorPane} (сохранение, EOL, кодировка, folding),
 * доступно только тем, кто явно спросил текстовую панель.
 */
export class TextEditorPane<TModel extends BaseTextEditorModel = BaseTextEditorModel>
    extends Disposable
    implements IEditorPane
{
    private readonly onDidChangeReadOnlyEmitter = this.register(new Emitter<void>());
    /**
     * Редактор вне таб-строки (Output в нижней Panel): попадает в `getActivePane()`
     * по фокусу, но потребители, работающие с вкладкой, обязаны его пропускать.
     */
    public detached = false;

    /**
     * @param modelOwnership — ссылка реестра моделей вместо самой модели: модель
     * умирает с последней ссылкой, так вкладки одного файла в разных группах
     * переживают закрытие любой одной. Без параметра панель владеет моделью сама.
     */
    public constructor(
        public readonly model: TModel,
        public readonly component: EditorComponent,
        modelOwnership?: IDisposable,
    ) {
        super();
        this.register(component);
        this.register(modelOwnership ?? model);
    }

    public onDidChangeState(cb: () => void): IDisposable {
        const subscriptions = [
            this.onDidChangeContent(cb),
            this.onDidChangeEol(cb),
            this.onDidChangeDiskState(cb),
            this.onDidChangeReadOnly(cb),
            // Событие модели, а не слот onDidSave: у документа может быть
            // несколько вкладок, и перерисоваться обязана каждая.
            this.onDidSave(cb),
        ];
        return {
            dispose: () => {
                for (const subscription of subscriptions) subscription.dispose();
            },
        };
    }

    /** `null` — синтетика (Output, виртуальный документ, снимок). */
    public get fileModel(): TextFileModel | null {
        return this.model instanceof TextFileModel ? this.model : null;
    }

    public get uri(): Uri {
        return this.model.uri;
    }

    /** Когда ресурс метку не выражает: `a.ts (dev)` из `git:`-uri с JSON-query не вывести. */
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
        if (fileModel === null) throw new Error(`${operation}: у буфера ${this.uri.toString()} нет файла`);
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

    /** Копию синтетики на диск пишет вызывающий (`fileActions`, как upstream). */
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

    /** Дешевле, чем `getText().split("\n")`. */
    public getLinesContent(): string[] {
        return this.model.document.getLinesContent();
    }

    /**
     * Выделения после батча назначает `computeCursorState` (обратные правки — в
     * порядке `edits`), без него они сдвигаются за правками — как `editor.executeEdits`.
     */
    public applyExternalEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState?: ICursorStateComputer,
    ): void {
        this.model.applyExternalEdits(edits, label, this.component.editTarget, computeCursorState);
    }

    /**
     * Шаг истории отдаётся вызывающему, а не кладётся в бакет документа: так bulk
     * edit собирает ОДИН шаг на весь `workspace.applyEdit`.
     */
    public applyExternalEditsDetached(edits: readonly ITextEdit[], label: string): IUndoRedoElement | null {
        return this.model.applyExternalEditsDetached(edits, label, this.component.editTarget);
    }

    public undo(): void {
        if (this.readOnly) return;
        // Действующая вью — эта: ей восстанавливается снимок выделений шага.
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
     * Правки блокирует сам `EditorViewState`; флаг нужен для путей мимо него — undo/redo,
     * EOL и кодировка идут в `TextFileModel` напрямую.
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

    public setCursorSurroundingLines(lines: number): void {
        this.component.setCursorSurroundingLines(lines);
    }

    /**
     * Стороны диффа выравниваются по view-строкам — перенос развёл бы их. Форс живёт
     * в сеттере, а не у вызывающих: им накрыты и live-reload конфига, и Alt+Z.
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

/** Голый `instanceof` у обобщённого класса сужает к `TextEditorPane<any>`. */
export function isTextEditorPane(pane: unknown): pane is TextEditorPane {
    return pane instanceof TextEditorPane;
}

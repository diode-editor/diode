import * as path from "node:path";

import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { OverlayAnchorPosition } from "@tuidom/core/dom/overlayLayer";
import type { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import type { Uri } from "../../../../base/common/uri.ts";
import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { FoldingRangeSource } from "../../../../editor/common/languages/iFoldingSource.ts";
import type { IDocumentLanguageChange } from "../../../../editor/common/model/iDocumentLanguageChange.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IUndoElement } from "../../../../editor/common/model/iUndoElement.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import type { IMarkerDecoration } from "../../../../platform/markers/common/iMarker.ts";
import type { WorkbenchColorKey } from "../../../../platform/theme/common/colors/colorContributions.ts";
import type { SaveParticipant } from "../../../services/textfile/common/iSaveParticipant.ts";
import type { SaveOutcome, TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import type { EditorComponent } from "./editorComponent.ts";
import type { IEditorPane } from "./iEditorPane.ts";

/**
 * Пара «модель + view-компонент» одного открытого **текстового** редактора.
 * Владеет временем жизни обоих и делегирует единый публичный API по
 * принадлежности: файлово-модельное — в {@link TextFileModel},
 * view-обвязочное — в {@link EditorComponent}. Это поверхность, которую видят
 * потребители «активного редактора» (экшены, Find/Completion, швы Workbench,
 * host-адаптеры); создаёт и хранит пары `EditorService`.
 *
 * Реализует {@link IEditorPane} — общий контракт вкладки, по которому группа
 * работает с панелями любого вида. Всё, чего в этом контракте нет (сохранение,
 * EOL, кодировка, folding, автодополнение), доступно только тем, кто явно
 * спросил текстовую панель.
 */
export class TextEditorPane extends Disposable implements IEditorPane {
    private readOnlyListeners = new Set<() => void>();
    /**
     * Редактор вне таб-строки (нижняя Panel: Output). Такой редактор попадает в
     * `getActivePane()`, когда фокус внутри него, — и потребители, работающие
     * с ВКЛАДКОЙ (переключение read-only, `activeTextEditor` для расширений),
     * обязаны его пропускать: содержимым владеет фича, а не пользователь.
     * Ставит `EditorService.openDetached`.
     */
    public detached = false;

    /**
     * @param modelOwnership — чем панель владеет вместо самой модели: ссылка
     * реестра моделей (`TextFileModelRegistry.acquire`). Закрытие вкладки
     * освобождает ссылку, а модель умирает только с последней из них — так две
     * вкладки одного файла в разных группах переживают закрытие любой одной.
     * Без параметра панель владеет моделью единолично (untitled, detached).
     */
    public constructor(
        public readonly model: TextFileModel,
        public readonly component: EditorComponent,
        modelOwnership?: IDisposable,
    ) {
        super();
        this.register(component);
        this.register(modelOwnership ?? model);
    }

    /**
     * Сводит текстовые события, влияющие на вид вкладки, в одно: правка контента
     * даёт/снимает маркер изменённости, смена EOL меняет `isModified` не трогая
     * текст, а внешнее изменение файла на диске перечитывает буфер или поднимает
     * флаг конфликта. Группе достаточно знать, что «что-то во вкладке поменялось».
     */
    public onDidChangeState(cb: () => void): IDisposable {
        const subscriptions = [
            this.onDidChangeContent(cb),
            this.onDidChangeEol(cb),
            this.onDidChangeDiskState(cb),
            this.onDidChangeReadOnly(cb),
            // Сохранение меняет вид вкладки: гаснет маркер изменённости, после
            // saveAs — имя. Событие модели, а не слот onDidSave: у документа
            // может быть несколько вкладок, и перерисоваться обязана каждая.
            this.model.onDidSaveDocument(cb),
        ];
        return {
            dispose: () => {
                for (const subscription of subscriptions) subscription.dispose();
            },
        };
    }

    // ─── Модель: ресурс, dirty, save, оси encoding/EOL/language ────────────────

    public get uri(): Uri {
        return this.model.uri;
    }

    /**
     * Метка вкладки, когда ресурс её не выражает: `a.ts (dev)` у снимка ревизии —
     * из `git:`-uri с JSON-query такую не вывести. Задаёт владелец при открытии.
     */
    public labelOverride: string | null = null;

    /**
     * Имя файла, либо `Untitled-N` для безымянного буфера: у `untitled:`-ресурса
     * метка уже лежит в самом пути, отдельного поля-счётчика для неё не нужно.
     */
    public get label(): string {
        if (this.labelOverride !== null) return this.labelOverride;
        const uri = this.model.uri;
        return uri.scheme === "file" ? path.basename(uri.fsPath) : uri.path;
    }

    public get fileName(): string | null {
        return this.model.fileName;
    }

    public get absoluteFilePath(): string | null {
        return this.model.absoluteFilePath;
    }

    public get isModified(): boolean {
        return this.model.isModified;
    }

    public get eol(): EndOfLine {
        return this.model.eol;
    }

    public get encoding(): string {
        return this.model.encoding;
    }

    public get languageId(): string {
        return this.model.languageId;
    }

    public get hasDiskConflict(): boolean {
        return this.model.hasDiskConflict;
    }

    public get undoContext(): string {
        return this.model.undoContext;
    }

    public set onDidSave(callback: (() => void) | undefined) {
        this.model.onDidSave = callback;
    }

    public set fileWatcher(watcher: IFileWatcher | null) {
        this.model.fileWatcher = watcher;
    }

    public get saveParticipant(): SaveParticipant | undefined {
        return this.model.saveParticipant;
    }

    public set saveParticipant(participant: SaveParticipant | undefined) {
        this.model.saveParticipant = participant;
    }

    public get foldingRangeSource(): FoldingRangeSource | undefined {
        return this.component.foldingRangeSource;
    }

    public set foldingRangeSource(source: FoldingRangeSource | undefined) {
        this.component.foldingRangeSource = source;
    }

    /** Токен темы для фона редактора (см. `EditorComponent.backgroundToken`). */
    public set backgroundToken(token: WorkbenchColorKey) {
        this.component.backgroundToken = token;
    }

    /** Смена курсора/выделения в этом редакторе (см. `EditorComponent.onDidChangeSelection`). */
    public onDidChangeSelection(cb: () => void): IDisposable {
        return this.component.onDidChangeSelection(cb);
    }

    public openFile(uri: Uri): void {
        this.model.openFile(uri);
    }

    public save(options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        return this.model.save(options);
    }

    public saveWithEncoding(encoding: string, options?: { overwrite?: boolean }): Promise<SaveOutcome> {
        return this.model.saveWithEncoding(encoding, options);
    }

    public saveAs(newPath: string): Promise<void> {
        return this.model.saveAs(newPath);
    }

    public revertToDisk(): boolean {
        return this.model.revertToDisk();
    }

    public reopenWithEncoding(encoding: string): boolean {
        return this.model.reopenWithEncoding(encoding);
    }

    public setEncoding(encoding: string): void {
        if (this.readOnly) return;
        this.model.setEncoding(encoding);
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

    public applyExternalEdits(edits: readonly ITextEdit[], label: string): void {
        this.model.applyExternalEdits(edits, label, this.component.editTarget);
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
        return this.model.onDidChangeEncoding(listener);
    }

    public onDidChangeDiskState(listener: () => void): IDisposable {
        return this.model.onDidChangeDiskState(listener);
    }

    // ─── Компонент: view, курсор/скролл, декорации, folding ────────────────────

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
     * Режим «только чтение» вкладки (VS Code `EditorOption.readOnly`). Правки
     * документа блокирует сам `EditorViewState`; здесь флаг нужен ещё и для
     * путей мимо него — undo/redo, смена EOL и кодировки идут в `TextFileModel`
     * напрямую, как `pushUndoStop`/`popUndoStop` в `CodeEditorWidget`.
     */
    public get readOnly(): boolean {
        return this.component.viewState.readOnly;
    }

    public set readOnly(value: boolean) {
        if (this.component.viewState.readOnly === value) return;
        this.component.viewState.readOnly = value;
        for (const listener of [...this.readOnlyListeners]) listener();
    }

    /**
     * Смена режима read-only. На неё подписан `EditorService` — таб должен
     * получить/потерять замок сразу, как это уже сделано для EOL и dirty.
     */
    public onDidChangeReadOnly(listener: () => void): IDisposable {
        this.readOnlyListeners.add(listener);
        return { dispose: () => this.readOnlyListeners.delete(listener) };
    }

    public onDidChangeCursorPosition(listener: () => void): IDisposable {
        return this.component.onDidChangeCursorPosition(listener);
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

    public setOccurrenceHighlightEnabled(enabled: boolean): void {
        this.component.setOccurrenceHighlightEnabled(enabled);
    }

    public setCursorSurroundingLines(lines: number): void {
        this.component.setCursorSurroundingLines(lines);
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

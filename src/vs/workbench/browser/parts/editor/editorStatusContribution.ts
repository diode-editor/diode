import { DisplayLine } from "../../../../../../tuidom/common/displayLine.ts";
import { Disposable, type IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { getEncodingInfo } from "../../../../editor/common/model/encoding.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { LanguageServiceDIToken } from "../../../common/coreTokens.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

/**
 * Минимальный срез активного редактора, нужный сегментам статус-бара.
 * `TextEditorPane` (`TextFileModel` + `EditorComponent`) соответствует ему структурно;
 * связывание делает DI-модуль (`ActiveEditorStatusSourceDIToken`).
 */
export interface IActiveEditorStatus {
    readonly encoding: string;
    readonly eol: EndOfLine;
    readonly languageId: string;
    readonly viewState: EditorViewState;
    onDidChangeCursorPosition(listener: () => void): IDisposable;
    onDidChangeLanguage(listener: () => void): IDisposable;
    onDidChangeEol(listener: () => void): IDisposable;
    onDidChangeEncoding(listener: () => void): IDisposable;
}

/** Поставщик активного редактора для {@link EditorStatusContribution}. */
export interface IActiveEditorStatusSource {
    getActiveEditor(): IActiveEditorStatus | null;
    onActiveEditorChanged(listener: (editor: IActiveEditorStatus | null) => void): IDisposable;
}

export const ActiveEditorStatusSourceDIToken = token<IActiveEditorStatusSource>("ActiveEditorStatusSource");
export const EditorStatusContributionDIToken = token<EditorStatusContribution>("EditorStatusContribution");

/**
 * Публикует в {@link StatusBarService} сегменты активного редактора — правые,
 * в порядке VS Code: `Ln X, Col Y` · Encoding · EOL · Language. Encoding и EOL
 * кликабельны — исполняют команды пикеров через `CommandRegistry`. Подписан на
 * смену активного редактора и его события (курсор/язык/EOL/кодировка).
 */
export class EditorStatusContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        ActiveEditorStatusSourceDIToken,
        LanguageServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    private cursorHandle: IStatusBarEntryHandle | null = null;
    private encodingHandle: IStatusBarEntryHandle | null = null;
    private eolHandle: IStatusBarEntryHandle | null = null;
    private languageHandle: IStatusBarEntryHandle | null = null;
    private editorSubscriptions: IDisposable[] = [];

    public constructor(
        private readonly statusBar: StatusBarService,
        private readonly source: IActiveEditorStatusSource,
        private readonly languageService: ILanguageService,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.register(
            this.source.onActiveEditorChanged((editor) => {
                this.bindEditorListeners(editor);
                this.update();
            }),
        );
        this.register({
            dispose: () => {
                this.unbindEditorListeners();
            },
        });
        this.register({
            dispose: () => {
                this.cursorHandle?.dispose();
                this.encodingHandle?.dispose();
                this.eolHandle?.dispose();
                this.languageHandle?.dispose();
            },
        });
        // Подхватываем редактор, ставший активным до создания contribution'а.
        this.bindEditorListeners(this.source.getActiveEditor());
        this.update();
    }

    /**
     * Re-points the per-editor listeners at the currently active editor so the
     * Ln/Col and language indicators track it live. Disposes the previous ones.
     */
    private bindEditorListeners(editor: IActiveEditorStatus | null): void {
        this.unbindEditorListeners();
        if (editor === null) return;
        this.editorSubscriptions = [
            editor.onDidChangeCursorPosition(() => {
                this.update();
            }),
            editor.onDidChangeLanguage(() => {
                this.update();
            }),
            editor.onDidChangeEol(() => {
                this.update();
            }),
            editor.onDidChangeEncoding(() => {
                this.update();
            }),
        ];
    }

    private unbindEditorListeners(): void {
        for (const subscription of this.editorSubscriptions) subscription.dispose();
        this.editorSubscriptions = [];
    }

    /** Пересчитывает сегменты и синхронизирует записи в StatusBarService. */
    private update(): void {
        const editor = this.source.getActiveEditor();

        this.cursorHandle = this.setSegment(this.cursorHandle, this.cursorPositionText(editor), (text) =>
            this.statusBar.addEntry({ id: "status.editor.selection", text, alignment: "right", priority: 100 }),
        );
        this.encodingHandle = this.setSegment(this.encodingHandle, this.encodingSegment(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.encoding",
                text,
                alignment: "right",
                priority: 90,
                onClick: () => void this.commands.execute("workbench.action.editor.changeEncoding"),
            }),
        );
        this.eolHandle = this.setSegment(this.eolHandle, this.eolSegment(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.eol",
                text,
                alignment: "right",
                priority: 80,
                onClick: () => void this.commands.execute("workbench.action.editor.changeEOL"),
            }),
        );
        this.languageHandle = this.setSegment(this.languageHandle, this.languageSegment(editor), (text) =>
            this.statusBar.addEntry({ id: "status.editor.mode", text, alignment: "right", priority: 70 }),
        );
    }

    /** Приводит запись сегмента к целевому тексту: снять / обновить / добавить. */
    private setSegment(
        current: IStatusBarEntryHandle | null,
        text: string | null,
        create: (text: string) => IStatusBarEntryHandle,
    ): IStatusBarEntryHandle | null {
        if (text === null) {
            current?.dispose();
            return null;
        }
        if (current !== null) {
            current.update({ text });
            return current;
        }
        return create(text);
    }

    /**
     * VS Code-style encoding indicator: the short status label of the active
     * editor's disk encoding ("UTF-8", "Windows 1251"). Null without an active
     * editor; unknown ids (defensive) fall back to the raw id.
     */
    private encodingSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const info = getEncodingInfo(editor.encoding);
        /* v8 ignore start -- defensive: editor.encoding всегда табличный id (setEncoding валидирует, decodeBuffer возвращает элементы SUPPORTED_ENCODINGS) */
        if (info === undefined) return editor.encoding;
        /* v8 ignore stop */
        return info.statusLabel;
    }

    /** VS Code-style end-of-line indicator: "LF" or "CRLF". */
    private eolSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        return editor.eol === EndOfLine.CRLF ? "CRLF" : "LF";
    }

    /**
     * VS Code-style language indicator for the active editor: the language
     * display name ("TypeScript"), falling back to the raw language id when
     * the language has no registered alias. Null without an active editor.
     */
    private languageSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const languageId = editor.languageId;
        return this.languageService.getLanguageDisplayName(languageId) ?? languageId;
    }

    /**
     * VSCode-style "Ln X, Col Y" for the primary cursor, or null when there is
     * no active editor. The column is the tab-expanded display column (matching
     * the rendered cursor), 1-based like the line.
     */
    private cursorPositionText(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const viewState = editor.viewState;
        if (viewState.selections.length === 0) return null;
        const active = viewState.selections[0].active;
        const lineContent = viewState.document.getLineContent(active.line);
        const column = new DisplayLine(lineContent, viewState.tabSize).offsetToColumn(active.character);
        return `Ln ${active.line + 1}, Col ${column + 1}`;
    }
}

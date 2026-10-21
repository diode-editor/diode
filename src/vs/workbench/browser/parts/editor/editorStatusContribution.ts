import { DisplayLine } from "@tuidom/core/common/displayLine";

import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import { getEncodingInfo } from "../../../../editor/common/model/encoding.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntryHandle, StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

/** `TextEditorPane` matches this structurally; the DI module wires them together. */
export interface IActiveEditorStatus {
    readonly encoding: string;
    readonly eol: EndOfLine;
    readonly languageId: string;
    readonly viewState: EditorViewState;
    onDidChangeCursorPosition(listener: () => void): IDisposable;
    onDidChangeLanguage(listener: () => void): IDisposable;
    onDidChangeEol(listener: () => void): IDisposable;
    onDidChangeEncoding(listener: () => void): IDisposable;
    onDidChangeIndentOptions(listener: () => void): IDisposable;
}

export interface IActiveEditorStatusSource {
    getActiveEditor(): IActiveEditorStatus | null;
    onActiveEditorChanged(listener: (editor: IActiveEditorStatus | null) => void): IDisposable;
}

export const ActiveEditorStatusSourceDIToken = token<IActiveEditorStatusSource>("ActiveEditorStatusSource");
export const EditorStatusContributionDIToken = token<EditorStatusContribution>("EditorStatusContribution");

/** Segments in VS Code order: `Ln X, Col Y` · Indentation · Encoding · EOL · Language. */
export class EditorStatusContribution extends Disposable {
    public static dependencies = [
        StatusBarServiceDIToken,
        ActiveEditorStatusSourceDIToken,
        LanguageServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    private cursorHandle: IStatusBarEntryHandle | null = null;
    private indentationHandle: IStatusBarEntryHandle | null = null;
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
                this.indentationHandle?.dispose();
                this.encodingHandle?.dispose();
                this.eolHandle?.dispose();
                this.languageHandle?.dispose();
            },
        });
        this.bindEditorListeners(this.source.getActiveEditor());
        this.update();
    }

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
            editor.onDidChangeIndentOptions(() => {
                this.update();
            }),
        ];
    }

    private unbindEditorListeners(): void {
        for (const subscription of this.editorSubscriptions) subscription.dispose();
        this.editorSubscriptions = [];
    }

    private update(): void {
        const editor = this.source.getActiveEditor();

        this.cursorHandle = this.setSegment(this.cursorHandle, this.cursorPositionText(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.selection",
                name: "Editor Selection",
                text,
                alignment: "right",
                priority: 100,
            }),
        );
        this.indentationHandle = this.setSegment(this.indentationHandle, this.indentationSegment(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.indentation",
                name: "Editor Indentation",
                text,
                alignment: "right",
                priority: 95,
            }),
        );
        this.encodingHandle = this.setSegment(this.encodingHandle, this.encodingSegment(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.encoding",
                name: "Editor Encoding",
                text,
                alignment: "right",
                priority: 90,
                onClick: () => void this.commands.execute("workbench.action.editor.changeEncoding"),
            }),
        );
        this.eolHandle = this.setSegment(this.eolHandle, this.eolSegment(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.eol",
                name: "Editor End of Line",
                text,
                alignment: "right",
                priority: 80,
                onClick: () => void this.commands.execute("workbench.action.editor.changeEOL"),
            }),
        );
        this.languageHandle = this.setSegment(this.languageHandle, this.languageSegment(editor), (text) =>
            this.statusBar.addEntry({
                id: "status.editor.mode",
                name: "Editor Language",
                text,
                alignment: "right",
                priority: 70,
            }),
        );
    }

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

    private indentationSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const viewState = editor.viewState;
        const tabSize = viewState.tabSize.toString();
        return viewState.insertSpaces ? `Spaces: ${tabSize}` : `Tab Size: ${tabSize}`;
    }

    /** An unknown id (defensive) is shown as is. */
    private encodingSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const info = getEncodingInfo(editor.encoding);
        /* v8 ignore start -- defensive: editor.encoding is always a table id (setEncoding validates, decodeBuffer returns SUPPORTED_ENCODINGS entries) */
        if (info === undefined) return editor.encoding;
        /* v8 ignore stop */
        return info.statusLabel;
    }

    private eolSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        return editor.eol === EndOfLine.CRLF ? "CRLF" : "LF";
    }

    /** Falls back to the raw language id when no alias is registered. */
    private languageSegment(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const languageId = editor.languageId;
        return this.languageService.getLanguageDisplayName(languageId) ?? languageId;
    }

    /**
     * The column is the screen column with tabs expanded (where the cursor is drawn), 1-based like
     * the line. With multiple cursors appends `(N selections)`, like VS Code.
     */
    private cursorPositionText(editor: IActiveEditorStatus | null): string | null {
        if (editor === null) return null;
        const viewState = editor.viewState;
        if (viewState.selections.length === 0) return null;
        const active = viewState.selections[0].active;
        const lineContent = viewState.document.getLineContent(active.line);
        const column = new DisplayLine(lineContent, viewState.tabSize).offsetToColumn(active.character);
        const position = `Ln ${active.line + 1}, Col ${column + 1}`;
        return viewState.selections.length > 1
            ? `${position} (${viewState.selections.length.toString()} selections)`
            : position;
    }
}

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../common/core/iPosition.ts";
import { isSelectionCollapsed } from "../../../common/core/iSelection.ts";
import type { ITextEdit } from "../../../common/core/iTextEdit.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { OnTypeFormattingEditProvider } from "../../../common/languages/iFormattingSource.ts";
import type { EditorViewState } from "../../../common/viewModel/editorViewState.ts";

/** What the controller needs of a text editor pane. */
export interface IFormatOnTypeEditor extends ILanguageFeatureTarget {
    readonly viewState: EditorViewState;
    onDidType(listener: (text: string) => void): IDisposable;
    onDidTypeNewLine(listener: () => void): IDisposable;
    applyExternalEdits(edits: readonly ITextEdit[], label: string): void;
}

export interface IFormatOnTypeOptions {
    readonly providers: LanguageFeatureRegistry<OnTypeFormattingEditProvider>;
    /** `editor.formatOnType` for the editor's language. */
    isSettingEnabled(): boolean;
}

/**
 * Port of upstream `FormatOnType` for the active editor: only the first provider is asked. The setting and the
 * provider are read per character, so nothing has to resubscribe when they change.
 *
 * The edits are applied without a cursor state, so the caret shifts along with them, as upstream's `replaceMove`:
 * after `int x=1;` becomes `int x = 1;` it still stands after the `;`, where the next character belongs.
 */
export class FormatOnTypeController extends Disposable {
    private readonly pending = new Set<CancellationTokenSource>();

    public constructor(
        private readonly editor: IFormatOnTypeEditor,
        private readonly options: IFormatOnTypeOptions,
    ) {
        super();
        this.register(
            editor.onDidType((text) => {
                this.onTyped(text);
            }),
        );
        this.register(
            editor.onDidTypeNewLine(() => {
                this.onTyped("\n");
            }),
        );
        this.register({
            dispose: () => {
                for (const request of this.pending) request.cancel();
            },
        });
    }

    private onTyped(ch: string): void {
        if (!this.options.isSettingEnabled()) return;
        const provider = this.options.providers.ordered(this.editor).at(0);
        if (!provider?.triggerCharacters.includes(ch)) return;
        const selections = this.editor.viewState.selections;
        if (selections.length > 1 || !isSelectionCollapsed(selections[0])) return;
        void this.format(provider, selections[0].active, ch);
    }

    private async format(provider: OnTypeFormattingEditProvider, position: IPosition, ch: string): Promise<void> {
        const viewState = this.editor.viewState;
        const document = viewState.document;
        const request = new CancellationTokenSource();
        this.pending.add(request);
        // An edit on the caret's line or above moves what the answer talks about; one below does not.
        const listener = document.onDidChangeModelContent((event) => {
            if (event.isFlush || event.changes.some((change) => change.range.end.line <= position.line)) {
                request.cancel();
            }
        });
        try {
            // Stryker disable ArrayDeclaration,ArrowFunction: a garbage answer throws out of this async call, an unhandled rejection instead of a verdict
            const edits = await provider
                .provideOnTypeFormattingEdits(
                    {
                        uri: this.editor.uri.toString(),
                        languageId: this.editor.languageId,
                        versionId: document.versionId,
                        position,
                        ch,
                        tabSize: viewState.tabSize,
                        insertSpaces: viewState.insertSpaces,
                    },
                    request.token,
                )
                .catch(() => []);
            // Stryker restore ArrayDeclaration,ArrowFunction
            if (request.token.isCancellationRequested || edits.length === 0) return;
            this.editor.applyExternalEdits(edits, "formatOnType");
        } finally {
            listener.dispose();
            this.pending.delete(request);
        }
    }
}

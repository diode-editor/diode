import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/**
 * Counterpart of upstream `AbstractTextEditor.computeConfiguration`, but one object for all surfaces;
 * the owner supplies the list of live surfaces via a callback.
 */
export class TextEditorConfiguration extends Disposable {
    /** Transient Alt+Z state: `null` — the configuration applies (see {@link toggleWordWrap}). */
    private wordWrapSessionOverride: "off" | "on" | null = null;

    public constructor(
        private readonly configurationService: IConfigurationService,
        private readonly surfaces: () => readonly TextEditorPane[],
    ) {
        super();
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("editor")) return;
                this.reapply();
            }),
        );
    }

    public apply(editor: TextEditorPane): void {
        // `"[makefile]": { "editor.insertSpaces": false }` from any layer beats the plain value.
        const overrides = { overrideIdentifier: editor.languageId };
        // "singleFile"/"multiFile" both enable: we only support single-file scope.
        const occurrencesHighlight = this.configurationService.get("editor.occurrencesHighlight", overrides);
        editor.setOccurrenceHighlightEnabled(occurrencesHighlight !== "off");

        editor.setCursorSurroundingLines(this.configurationService.get("editor.cursorSurroundingLines", overrides));
        editor.setScrollbarMarkers(this.configurationService.get("editor.scrollbarMarkers", overrides));

        // Indent config is a baseline, not an order: with `editor.detectIndentation` the file wins. Not
        // `setIndentOptions`: it disables detection, and `get()` returns defaults too — detection would always be off.
        editor.applyIndentConfiguration({
            tabSize: this.configurationService.get("editor.tabSize", overrides),
            insertSpaces: this.configurationService.get("editor.insertSpaces", overrides),
            detectIndentation: this.configurationService.get("editor.detectIndentation", overrides),
        });

        // The Alt+Z session override beats the configuration (transient, as in VS Code).
        editor.setWordWrap(
            this.wordWrapSessionOverride ?? this.configuredWordWrap(overrides),
            this.configurationService.get("editor.wordWrapColumn", overrides),
        );
    }

    /**
     * Overrides the configuration for the session without touching settings.json (VS Code does it per resource —
     * a simplification, docs/TODO/WordWrap.md). Turning wrap on uses the configured mode if there is one, otherwise "on".
     */
    public toggleWordWrap(): void {
        const configured = this.configuredWordWrap();
        const effective = this.wordWrapSessionOverride ?? configured;
        if (effective === "off") {
            this.wordWrapSessionOverride = configured === "off" ? "on" : null;
        } else {
            this.wordWrapSessionOverride = "off";
        }
        this.reapply();
    }

    public reapply(): void {
        for (const editor of this.surfaces()) this.apply(editor);
    }

    /** The service has already replaced invalid settings.json values with the schema default. */
    private configuredWordWrap(overrides?: IConfigurationOverrides): WordWrapMode {
        return this.configurationService.get("editor.wordWrap", overrides);
    }
}

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { toTerminalCursorStyle } from "../../../../editor/common/config/editorCursorStyle.ts";
import type { WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import type { IIndentConfiguration } from "../../../browser/parts/editor/editorComponent.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/**
 * Counterpart of upstream `AbstractTextEditor.computeConfiguration`, but one object for all surfaces;
 * the owner supplies the list of live surfaces via a callback.
 */
export class TextEditorConfiguration extends Disposable {
    /** Transient Alt+Z state: `null` — the configuration applies (see {@link toggleWordWrap}). */
    private wordWrapSessionOverride: "off" | "on" | null = null;
    /** Transient state of the toggle command: `null` — the configuration applies (see {@link toggleInlayHints}). */
    private inlayHintsSessionOverride: boolean | null = null;

    public constructor(
        private readonly configurationService: IConfigurationService,
        private readonly surfaces: () => readonly TextEditorPane[],
        private readonly icons: IProductIconService = NERD_FONT_ICONS,
    ) {
        super();
        this.register(
            icons.onDidChange(() => {
                this.reapply();
            }),
        );
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("editor.inlayHints.enabled")) this.inlayHintsSessionOverride = null;
                if (!event.affectsConfiguration("editor") && !event.affectsConfiguration("diode.editor")) return;
                this.reapply();
            }),
        );
    }

    /** The baseline a pane is built with, so that `apply` right after finds nothing new to detect. */
    public indentConfigurationFor(languageId: string): IIndentConfiguration {
        const overrides = { overrideIdentifier: languageId };
        // Not `setIndentOptions`: it disables detection, and `get()` returns defaults too — detection would always be off.
        return {
            tabSize: this.configurationService.get("editor.tabSize", overrides),
            insertSpaces: this.configurationService.get("editor.insertSpaces", overrides),
            detectIndentation: this.configurationService.get("editor.detectIndentation", overrides),
        };
    }

    public apply(editor: TextEditorPane): void {
        // `"[makefile]": { "editor.insertSpaces": false }` from any layer beats the plain value.
        const overrides = { overrideIdentifier: editor.languageId };
        // "singleFile"/"multiFile" both enable: we only support single-file scope.
        const occurrencesHighlight = this.configurationService.get("editor.occurrencesHighlight", overrides);
        editor.setOccurrenceHighlightEnabled(occurrencesHighlight !== "off");
        editor.setOccurrenceHighlightDelay(
            this.configurationService.get("editor.occurrencesHighlightDelay", overrides),
        );

        this.applyCursorStyle(editor);
        editor.setCursorSurroundingLines(this.configurationService.get("editor.cursorSurroundingLines", overrides));
        editor.setScrollbarMarkers(this.configurationService.get("editor.scrollbarMarkers", overrides));
        editor.setFoldingMaximumRegions(this.configurationService.get("editor.foldingMaximumRegions", overrides));
        editor.setLinksEnabled(this.configurationService.get("editor.links", overrides));
        editor.setColorDecorators({
            enabled: this.configurationService.get("editor.colorDecorators", overrides),
            defaultEnablement: this.configurationService.get("editor.defaultColorDecorators", overrides),
            limit: this.configurationService.get("editor.colorDecoratorsLimit", overrides),
        });
        editor.setInlayHints({
            enabled: this.inlayHintsSessionOverride ?? this.configuredInlayHints(overrides),
            padding: this.configurationService.get("editor.inlayHints.padding", overrides),
            maximumLength: this.configurationService.get("editor.inlayHints.maximumLength", overrides),
            fontStyle: this.configurationService.get("diode.editor.inlayHints.fontStyle", overrides),
        });
        editor.setCodeLens({
            enabled: this.configurationService.get("editor.codeLens", overrides),
            nerdFont: this.icons.nerdFont,
        });
        editor.setNerdFont(this.icons.nerdFont);

        // Indent config is a baseline, not an order: with `editor.detectIndentation` the file wins.
        editor.applyIndentConfiguration(this.indentConfigurationFor(editor.languageId));

        // The Alt+Z session override beats the configuration (transient, as in VS Code).
        editor.setWordWrap(
            this.wordWrapSessionOverride ?? this.configuredWordWrap(overrides),
            this.configurationService.get("editor.wordWrapColumn", overrides),
        );
    }

    /** The extension's override beats the setting; the blinking always comes from the setting. */
    public applyCursorStyle(editor: TextEditorPane): void {
        const overrides = { overrideIdentifier: editor.languageId };
        editor.setCursorStyle(
            toTerminalCursorStyle(
                editor.cursorStyleOverride ?? this.configurationService.get("editor.cursorStyle", overrides),
                this.configurationService.get("editor.cursorBlinking", overrides),
            ),
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

    /**
     * Flips what the active editor shows, in every editor, for the session and without touching settings.json. Back at
     * the configured value the override goes away, so a `[language]` section applies again.
     */
    public toggleInlayHints(languageId: string | undefined): void {
        const configured = this.configuredInlayHints({ overrideIdentifier: languageId });
        const next = !(this.inlayHintsSessionOverride ?? configured);
        this.inlayHintsSessionOverride = next === configured ? null : next;
        this.reapply();
    }

    public reapply(): void {
        for (const editor of this.surfaces()) this.apply(editor);
    }

    /** A terminal does not report key releases: the "pressed" modes stay in their resting state. */
    private configuredInlayHints(overrides?: IConfigurationOverrides): boolean {
        const enabled = this.configurationService.get("editor.inlayHints.enabled", overrides);
        return enabled === "on" || enabled === "onUnlessPressed";
    }

    /** The service has already replaced invalid settings.json values with the schema default. */
    private configuredWordWrap(overrides?: IConfigurationOverrides): WordWrapMode {
        return this.configurationService.get("editor.wordWrap", overrides);
    }
}

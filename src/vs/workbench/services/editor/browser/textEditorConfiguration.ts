import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/**
 * Аналог upstream `AbstractTextEditor.computeConfiguration`, но одним объектом на все поверхности;
 * список живых поверхностей даёт владелец колбэком.
 */
export class TextEditorConfiguration extends Disposable {
    /** Transient-состояние Alt+Z: `null` — действует конфиг (см. {@link toggleWordWrap}). */
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
        // `"[makefile]": { "editor.insertSpaces": false }` из любого слоя бьёт плоское значение.
        const overrides = { overrideIdentifier: editor.languageId };
        // "singleFile"/"multiFile" both enable: we only support single-file scope.
        const occurrencesHighlight = this.configurationService.get("editor.occurrencesHighlight", overrides);
        editor.setOccurrenceHighlightEnabled(occurrencesHighlight !== "off");

        editor.setCursorSurroundingLines(this.configurationService.get("editor.cursorSurroundingLines", overrides));

        // Конфиг отступа — база, а не приказ: при `editor.detectIndentation` главнее файл. Не
        // `setIndentOptions`: тот гасит автоопределение, а `get()` отдаёт и дефолты — детекция глохла бы всегда.
        editor.applyIndentConfiguration({
            tabSize: this.configurationService.get("editor.tabSize", overrides),
            insertSpaces: this.configurationService.get("editor.insertSpaces", overrides),
            detectIndentation: this.configurationService.get("editor.detectIndentation", overrides),
        });

        // Session-override от Alt+Z главнее конфига (transient, как в VS Code).
        editor.setWordWrap(
            this.wordWrapSessionOverride ?? this.configuredWordWrap(overrides),
            this.configurationService.get("editor.wordWrapColumn", overrides),
        );
    }

    /**
     * Поверх конфига на сессию, settings.json не трогаем (у VS Code per-resource — упрощение,
     * docs/TODO/WordWrap.md). Выключенный перенос включается конфигурным режимом, если он есть, иначе "on".
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

    /** Мусор из settings.json сервис уже заменил дефолтом схемы. */
    private configuredWordWrap(overrides?: IConfigurationOverrides): WordWrapMode {
        return this.configurationService.get("editor.wordWrap", overrides);
    }
}

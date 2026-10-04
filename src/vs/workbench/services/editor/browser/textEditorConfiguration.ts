import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { WordWrapMode } from "../../../../editor/common/viewModel/editorViewState.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";

/**
 * Применение `editor.*`-настроек к текстовым поверхностям — аналог
 * `AbstractTextEditor.computeConfiguration` у upstream, но одним объектом на
 * все поверхности, а не в каждой панели. Новую поверхность настраивает
 * {@link apply}; живые — live-reload по `onDidChangeConfiguration` и Alt+Z
 * ({@link toggleWordWrap}).
 *
 * Список живых поверхностей даёт владелец (`EditorService`) колбэком: группы,
 * вкладки и стороны диффов — его знание, а не этого класса.
 */
export class TextEditorConfiguration extends Disposable {
    /** Transient-состояние Alt+Z: `null` — действует конфиг (см. {@link toggleWordWrap}). */
    private wordWrapSessionOverride: "off" | "on" | null = null;

    public constructor(
        private readonly configurationService: IConfigurationService,
        private readonly surfaces: () => readonly TextEditorPane[],
    ) {
        super();
        // Live-reload: при изменении `editor.*` настроек перепримeняем их ко всем
        // открытым редакторам (не только к вновь создаваемым).
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("editor")) return;
                this.reapply();
            }),
        );
    }

    /**
     * Применяет к редактору настройки из `IConfigurationService`
     * (`editor.cursorSurroundingLines`, `editor.tabSize`, `editor.insertSpaces`,
     * `editor.detectIndentation`, перенос строк, подсветка вхождений). Значения
     * всегда есть — дефолты реестра.
     */
    public apply(editor: TextEditorPane): void {
        // Значения — для языка документа: `"[makefile]": { "editor.insertSpaces": false }`
        // из любого слоя (и из configurationDefaults расширения) бьёт плоское значение.
        const overrides = { overrideIdentifier: editor.languageId };
        // `editor.occurrencesHighlight`: "off" disables; "singleFile"/"multiFile"
        // enable. We only support single-file scope.
        const occurrencesHighlight = this.configurationService.get("editor.occurrencesHighlight", overrides);
        editor.setOccurrenceHighlightEnabled(occurrencesHighlight !== "off");

        editor.setCursorSurroundingLines(this.configurationService.get("editor.cursorSurroundingLines", overrides));

        // Отступ: конфиг — это БАЗА, а не приказ. При включённом
        // `editor.detectIndentation` (дефолт) содержимое файла главнее, как в
        // VS Code; иначе действуют tabSize/insertSpaces из настроек. Раньше
        // здесь стоял `setIndentOptions` — дверь для расширений, которая гасит
        // автоопределение; поскольку `get()` отдаёт и дефолты реестра (4/true),
        // детекция глохла на каждом открытом файле.
        editor.applyIndentConfiguration({
            tabSize: this.configurationService.get("editor.tabSize", overrides),
            insertSpaces: this.configurationService.get("editor.insertSpaces", overrides),
            detectIndentation: this.configurationService.get("editor.detectIndentation", overrides),
        });

        // Session-override от Alt+Z главнее конфига (transient, как в VS Code);
        // мусорное значение из settings.json деградирует к "off".
        editor.setWordWrap(
            this.wordWrapSessionOverride ?? this.configuredWordWrap(overrides),
            this.configurationService.get("editor.wordWrapColumn", overrides),
        );
    }

    /**
     * Transient-переключение Alt+Z: поверх конфига на время сессии, settings.json
     * не трогаем (VS Code хранит per-resource transient state — у нас упрощение
     * до session-global, см. docs/TODO/WordWrap.md). Выключенный перенос
     * включается конфигурным режимом, если он есть, иначе — "on".
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
     * Переприменяет настройки ко всем живым поверхностям — правка настроек,
     * Alt+Z, смена языка документа (`"[lang]"`-секции читаются для нового языка).
     */
    public reapply(): void {
        for (const editor of this.surfaces()) this.apply(editor);
    }

    /** `editor.wordWrap` из конфига (мусор из settings.json сервис уже заменил дефолтом схемы). */
    private configuredWordWrap(overrides?: IConfigurationOverrides): WordWrapMode {
        return this.configurationService.get("editor.wordWrap", overrides);
    }
}

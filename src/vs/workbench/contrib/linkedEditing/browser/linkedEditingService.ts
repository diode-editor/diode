import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type ILanguageConfigurationService,
    LanguageConfigurationServiceDIToken,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { FeatureDebounce } from "../../../../editor/common/services/languageFeatureDebounce.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { LinkedEditingController } from "../../../../editor/contrib/linkedEditing/browser/linkedEditingController.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";

export const LinkedEditingServiceDIToken = token<LinkedEditingService>("LinkedEditingService");

/** Upstream's defaults of `languageFeatureDebounceService.for`, with its `{ max: 200 }`. */
const DEBOUNCE_MIN_MS = 50;
const DEBOUNCE_MAX_MS = 200;

/** Keeps one {@link LinkedEditingController} on the active text editor. */
export class LinkedEditingService extends Disposable {
    public static dependencies = [
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
        LanguageConfigurationServiceDIToken,
    ] as const;

    private controller: LinkedEditingController | null = null;
    private readonly debounce = new FeatureDebounce(DEBOUNCE_MIN_MS, DEBOUNCE_MAX_MS);

    public constructor(
        group: IEditorService,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly configuration: IConfigurationService,
        private readonly languageConfiguration: ILanguageConfigurationService,
    ) {
        super();
        this.register(
            bindActiveEditor(group, (editor, store) => {
                this.controller = null;
                if (editor === null) return;
                const controller = store.add(
                    new LinkedEditingController(editor, {
                        providers: this.languageFeatures.linkedEditingRangeProvider,
                        isSettingEnabled: () =>
                            this.configuration.get("editor.linkedEditing", { overrideIdentifier: editor.languageId }),
                        languageWordPattern: (languageId) => this.languageConfiguration.get(languageId)?.wordPattern,
                        debounce: this.debounce,
                    }),
                );
                this.controller = controller;
                void this.languageConfiguration.ensureLoaded(editor.languageId);
                store.add(
                    editor.onDidChangeLanguage(() => {
                        void this.languageConfiguration.ensureLoaded(editor.languageId);
                        controller.reinitialize(true);
                    }),
                );
            }),
        );
        this.register(
            languageFeatures.linkedEditingRangeProvider.onDidChange(() => {
                this.controller?.reinitialize(false);
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("editor.linkedEditing")) this.controller?.reinitialize(false);
            }),
        );
    }

    /** `editor.action.linkedEditing`. */
    public start(): Promise<void> {
        return this.controller?.updateRanges(true) ?? Promise.resolve();
    }

    /** `cancelLinkedEditingInput`. */
    public cancel(): void {
        this.controller?.clearRanges();
    }
}

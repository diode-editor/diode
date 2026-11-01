import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { FormatOnTypeController } from "../../../../editor/contrib/format/browser/formatOnType.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";

export const FormatOnTypeServiceDIToken = token<FormatOnTypeService>("FormatOnTypeService");

/** Keeps one {@link FormatOnTypeController} on the active text editor. */
export class FormatOnTypeService extends Disposable {
    public static dependencies = [
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    public constructor(
        group: IEditorService,
        languageFeatures: ILanguageFeaturesService,
        configuration: IConfigurationService,
    ) {
        super();
        this.register(
            bindActiveEditor(group, (editor, store) => {
                if (editor === null) return;
                store.add(
                    new FormatOnTypeController(editor, {
                        providers: languageFeatures.onTypeFormattingEditProvider,
                        isSettingEnabled: () =>
                            configuration.get("editor.formatOnType", { overrideIdentifier: editor.languageId }),
                    }),
                );
            }),
        );
    }
}

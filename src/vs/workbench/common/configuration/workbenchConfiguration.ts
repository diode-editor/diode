import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../../services/themes/common/themes/builtinThemes.ts";

export const workbenchConfiguration = {
    id: "workbench",
    title: "Workbench",
    properties: {
        // Активная цветовая тема по имени (label из ThemeRegistry). Дефолт совпадает
        // с out-of-the-box VS Code. Допустимые значения (enum встроенных тем) в
        // каталог автодополнения дописывает генератор схемы — из ThemeRegistry,
        // не отсюда.
        "workbench.colorTheme": {
            scope: "window",
            type: "string",
            default: DEFAULT_COLOR_THEME,
            description: "Specifies the color theme used in the workbench.",
        },
        // Режим предпросмотра вкладок: в группе не больше одной preview-вкладки,
        // и следующее превью её ЗАМЕЩАЕТ. Открытие превью сейчас делает только
        // дерево Explorer — как в эталоне, где `enablePreviewFromQuickOpen` и
        // `enablePreviewFromCodeNavigation` по умолчанию выключены.
        "workbench.editor.enablePreview": {
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Controls whether preview mode is used when editors open. There is a maximum of one preview " +
                "mode editor per editor group. Its contents will be replaced by the next editor opened in " +
                "preview mode. Making a change in a preview mode editor will persist it, as will the " +
                "'Keep Open' option in its tab context menu.",
        },
    },
} as const satisfies IConfigurationNode;

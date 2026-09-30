import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";
import { DEFAULT_COLOR_THEME } from "../../services/themes/common/themes/builtinThemes.ts";

export const workbenchConfiguration: IConfigurationNode = {
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
    },
};

import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import type { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { createBuiltinThemeRegistry, ThemeRegistry } from "../../workbench/services/themes/common/themeRegistry.ts";
import { ThemeService } from "../../workbench/services/themes/common/themeService.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../../workbench/services/themes/common/themeTokens.ts";

export interface ThemeModuleContext {
    theme: WorkbenchTheme;
    /** Registry of selectable themes (built-in + future extension-contributed). */
    themeRegistry?: ThemeRegistry;
}

/**
 * Регистрирует `ThemeService` с переданной темой и `ThemeRegistry` с набором
 * доступных для выбора тем. Тему конструирует вызывающая сторона (production —
 * из VS Code-совместимого файла по `workbench.colorTheme`, тесты — `darkPlusTheme`
 * по умолчанию). Реестр по умолчанию — все встроенные темы.
 */
export const themeModule: ContainerModule<ThemeModuleContext> = (container, { theme, themeRegistry }) => {
    const registry = themeRegistry ?? createBuiltinThemeRegistry();
    container.bind(ThemeServiceDIToken, () => new ThemeService(theme));
    container.bind(ThemeRegistryDIToken, () => registry);
};

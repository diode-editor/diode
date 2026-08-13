import { Disposable } from "@tuidom/all/common/disposable";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { ThemeRegistry } from "../../../services/themes/common/themeRegistry.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

export const ThemeConfigContributionDIToken = token<ThemeConfigContribution>("ThemeConfigContribution");

/**
 * Live-reload цветовой темы: смена `workbench.colorTheme` в settings.json
 * перекрашивает UI без рестарта. Подписка на конфиг → резолв темы по имени →
 * `ThemeService.setTheme` (дёрнет `onThemeChange` у всех подписчиков).
 */
export class ThemeConfigContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [IConfigurationServiceDIToken, ThemeServiceDIToken, ThemeRegistryDIToken] as const;

    public constructor(
        private readonly configurationService: IConfigurationService,
        private readonly themeService: ThemeService,
        private readonly themeRegistry: ThemeRegistry,
    ) {
        super();
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration("workbench.colorTheme")) return;
                this.applyColorThemeFromConfiguration();
            }),
        );
    }

    /**
     * Резолвит тему по имени из `workbench.colorTheme` и применяет её. Guard по
     * имени: если тема уже активна (напр. правку внёс сам theme-picker через
     * `updateUserValue`), лишнего перекраса не делаем. Неизвестное имя игнорируем.
     */
    private applyColorThemeFromConfiguration(): void {
        const name = this.configurationService.get<string>("workbench.colorTheme");
        if (name === undefined) return;
        if (name === this.themeService.theme.name) return;
        const theme = this.themeRegistry.resolve(name);
        if (theme) this.themeService.setTheme(theme);
    }
}

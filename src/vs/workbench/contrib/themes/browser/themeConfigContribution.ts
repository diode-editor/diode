import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { ThemeRegistry } from "../../../services/themes/common/themeRegistry.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

export const ThemeConfigContributionDIToken = token<ThemeConfigContribution>("ThemeConfigContribution");

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

    /** Уже активную тему (правку внёс сам theme-picker) не перекрашиваем; неизвестное имя игнорируем. */
    private applyColorThemeFromConfiguration(): void {
        const name = this.configurationService.get("workbench.colorTheme");
        if (name === this.themeService.theme.name) return;
        const theme = this.themeRegistry.resolve(name);
        if (theme) this.themeService.setTheme(theme);
    }
}

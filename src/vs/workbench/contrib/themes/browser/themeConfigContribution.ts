import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { HostColorSchemeService } from "../../../services/themes/browser/hostColorSchemeService.ts";
import { HostColorSchemeServiceDIToken } from "../../../services/themes/browser/hostColorSchemeService.ts";
import {
    AUTO_DETECT_COLOR_SCHEME_SETTING,
    COLOR_THEME_SETTING_IDS,
    getColorThemeSettingId,
} from "../../../services/themes/common/themeConfiguration.ts";
import type { ThemeRegistry } from "../../../services/themes/common/themeRegistry.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeRegistryDIToken, ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

export const ThemeConfigContributionDIToken = token<ThemeConfigContribution>("ThemeConfigContribution");

export class ThemeConfigContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        IConfigurationServiceDIToken,
        ThemeServiceDIToken,
        ThemeRegistryDIToken,
        HostColorSchemeServiceDIToken,
    ] as const;

    public constructor(
        private readonly configurationService: IConfigurationService,
        private readonly themeService: ThemeService,
        private readonly themeRegistry: ThemeRegistry,
        private readonly hostColorScheme: HostColorSchemeService,
    ) {
        super();
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                const affectsTheme =
                    event.affectsConfiguration(AUTO_DETECT_COLOR_SCHEME_SETTING) ||
                    COLOR_THEME_SETTING_IDS.some((id) => event.affectsConfiguration(id));
                if (affectsTheme) this.applyColorThemeFromConfiguration();
            }),
        );
        this.register(
            this.hostColorScheme.onDidChangeColorScheme(() => {
                this.applyColorThemeFromConfiguration();
            }),
        );
    }

    /** Don't recolor to the already active theme (the edit came from the theme picker itself); ignore unknown names. */
    private applyColorThemeFromConfiguration(): void {
        const settingId = getColorThemeSettingId(this.configurationService, this.hostColorScheme.colorScheme);
        const name = this.configurationService.get(settingId);
        if (name === this.themeService.theme.name) return;
        const theme = this.themeRegistry.resolve(name);
        if (theme) this.themeService.setTheme(theme);
    }
}

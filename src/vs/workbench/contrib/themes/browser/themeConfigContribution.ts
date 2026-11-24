import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { HostColorSchemeService } from "../../../services/themes/browser/hostColorSchemeService.ts";
import { HostColorSchemeServiceDIToken } from "../../../services/themes/browser/hostColorSchemeService.ts";
import {
    COLOR_CUSTOMIZATIONS_SETTING,
    colorCustomizationProblems,
} from "../../../services/themes/common/colorCustomizations.ts";
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
        ILogServiceDIToken,
    ] as const;

    private readonly logger: ILogger;

    public constructor(
        private readonly configurationService: IConfigurationService,
        private readonly themeService: ThemeService,
        private readonly themeRegistry: ThemeRegistry,
        private readonly hostColorScheme: HostColorSchemeService,
        logService: ILogService,
    ) {
        super();
        this.logger = logService.createLogger("configuration");
        // main.ts has handed the value to the registry before the first frame; its problems are reported here.
        this.reportColorCustomizationProblems();
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                // One settings.json save may change both the theme and the customizations.
                const affectsColors = event.affectsConfiguration(COLOR_CUSTOMIZATIONS_SETTING);
                if (affectsColors) {
                    this.themeRegistry.setColorCustomizations(
                        this.configurationService.get(COLOR_CUSTOMIZATIONS_SETTING),
                    );
                    this.reportColorCustomizationProblems();
                }
                const affectsTheme =
                    affectsColors ||
                    event.affectsConfiguration(AUTO_DETECT_COLOR_SCHEME_SETTING) ||
                    COLOR_THEME_SETTING_IDS.some((id) => event.affectsConfiguration(id));
                if (affectsTheme) this.applyColorThemeFromConfiguration(affectsColors);
            }),
        );
        this.register(
            this.hostColorScheme.onDidChangeColorScheme(() => {
                this.applyColorThemeFromConfiguration();
            }),
        );
    }

    private reportColorCustomizationProblems(): void {
        for (const problem of colorCustomizationProblems(this.configurationService.get(COLOR_CUSTOMIZATIONS_SETTING))) {
            this.logger.warn(problem);
        }
    }

    /**
     * Don't recolor to the already active theme (the edit came from the theme picker itself); ignore unknown names.
     * New customizations repaint anyway: the configured theme, or the active one when the configured is unknown.
     */
    private applyColorThemeFromConfiguration(colorsChanged = false): void {
        const settingId = getColorThemeSettingId(this.configurationService, this.hostColorScheme.colorScheme);
        const name = this.configurationService.get(settingId);
        if (!colorsChanged && name === this.themeService.theme.name) return;
        const theme =
            this.themeRegistry.resolve(name) ??
            (colorsChanged ? this.themeRegistry.resolve(this.themeService.theme.name) : undefined);
        if (theme) this.themeService.setTheme(theme);
    }
}

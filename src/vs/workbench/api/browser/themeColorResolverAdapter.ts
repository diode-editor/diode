import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IWorkbenchColors } from "../../../platform/theme/common/colors/colorContributions.ts";
import type { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import type { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IThemeColorResolver } from "../common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../common/vscodeTypes.ts";

export function colorThemeKindOf(type: WorkbenchTheme["type"]): ColorThemeKind {
    switch (type) {
        case "light":
            return ColorThemeKind.Light;
        case "hc":
            return ColorThemeKind.HighContrast;
        case "hcLight":
            return ColorThemeKind.HighContrastLight;
        case "dark":
            return ColorThemeKind.Dark;
    }
}

export class ThemeColorResolverAdapter implements IThemeColorResolver {
    private readonly themeService: ThemeService;

    public constructor(themeService: ThemeService) {
        this.themeService = themeService;
    }

    public resolve(id: string): number | undefined {
        return this.themeService.theme.getColor(id as keyof IWorkbenchColors);
    }

    public kind(): ColorThemeKind {
        return colorThemeKindOf(this.themeService.theme.type);
    }

    public onDidChange(cb: () => void): IDisposable {
        let seededInitial = false;
        return this.themeService.onThemeChange(() => {
            // ThemeService.onThemeChange вызывает слушателя сразу с текущей темой —
            // это не «смена», проглатываем первый вызов.
            if (!seededInitial) {
                seededInitial = true;
                return;
            }
            cb();
        });
    }
}

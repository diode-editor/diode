import type { IDisposable } from "@tuidom/core/common/disposable";

import type { IWorkbenchColors } from "../../../platform/theme/common/colors/colorContributions.ts";
import type { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import type { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IThemeColorResolver } from "../common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../common/vscodeTypes.ts";

/**
 * Вид темы для расширения: `WorkbenchTheme.type` → `vscode.ColorThemeKind`.
 * Экспортирован ради теста маппинга — все четыре вида темы у нас есть, и
 * промах здесь расширение видит как «не та тема» (иконки/цвета под тёмную на
 * светлой).
 */
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

/**
 * Реализация {@link IThemeColorResolver} поверх {@link ThemeService}. Живёт в
 * слое Extensions (Theme ничего не знает про host).
 *
 * `resolve` читает цвет активной темы по id (`theme.getColor`); неизвестный id
 * (или цвет без дефолта в реестре) → `undefined`. `kind` отдаёт вид активной
 * темы для `window.activeColorTheme`. `onDidChange` подписывается на смену темы,
 * гася немедленный синхронный вызов `onThemeChange` (нам нужен только *переход*,
 * чтобы пере-резолвить держимые декорации и разослать расширениям новую тему).
 */
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

import type { IDisposable } from "@tuidom/all/common/disposable";
import type { IWorkbenchColors } from "../../../platform/theme/common/colors/colorContributions.ts";
import type { ThemeService } from "../../services/themes/common/themeService.ts";
import type { IThemeColorResolver } from "../common/iThemeColorResolver.ts";

/**
 * Реализация {@link IThemeColorResolver} поверх {@link ThemeService}. Живёт в
 * слое Extensions (Theme ничего не знает про host).
 *
 * `resolve` читает цвет активной темы по id (`theme.getColor`); неизвестный id
 * (или цвет без дефолта в реестре) → `undefined`. `onDidChange` подписывается на
 * смену темы, гася немедленный синхронный вызов `onThemeChange` (нам нужен только
 * *переход*, чтобы пере-резолвить держимые декорации).
 */
export class ThemeColorResolverAdapter implements IThemeColorResolver {
    private readonly themeService: ThemeService;

    public constructor(themeService: ThemeService) {
        this.themeService = themeService;
    }

    public resolve(id: string): number | undefined {
        return this.themeService.theme.getColor(id as keyof IWorkbenchColors);
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

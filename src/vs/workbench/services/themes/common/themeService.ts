import type { IDisposable } from "@tuidom/core/common/disposable";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

export class ThemeService {
    private currentTheme: WorkbenchTheme;
    private listeners: ((theme: WorkbenchTheme) => void)[] = [];

    public constructor(initialTheme: WorkbenchTheme) {
        this.currentTheme = initialTheme;
    }

    public get theme(): WorkbenchTheme {
        return this.currentTheme;
    }

    public setTheme(theme: WorkbenchTheme): void {
        this.currentTheme = theme;
        for (const listener of this.listeners) {
            listener(theme);
        }
    }

    /**
     * Subscribe to theme changes. The listener is called immediately
     * with the current theme and then on every subsequent change.
     * Returns a disposable to unsubscribe.
     */
    public onThemeChange(listener: (theme: WorkbenchTheme) => void): IDisposable {
        this.listeners.push(listener);
        listener(this.currentTheme);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index >= 0) this.listeners.splice(index, 1);
            },
        };
    }
}

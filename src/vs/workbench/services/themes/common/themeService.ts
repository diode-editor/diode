import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

export class ThemeService {
    private currentTheme: WorkbenchTheme;
    private readonly onDidChangeThemeEmitter = new Emitter<WorkbenchTheme>();

    public constructor(initialTheme: WorkbenchTheme) {
        this.currentTheme = initialTheme;
    }

    public get theme(): WorkbenchTheme {
        return this.currentTheme;
    }

    public setTheme(theme: WorkbenchTheme): void {
        this.currentTheme = theme;
        this.onDidChangeThemeEmitter.fire(theme);
    }

    /**
     * Subscribe to theme changes. The listener is called immediately
     * with the current theme and then on every subsequent change.
     * Returns a disposable to unsubscribe.
     */
    public onThemeChange(listener: (theme: WorkbenchTheme) => void): IDisposable {
        const subscription = this.onDidChangeThemeEmitter.event(listener);
        listener(this.currentTheme);
        return subscription;
    }
}

import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";

/**
 * Upstream `SashSettingsController`: `workbench.sash.hoverDelay` applies to every sash, live —
 * `apply` runs now and on every change of the setting.
 */
export function bindSashHoverDelay(configuration: IConfigurationService, apply: (ms: number) => void): IDisposable {
    apply(configuration.get("workbench.sash.hoverDelay"));
    return configuration.onDidChangeConfiguration((event) => {
        // Stryker disable next-line ConditionalExpression: equivalent — re-applying the unchanged delay on another key's change is a no-op
        if (event.affectsConfiguration("workbench.sash.hoverDelay"))
            apply(configuration.get("workbench.sash.hoverDelay"));
    });
}

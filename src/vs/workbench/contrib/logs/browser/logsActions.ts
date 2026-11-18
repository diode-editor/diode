import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

/** Upstream's order and `LogLevelToLocalizedString` labels. */
const LEVELS: readonly (readonly [LogLevel, string])[] = [
    [LogLevel.Trace, "Trace"],
    [LogLevel.Debug, "Debug"],
    [LogLevel.Info, "Info"],
    [LogLevel.Warn, "Warning"],
    [LogLevel.Error, "Error"],
    [LogLevel.Off, "Off"],
];

/** Upstream `DefaultLogLevelsService` without `argv.json`: the window starts at Info unless `--log` says otherwise. */
const DEFAULT_LEVEL = LogLevel.Info;

/**
 * Upstream `SetLogLevelAction` with only the "All" section: the level of every channel at once, as `--log <level>`,
 * and of `env.logLevel` in every extension host. Per-channel sections and "Set as Default Log Level" are not here.
 */
export const setLogLevelAction: CommandAction = {
    id: "workbench.action.setLogLevel",
    title: "Developer: Set Log Level...",
    shortTitle: "Set Log Level...",
    async run(accessor) {
        const logService = accessor.get(ILogServiceDIToken);
        const icons = accessor.get(ProductIconServiceDIToken);
        const current = logService.getWindowLevel();
        const items: QuickPickItem[] = LEVELS.map(([level, label], index) => ({
            label: level === current ? `${icons.codicon("check")} ${label}` : label,
            ...(level === DEFAULT_LEVEL ? { description: "Default" } : {}),
            // The separator label goes on its group's first row.
            ...(index === 0 ? { hint: "All" } : {}),
        }));
        const picked = await accessor.get(QuickInputServiceDIToken).quickPick({ placeholder: "Set Log Level", items });
        if (picked === undefined) return;
        logService.setLevel("*", LEVELS[items.indexOf(picked)][0]);
    },
};

export const LOGS_ACTIONS: readonly CommandAction[] = [setLogLevelAction];

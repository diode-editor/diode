import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingResolution } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { DEFAULT_COMMANDS_TO_SKIP_SHELL } from "../../../common/configuration/terminalCommandsToSkipShell.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import type { KeybindingDispatcher } from "../../../services/keybinding/browser/keybindingDispatcher.ts";
import { KeybindingDispatcherDIToken } from "../../../services/keybinding/browser/keybindingDispatcher.ts";

export const TerminalKeyRoutingDIToken = token<TerminalKeyRouting>("TerminalKeyRouting");

/**
 * Ours on top of upstream's set: there F6 is `workbench.action.focusNextPart` (in the set), which reaches the
 * notification toasts among the parts; here F6 is `notifications.focusMessage`, the only keyboard path to an
 * asking toast, so it keeps the same place.
 */
const DIODE_COMMANDS_TO_SKIP_SHELL: readonly string[] = ["notifications.focusMessage"];

const DEFAULT_SKIP_SHELL: ReadonlySet<string> = new Set([
    ...DEFAULT_COMMANDS_TO_SKIP_SHELL,
    ...DIODE_COMMANDS_TO_SKIP_SHELL,
]);

/**
 * Upstream `_updateConfig` + `shouldCommandSkipShell`: the defaults, then the user's entries in order —
 * `-<id>` removes a command, `<id>` adds one. Our schema has no `items: string`: other values never match.
 */
export function shouldCommandSkipShell(commandId: string, commandsToSkipShell: readonly unknown[]): boolean {
    let skip = DEFAULT_SKIP_SHELL.has(commandId);
    for (const command of commandsToSkipShell) {
        if (command === commandId) skip = true;
        else if (command === `-${commandId}`) skip = false;
    }
    return skip;
}

/**
 * With the terminal focused (panel or editor) the key is the shell's; the workbench keeps only chords,
 * the skip set and keys the terminal doesn't encode — upstream's `attachCustomKeyEventHandler`
 * (`terminalInstance.ts`). Settings are read on every key: they apply without restarting the terminal.
 */
export class TerminalKeyRouting extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        KeybindingDispatcherDIToken,
        IConfigurationServiceDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    public constructor(
        dispatcher: KeybindingDispatcher,
        private readonly configuration: IConfigurationService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        dispatcher.isKeyForFocusedWidget = (event, resolution) => this.isKeyForShell(event, resolution);
    }

    private isKeyForShell(event: TUIKeyboardEvent, resolution: KeybindingResolution): boolean {
        if (!(event.target instanceof TerminalViewElement)) return false;
        // Escape never starts a chord here: it matters to the shell (and to Zen Mode's Escape Escape upstream).
        if (
            resolution.kind === "chord" &&
            this.configuration.get("terminal.integrated.allowChords") &&
            event.key !== "Escape"
        ) {
            return false;
        }
        if (
            !this.configuration.get("terminal.integrated.sendKeybindingsToShell") &&
            // Stryker disable next-line ConditionalExpression: `true` is equivalent — an unbound Meta key left to the workbench runs nothing, the terminal's default action still writes it and mnemonics ignore Meta; `false` is killed by the skip-set tests (Ctrl+P)
            resolution.kind === "command" &&
            (event.metaKey ||
                shouldCommandSkipShell(
                    resolution.commandId,
                    this.configuration.get("terminal.integrated.commandsToSkipShell"),
                ))
        ) {
            return false;
        }
        if (
            this.configuration.get("terminal.integrated.allowMnemonics") &&
            this.contextKeys.get("isMac") !== true &&
            event.altKey
        ) {
            return false;
        }
        // Ours: no xterm.js. A key the terminal can't encode (Ctrl+, , Ctrl+Shift+letter) goes back to the
        // workbench, the way xterm.js leaves it unhandled and it bubbles.
        return event.target.encodeKey(event) !== "";
    }
}

import type { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { encodeKeyForPty } from "@tuidom/elements/terminal/encodeKeyForPty";
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

/** Upstream `_updateConfig`: `-<id>` removes a default, `<id>` adds one. Our schema has no `items: string`. */
export function computeCommandsToSkipShell(commandsToSkipShell: readonly unknown[]): Set<string> {
    const skip = new Set(DEFAULT_COMMANDS_TO_SKIP_SHELL);
    for (const command of commandsToSkipShell) {
        if (typeof command !== "string") continue;
        if (command.startsWith("-")) skip.delete(command.slice(1));
        else skip.add(command);
    }
    return skip;
}

/**
 * With the terminal focused (panel or editor) the key is the shell's; the workbench keeps only chords,
 * the skip set and keys the terminal doesn't encode — upstream's `attachCustomKeyEventHandler`
 * (`terminalInstance.ts`). The settings apply on the fly, without restarting the terminal.
 */
export class TerminalKeyRouting extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        KeybindingDispatcherDIToken,
        IConfigurationServiceDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    private skipShell: Set<string> | null = null;

    public constructor(
        dispatcher: KeybindingDispatcher,
        private readonly configuration: IConfigurationService,
        private readonly contextKeys: ContextKeyService,
    ) {
        super();
        dispatcher.isKeyForFocusedWidget = (event, resolution) => this.isKeyForShell(event, resolution);
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("terminal.integrated.commandsToSkipShell")) this.skipShell = null;
            }),
        );
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
            resolution.kind === "command" &&
            (event.metaKey || this.commandsToSkipShell().has(resolution.commandId))
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
        return encodeKeyForPty(event) !== "";
    }

    private commandsToSkipShell(): Set<string> {
        this.skipShell ??= computeCommandsToSkipShell(
            this.configuration.get("terminal.integrated.commandsToSkipShell"),
        );
        return this.skipShell;
    }
}

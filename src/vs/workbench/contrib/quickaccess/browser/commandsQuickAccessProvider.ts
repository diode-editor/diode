import type { FuzzyMatch } from "../../../../base/common/fuzzySearch.ts";
import { fuzzyMatchPrepared, prepareQuery } from "../../../../base/common/fuzzySearch.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { commandPaletteLabel, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    formatKeybinding,
    keybindingLabelStyle,
    KeybindingRegistryDIToken,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { toMatchRanges } from "./pathMatchRanges.ts";

export const CommandsQuickAccessProviderDIToken = token<CommandsQuickAccessProvider>("CommandsQuickAccessProvider");

interface MatchedCommand {
    readonly id: string;
    readonly label: string;
    readonly match: FuzzyMatch;
}

/**
 * Подпись — `category: title`, как в VS Code; фильтр по ней — `prepareQuery` файлового пикера.
 * Сортировка стабильная: у пустого запроса остаётся порядок реестра.
 */
export class CommandsQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = ">";

    public static dependencies = [CommandRegistryDIToken, KeybindingRegistryDIToken, ContextKeyServiceDIToken] as const;

    public constructor(
        private readonly commands: CommandRegistry,
        private readonly keybindings: KeybindingRegistry,
        private readonly contextKeys: ContextKeyService,
    ) {}

    public getPlaceholder(): string {
        return "Show All Commands";
    }

    public getItems(query: string): QuickAccessItem[] {
        const prepared = prepareQuery(query.slice(CommandsQuickAccessProvider.PREFIX.length));
        // Недоступную команду не показываем, как VS Code (`precondition` уезжает в `when`
        // пункта палитры): гасить пункт на месте мы не умеем.
        const all = this.commands
            .listCommands()
            .filter((cmd) => cmd.enablement === undefined || this.contextKeys.evaluate(cmd.enablement));

        const matched = all.flatMap((cmd): MatchedCommand[] => {
            const label = commandPaletteLabel(cmd);
            const match = fuzzyMatchPrepared(prepared, label);
            return match === null ? [] : [{ id: cmd.id, label, match }];
        });
        matched.sort((a, b) => b.match.score - a.match.score);

        return matched.map(({ id, label, match }): QuickAccessItem => {
            const chord = this.keybindings.getKeybindingForCommand(id, this.contextKeys);
            return {
                label,
                labelMatchRanges: toMatchRanges(match.matchedIndices),
                shortcut: chord ? formatKeybinding(chord, keybindingLabelStyle(this.contextKeys)) : undefined,
                accept: () => {
                    this.commands.execute(id);
                },
            };
        });
    }
}

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

export const CommandsQuickAccessProviderDIToken = token<CommandsQuickAccessProvider>("CommandsQuickAccessProvider");

/**
 * Command palette (`>`): команды с заголовками из {@link CommandRegistry},
 * фильтр по подстроке подписи (case-insensitive), шорткат — актуальный кейбинд
 * команды в текущем контексте.
 *
 * Подпись — `category: title` ({@link commandPaletteLabel}), как в VS Code:
 * «Java: Switch to Standard Mode». Фильтр идёт по ней же, то есть набранное
 * `java` находит все команды группы Java.
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
        const filter = query.slice(CommandsQuickAccessProvider.PREFIX.length).trimStart();
        // Недоступную сейчас команду не показываем вовсе — так же поступает
        // VS Code: `precondition` уезжает в `when` пункта палитры. Гасить пункт
        // на месте мы не умеем, а показывать неработающий — хуже, чем не
        // показывать (исполнить его всё равно не даст guard самой команды).
        const all = this.commands
            .listCommands()
            .filter((cmd) => cmd.enablement === undefined || this.contextKeys.evaluate(cmd.enablement));
        const filterLower = filter.toLowerCase();

        // Отдельной ветки под пустой запрос нет: `includes("")` истинно для
        // любой подписи, то есть фильтр сам отдаёт весь список.
        const matched = all
            .map((cmd) => ({ cmd, label: commandPaletteLabel(cmd) }))
            .filter((e) => e.label.toLowerCase().includes(filterLower));

        return matched.map(({ cmd, label }): QuickAccessItem => {
            const chord = this.keybindings.getKeybindingForCommand(cmd.id, this.contextKeys);
            return {
                label,
                shortcut: chord ? formatKeybinding(chord, keybindingLabelStyle(this.contextKeys)) : undefined,
                accept: () => {
                    this.commands.execute(cmd.id);
                },
            };
        });
    }
}

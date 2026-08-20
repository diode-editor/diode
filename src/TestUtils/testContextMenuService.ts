import type { MenuContribution } from "../vs/platform/actions/common/iMenuContribution.ts";
import { MenuRegistry } from "../vs/platform/actions/common/menuRegistry.ts";
import { MenuService } from "../vs/platform/actions/common/menuService.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../vs/platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../vs/platform/keybinding/common/keybindingRegistry.ts";

/**
 * `ContextMenuService` для тестов: по умолчанию с пустым реестром (тестам,
 * которым сервис нужен как зависимость, а не как меню), либо со своими
 * вкладами и командами — тогда меню собирается по-настоящему. Классы plain
 * (DI.md), поэтому собирается напрямую.
 */
export function createTestContextMenuService(
    options: { commands?: CommandRegistry; contributions?: readonly MenuContribution[] } = {},
): ContextMenuService {
    const commands = options.commands ?? new CommandRegistry();
    const registry = new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), [
        ...(options.contributions ?? []),
    ]);
    return new ContextMenuService(new MenuService(registry));
}

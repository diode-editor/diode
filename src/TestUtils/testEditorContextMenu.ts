import { ContextMenuController } from "../vs/editor/contrib/contextmenu/browser/contextMenuController.ts";
import { MenuRegistry } from "../vs/platform/actions/common/menuRegistry.ts";
import { MenuService } from "../vs/platform/actions/common/menuService.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../vs/platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../vs/platform/keybinding/common/keybindingRegistry.ts";

/**
 * Editor-контроллер контекстного меню для тестов, которым нужен EditorService,
 * а не меню: пустой реестр пунктов, NULL-конфигурация. Классы plain (DI.md),
 * поэтому собирается напрямую.
 */
export function createTestEditorContextMenuController(): ContextMenuController {
    const menuService = new MenuService(
        new MenuRegistry(new CommandRegistry(), new KeybindingRegistry(), new ContextKeyService(), []),
    );
    return new ContextMenuController(new ContextMenuService(menuService), NULL_CONFIGURATION_SERVICE);
}

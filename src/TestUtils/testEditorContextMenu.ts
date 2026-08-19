import { ContextMenuController } from "../vs/editor/contrib/contextmenu/browser/contextMenuController.ts";
import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";

import { createTestContextMenuService } from "./testContextMenuService.ts";

/**
 * Editor-контроллер контекстного меню для тестов, которым нужен EditorService,
 * а не меню: пустой реестр пунктов, NULL-конфигурация. Классы plain (DI.md),
 * поэтому собирается напрямую.
 */
export function createTestEditorContextMenuController(): ContextMenuController {
    return new ContextMenuController(createTestContextMenuService(), NULL_CONFIGURATION_SERVICE);
}

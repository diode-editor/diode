import { ContextMenuController } from "../vs/editor/contrib/contextmenu/browser/contextMenuController.ts";
import { NULL_CONFIGURATION_SERVICE } from "../vs/platform/configuration/common/nullConfigurationService.ts";

import { createTestContextMenuService } from "./testContextMenuService.ts";

export function createTestEditorContextMenuController(): ContextMenuController {
    return new ContextMenuController(createTestContextMenuService(), NULL_CONFIGURATION_SERVICE);
}

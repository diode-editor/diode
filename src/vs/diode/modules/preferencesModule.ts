import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { KeybindingsEditorTargetDIToken } from "../../workbench/contrib/preferences/browser/keybindingsEditorPane.ts";
import { KeybindingsEditorServiceDIToken } from "../../workbench/services/keybinding/common/iKeybindingsEditorService.ts";
import { KeybindingsEditorService } from "../../workbench/services/keybinding/node/keybindingsEditorService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";

/**
 * Preferences в приложении: шов открытия вкладки Keyboard Shortcuts и сервис
 * редактирования user-биндингов (применение keybindings.json + запись).
 * Вкладка — обычная панель полосы редакторов; `EditorService` соответствует
 * шву структурно (как `ExtensionsEditorTargetDIToken` у магазина).
 */
export const preferencesModule: ContainerModule = (container) => {
    container.bind(KeybindingsEditorTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(KeybindingsEditorServiceDIToken, KeybindingsEditorService);
};

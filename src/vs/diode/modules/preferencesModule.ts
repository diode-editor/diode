import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import {
    KeybindingRecorderComponent,
    KeybindingRecorderComponentDIToken,
} from "../../workbench/contrib/preferences/browser/keybindingRecorderComponent.ts";
import { KeybindingsEditorTargetDIToken } from "../../workbench/contrib/preferences/browser/keybindingsEditorPane.ts";
import { KeybindingsEditorServiceDIToken } from "../../workbench/services/keybinding/common/iKeybindingsEditorService.ts";
import { KeybindingsEditorService } from "../../workbench/services/keybinding/node/keybindingsEditorService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";
import { TerminalEnvironmentServiceDIToken } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

/**
 * Preferences в приложении: шов открытия вкладки Keyboard Shortcuts, сервис
 * редактирования user-биндингов (применение keybindings.json + запись) и
 * рекордер комбинаций (host прикрепляет WorkbenchComponent).
 * Вкладка — обычная панель полосы редакторов; `EditorService` соответствует
 * шву структурно (как `ExtensionsEditorTargetDIToken` у магазина).
 */
export const preferencesModule: ContainerModule = (container) => {
    container.bind(KeybindingsEditorTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(KeybindingsEditorServiceDIToken, KeybindingsEditorService);
    // Рекордеру нужен только текущий tier — узкий срез node-сервиса замыкается
    // здесь, чтобы browser-компонент не импортировал node-окружение.
    container.bind(
        KeybindingRecorderComponentDIToken,
        () => new KeybindingRecorderComponent(container.get(TerminalEnvironmentServiceDIToken)),
    );
};

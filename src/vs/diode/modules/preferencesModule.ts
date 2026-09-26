import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import {
    KeyboardDoctorComponent,
    KeyboardDoctorComponentDIToken,
} from "../../workbench/contrib/keyboardDoctor/browser/keyboardDoctorComponent.ts";
import { lookupBindings } from "../../workbench/contrib/keyboardDoctor/common/keyboardDoctorBindings.ts";
import type { KeyboardDoctorEnv } from "../../workbench/contrib/keyboardDoctor/common/keyboardDoctorModel.ts";
import {
    KeybindingRecorderComponent,
    KeybindingRecorderComponentDIToken,
} from "../../workbench/contrib/preferences/browser/keybindingRecorderComponent.ts";
import { KeybindingsEditorTargetDIToken } from "../../workbench/contrib/preferences/browser/keybindingsEditorPane.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";
import { KeybindingsEditorServiceDIToken } from "../../workbench/services/keybinding/common/iKeybindingsEditorService.ts";
import { KeybindingsEditorService } from "../../workbench/services/keybinding/node/keybindingsEditorService.ts";
import { ALL_CAPABILITIES } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentModel.ts";
import {
    type TerminalEnvironmentService,
    TerminalEnvironmentServiceDIToken,
} from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

function keyboardDoctorSnapshot(env: TerminalEnvironmentService): KeyboardDoctorEnv {
    return {
        os: env.os,
        osSource: env.osSource,
        tier: env.tier,
        macKeysRung: env.macKeysRung,
        capabilities: ALL_CAPABILITIES.filter((cap) => env.hasCapability(cap)),
        modes: [...env.getActiveModes()].sort(),
        terminalName: env.terminalName,
        term: process.env.TERM,
    };
}

/**
 * Preferences в приложении: шов открытия вкладки Keyboard Shortcuts, сервис
 * редактирования user-биндингов (применение keybindings.json + запись) и
 * рекордер комбинаций и Keyboard Doctor (host прикрепляет WorkbenchComponent).
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
    // Keyboard Doctor: снимок окружения — тот же узкий срез node-сервиса.
    container.bind(KeyboardDoctorComponentDIToken, () => {
        const env = container.get(TerminalEnvironmentServiceDIToken);
        const keybindings = container.get(KeybindingRegistryDIToken);
        return new KeyboardDoctorComponent(
            { snapshot: () => keyboardDoctorSnapshot(env), onDidChange: (listener) => env.onDidChange(listener) },
            (part, snapshot) => lookupBindings(keybindings, part, snapshot),
        );
    });
};

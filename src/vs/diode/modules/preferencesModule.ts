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
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { KeybindingsEditorServiceDIToken } from "../../workbench/services/keybinding/common/iKeybindingsEditorService.ts";
import { KeybindingsEditorService } from "../../workbench/services/keybinding/node/keybindingsEditorService.ts";
import { LayoutServiceDIToken } from "../../workbench/services/layout/browser/layoutService.ts";
import { ALL_CAPABILITIES } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentModel.ts";
import {
    type TerminalEnvironmentService,
    TerminalEnvironmentServiceDIToken,
} from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

export function keyboardDoctorSnapshot(env: TerminalEnvironmentService): KeyboardDoctorEnv {
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

export const preferencesModule: ContainerModule = (container) => {
    container.bind(KeybindingsEditorTargetDIToken, () => container.get(EditorServiceDIToken));
    container.bind(KeybindingsEditorServiceDIToken, KeybindingsEditorService);
    // A narrow slice of the node service is captured here so the browser component does not import the node environment.
    container.bind(
        KeybindingRecorderComponentDIToken,
        () =>
            new KeybindingRecorderComponent(
                container.get(TerminalEnvironmentServiceDIToken),
                container.get(LayoutServiceDIToken),
            ),
    );
    container.bind(KeyboardDoctorComponentDIToken, () => {
        const env = container.get(TerminalEnvironmentServiceDIToken);
        const keybindings = container.get(KeybindingRegistryDIToken);
        return new KeyboardDoctorComponent(
            { snapshot: () => keyboardDoctorSnapshot(env), onDidChange: (listener) => env.onDidChange(listener) },
            (part, snapshot) => lookupBindings(keybindings, part, snapshot),
            container.get(LayoutServiceDIToken),
        );
    });
};

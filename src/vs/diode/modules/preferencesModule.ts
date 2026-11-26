import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import {
    KeybindingRecorderComponent,
    KeybindingRecorderComponentDIToken,
} from "../../workbench/contrib/preferences/browser/keybindingRecorderComponent.ts";
import { KeybindingsEditorTargetDIToken } from "../../workbench/contrib/preferences/browser/keybindingsEditorPane.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { KeybindingsEditorServiceDIToken } from "../../workbench/services/keybinding/common/iKeybindingsEditorService.ts";
import { KeybindingsEditorService } from "../../workbench/services/keybinding/node/keybindingsEditorService.ts";
import { LayoutServiceDIToken } from "../../workbench/services/layout/browser/layoutService.ts";
import { TerminalEnvironmentServiceDIToken } from "../../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

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
};

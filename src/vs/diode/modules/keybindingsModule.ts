import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { type IUserKeybindingRule, UserKeybindingsDIToken } from "../../platform/keybinding/common/userKeybindings.ts";

export interface KeybindingsModuleContext {
    rules: readonly IUserKeybindingRule[];
}

export const keybindingsModule: ContainerModule<KeybindingsModuleContext> = (container, { rules }) => {
    container.bind(UserKeybindingsDIToken, () => rules);
};

/** Shortcut for tests: no user keybindings. */
export const keybindingsModuleDefault: ContainerModule = (container) => {
    container.bind(UserKeybindingsDIToken, () => []);
};

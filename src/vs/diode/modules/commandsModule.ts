import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService, ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import {
    ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../platform/keybinding/common/modifierReleaseArmory.ts";

/**
 * Команды, кейбиндинги и when-context. Без внешнего конфига —
 * все три реестра конструируются с дефолтным состоянием.
 */
export const commandsModule: ContainerModule = (container) => {
    container.bind(CommandRegistryDIToken, () => new CommandRegistry());
    container.bind(KeybindingRegistryDIToken, () => new KeybindingRegistry());
    container.bind(ContextKeyServiceDIToken, () => new ContextKeyService());
    container.bind(ModifierReleaseArmoryDIToken, () => new ModifierReleaseArmory());
};

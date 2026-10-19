import { CommandRegistry, CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyService, ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry, KeybindingRegistryDIToken } from "../../platform/keybinding/common/keybindingRegistry.ts";
import {
    ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../platform/keybinding/common/modifierReleaseArmory.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";

/**
 * Команды, кейбиндинги и when-context. Реестры конструируются с дефолтным
 * состоянием; when-context читает `config.*` из настроек.
 */
export const commandsModule: ContainerModule = (container) => {
    container.bind(
        CommandRegistryDIToken,
        // Stryker disable next-line ArrowFunction,StringLiteral,ObjectLiteral: production-проводка модуля; имя канала и его метка — для панели Output, подменить её нечем наблюдаемым в юните, а поведение логирования закрыто юнитами CommandRegistry
        () => new CommandRegistry(container.get(ILogServiceDIToken).createLogger("commands", { label: "Commands" })),
    );
    container.bind(KeybindingRegistryDIToken, () => new KeybindingRegistry());
    // `config.*` в when — из настроек (корневой контекст эталона).
    container.bind(ContextKeyServiceDIToken, () => new ContextKeyService(container.get(IConfigurationServiceDIToken)));
    container.bind(ModifierReleaseArmoryDIToken, () => new ModifierReleaseArmory());
};

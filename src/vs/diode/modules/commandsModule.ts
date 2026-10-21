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

export const commandsModule: ContainerModule = (container) => {
    container.bind(
        CommandRegistryDIToken,
        // Stryker disable next-line ArrowFunction,StringLiteral,ObjectLiteral: production module wiring; the channel name and label only show in the Output panel, which a unit test cannot observe; logging behavior is covered by CommandRegistry unit tests
        () => new CommandRegistry(container.get(ILogServiceDIToken).createLogger("commands", { label: "Commands" })),
    );
    container.bind(KeybindingRegistryDIToken, () => new KeybindingRegistry());
    // `config.*` in when clauses resolves from settings (the upstream root context).
    container.bind(ContextKeyServiceDIToken, () => new ContextKeyService(container.get(IConfigurationServiceDIToken)));
    container.bind(ModifierReleaseArmoryDIToken, () => new ModifierReleaseArmory());
};

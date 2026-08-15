import type { IDisposable } from "@tuidom/core/common/disposable";
import type { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import type { ICommandService } from "../common/iCommandService.ts";

/**
 * Реализация {@link ICommandService} поверх {@link CommandRegistry}. Живёт в
 * слое Extensions (Workbench ничего не должен знать про host).
 */
export class CommandServiceAdapter implements ICommandService {
    private readonly registry: CommandRegistry;

    public constructor(registry: CommandRegistry) {
        this.registry = registry;
    }

    public execute(id: string, args: readonly unknown[]): unknown {
        if (!this.registry.has(id)) {
            throw new Error(`command "${id}" not found`);
        }
        return this.registry.execute(id, ...args);
    }

    public registerProxy(id: string, invoke: (args: readonly unknown[]) => unknown, title?: string): IDisposable {
        return this.registry.register(id, (...args) => invoke(args), title);
    }
}

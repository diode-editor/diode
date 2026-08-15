import type { IDisposable } from "@tuidom/core/common/disposable";
import { token } from "../../instantiation/common/diContainer.ts";

export const CommandRegistryDIToken = token<CommandRegistry>("CommandRegistry");

export type CommandHandler = (...args: unknown[]) => unknown;

interface CommandEntry {
    handler: CommandHandler;
    title?: string;
}

export class CommandRegistry implements IDisposable {
    private entries = new Map<string, CommandEntry>();

    public register(id: string, handler: CommandHandler, title?: string): IDisposable {
        this.entries.set(id, { handler, title });
        return {
            dispose: () => {
                if (this.entries.get(id)?.handler === handler) {
                    this.entries.delete(id);
                }
            },
        };
    }

    public execute(id: string, ...args: unknown[]): unknown {
        const entry = this.entries.get(id);
        if (!entry) return undefined;
        return entry.handler(...args);
    }

    public has(id: string): boolean {
        return this.entries.has(id);
    }

    /** Человекочитаемый title команды (для label пунктов меню), или undefined. */
    public getTitle(id: string): string | undefined {
        return this.entries.get(id)?.title;
    }

    public listCommands(): { id: string; title: string }[] {
        const result: { id: string; title: string }[] = [];
        for (const [id, entry] of this.entries) {
            if (entry.title !== undefined) {
                result.push({ id, title: entry.title });
            }
        }
        return result;
    }

    public dispose(): void {
        this.entries.clear();
    }
}

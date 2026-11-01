import { describeRejection } from "../../../base/common/describeRejection.ts";
import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

export const CommandRegistryDIToken = token<CommandRegistry>("CommandRegistry");

export type CommandHandler = (...args: unknown[]) => unknown;

const INPUT_HOLD_LIMIT_MS = 1000;

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

interface CommandEntry {
    handler: CommandHandler;
    title?: string;
    enablement?: string;
    category?: string;
}

export interface ICommandSnapshot {
    readonly id: string;
    readonly title: string;
    /** The registry does NOT check it; the handler itself enforces it (`registerAction`). Metadata only. */
    readonly enablement?: string;
    /** Not part of the title, as in VS Code: the prefix appears only in the command palette ({@link commandPaletteLabel}). */
    readonly category?: string;
}

export function commandPaletteLabel(cmd: Pick<ICommandSnapshot, "title" | "category">): string {
    return cmd.category === undefined || cmd.category === "" ? cmd.title : `${cmd.category}: ${cmd.title}`;
}

/**
 * As upstream `CommandsRegistry`: registering an existing id shadows the handler instead of replacing it,
 * and disposing the shadow brings the previous one back (an extension overriding `type`).
 */
export class CommandRegistry implements IDisposable {
    /** The last entry of a stack is the one in force; an empty stack is removed. */
    private entries = new Map<string, CommandEntry[]>();
    private inputHolds = 0;
    private readonly inputReleased = new Emitter<void>();
    public readonly onDidReleaseInput = this.inputReleased.event;

    public constructor(private readonly logger: ILogger = NULL_LOGGER) {}

    /**
     * Keys wait until `done` settles, then run in the order they were pressed. For a command whose edit is built
     * in another process: a key overtaking it would make the edit stale, and the edit would be refused.
     * Bounded, so a stuck extension cannot take the keyboard away.
     */
    public holdInputUntil(done: PromiseLike<unknown>): void {
        this.inputHolds++;
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true;
            clearTimeout(timer);
            this.inputHolds--;
            if (this.inputHolds > 0) return;
            this.inputReleased.fire();
        };
        const timer = setTimeout(release, INPUT_HOLD_LIMIT_MS);
        done.then(release, release);
    }

    public get isInputHeld(): boolean {
        return this.inputHolds > 0;
    }

    public register(
        id: string,
        handler: CommandHandler,
        title?: string,
        enablement?: string,
        category?: string,
    ): IDisposable {
        const entry: CommandEntry = { handler, title, enablement, category };
        const stack = this.entries.get(id);
        if (stack === undefined) this.entries.set(id, [entry]);
        else stack.push(entry);
        return {
            dispose: () => {
                const current = this.entries.get(id);
                if (current === undefined) return;
                const index = current.indexOf(entry);
                if (index < 0) return;
                current.splice(index, 1);
                if (current.length === 0) this.entries.delete(id);
            },
        };
    }

    private top(id: string): CommandEntry | undefined {
        return this.entries.get(id)?.at(-1);
    }

    /**
     * The single shared place where a command promise gets a rejection handler:
     * callers fire and forget, and an unhandled rejection kills the process with all
     * unsaved buffers (that is how F12 into a `jdt:` resource took the editor down).
     * The handler is attached to the original promise rather than replacing it, so an
     * awaiting caller (`executeCommand`) still gets the rejection.
     */
    public execute(id: string, ...args: unknown[]): unknown {
        const entry = this.top(id);
        if (!entry) return undefined;
        const result = entry.handler(...args);
        if (isThenable(result)) {
            result.then(undefined, (error: unknown) => {
                this.logger.error(`command "${id}" failed: ${describeRejection(error)}`);
            });
        }
        return result;
    }

    public has(id: string): boolean {
        return this.entries.has(id);
    }

    public getTitle(id: string): string | undefined {
        return this.top(id)?.title;
    }

    /** Unlike {@link listCommands}, with the commands that have no title. */
    public listCommandIds(): string[] {
        return [...this.entries.keys()];
    }

    public listCommands(): ICommandSnapshot[] {
        const result: ICommandSnapshot[] = [];
        for (const id of this.entries.keys()) {
            const entry = this.top(id);
            // Stryker disable next-line OptionalChaining: a stack in the map is never empty
            if (entry?.title !== undefined) {
                result.push({ id, title: entry.title, enablement: entry.enablement, category: entry.category });
            }
        }
        return result;
    }

    public dispose(): void {
        this.entries.clear();
    }
}

import { describeRejection } from "../../../base/common/describeRejection.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

export const CommandRegistryDIToken = token<CommandRegistry>("CommandRegistry");

export type CommandHandler = (...args: unknown[]) => unknown;

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
    /** Реестр его НЕ проверяет — принуждает сам хендлер (`registerAction`); здесь только метаданные. */
    readonly enablement?: string;
    /** В заголовок не входит, как в VS Code: префикс только в палитре ({@link commandPaletteLabel}). */
    readonly category?: string;
}

export function commandPaletteLabel(cmd: Pick<ICommandSnapshot, "title" | "category">): string {
    return cmd.category === undefined || cmd.category === "" ? cmd.title : `${cmd.category}: ${cmd.title}`;
}

export class CommandRegistry implements IDisposable {
    private entries = new Map<string, CommandEntry>();

    public constructor(private readonly logger: ILogger = NULL_LOGGER) {}

    public register(
        id: string,
        handler: CommandHandler,
        title?: string,
        enablement?: string,
        category?: string,
    ): IDisposable {
        this.entries.set(id, { handler, title, enablement, category });
        return {
            dispose: () => {
                if (this.entries.get(id)?.handler === handler) {
                    this.entries.delete(id);
                }
            },
        };
    }

    /**
     * Единственная общая точка, где у промиса команды появляется обработчик отказа:
     * зовут их «выстрелил и забыл», а необработанный отказ убивает процесс со всеми
     * несохранёнными буферами (так F12 в `jdt:`-ресурс уносил редактор). Обработчик
     * вешаем на исходный промис, а не подменяем его: ждущему (`executeCommand`) отказ доедет.
     */
    public execute(id: string, ...args: unknown[]): unknown {
        const entry = this.entries.get(id);
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
        return this.entries.get(id)?.title;
    }

    public listCommands(): ICommandSnapshot[] {
        const result: ICommandSnapshot[] = [];
        for (const [id, entry] of this.entries) {
            if (entry.title !== undefined) {
                result.push({ id, title: entry.title, enablement: entry.enablement, category: entry.category });
            }
        }
        return result;
    }

    public dispose(): void {
        this.entries.clear();
    }
}

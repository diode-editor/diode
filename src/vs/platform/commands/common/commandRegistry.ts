import type { IDisposable } from "@tuidom/core/common/disposable";

import { describeRejection } from "../../../base/common/describeRejection.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { NULL_LOGGER } from "../../log/common/nullLogService.ts";

export const CommandRegistryDIToken = token<CommandRegistry>("CommandRegistry");

export type CommandHandler = (...args: unknown[]) => unknown;

/** Вернул ли хендлер что-то ожидаемое (промис команды, объявленной `async`). */
function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}

interface CommandEntry {
    handler: CommandHandler;
    title?: string;
    enablement?: string;
}

/** Запись реестра для потребителей, которые перечисляют команды (палитра). */
export interface ICommandSnapshot {
    readonly id: string;
    readonly title: string;
    /**
     * When-выражение доступности, если объявлено экшеном. Реестр его НЕ
     * проверяет — принуждением занимается сам хендлер (`registerAction`);
     * здесь это метаданные для тех, кто рисует список команд.
     */
    readonly enablement?: string;
}

export class CommandRegistry implements IDisposable {
    private entries = new Map<string, CommandEntry>();

    /**
     * Логгер отказов асинхронных команд. Не задан — отказ проглатывается молча
     * (минимальные контейнеры тестов); процесс не падает в любом случае, см.
     * {@link execute}.
     */
    public constructor(private readonly logger: ILogger = NULL_LOGGER) {}

    public register(id: string, handler: CommandHandler, title?: string, enablement?: string): IDisposable {
        this.entries.set(id, { handler, title, enablement });
        return {
            dispose: () => {
                if (this.entries.get(id)?.handler === handler) {
                    this.entries.delete(id);
                }
            },
        };
    }

    /**
     * Запускает команду. Возвращает то, что вернул её хендлер, — включая промис
     * асинхронной команды: тот, кто его ждёт (мост расширений через
     * `commands.executeCommand`), обязан увидеть настоящий отказ.
     *
     * Здесь же — **единственная общая точка, где у этого промиса появляется
     * обработчик отказа**. Команды почти все асинхронные, а зовут их «выстрелил
     * и забыл»: диспетчер клавиш, пункт меню, клик по статус-бару, палитра —
     * ни один из них результат не ждёт. Необработанный отказ Node считает
     * фатальным и убивает процесс, то есть закрывает редактор со всеми
     * несохранёнными буферами из-за неудачи ОДНОЙ команды (так F12 в
     * `jdt:`-ресурс уносил весь редактор). Обработчик вешаем на исходный промис,
     * а не подменяем его: отказ гасится только для забывших, ждущим он доедет.
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

    /** Человекочитаемый title команды (для label пунктов меню), или undefined. */
    public getTitle(id: string): string | undefined {
        return this.entries.get(id)?.title;
    }

    public listCommands(): ICommandSnapshot[] {
        const result: ICommandSnapshot[] = [];
        for (const [id, entry] of this.entries) {
            if (entry.title !== undefined) {
                result.push({ id, title: entry.title, enablement: entry.enablement });
            }
        }
        return result;
    }

    public dispose(): void {
        this.entries.clear();
    }
}

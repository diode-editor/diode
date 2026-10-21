import { renderCodicons } from "../../../../../base/common/codicons.ts";
import { DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { withCursorChangeSource } from "../../../../../editor/common/core/cursorChangeSource.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../../api/common/iCommandService.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

export interface ICommandPaletteMetadata {
    readonly commandTitles?: Readonly<Record<string, string>>;
    readonly commandCategories?: Readonly<Record<string, string>>;
}

/**
 * Прокси команд субпроцесса живут один спавн. Заглушки `onCommand:<id>` и подписи палитры — с хостом:
 * команда видна и исполнима по id до активации расширения и после смерти субпроцесса.
 */
export class CommandsCustomer implements IExtensionHostCustomer {
    private proxies: DisposableMap<string> | null = null;
    /** Стоят ВМЕСТО прокси до активации: исполнение сперва поднимает расширение. */
    private readonly activationStubs = new DisposableMap<string>();
    private readonly titles = new Map<string, string>();
    private readonly categories = new Map<string, string>();

    public constructor(
        private readonly commandService: ICommandService,
        private readonly activate: (event: string) => Promise<void>,
        private readonly logger: ILogger | undefined,
    ) {}

    /**
     * Значки разворачиваем здесь: у эталона подпись команды — метка quick pick'а, где значки
     * живые, а у нас текст манифеста становится подписью пункта палитры.
     */
    public addPaletteMetadata(metadata: ICommandPaletteMetadata): void {
        for (const [id, title] of Object.entries(metadata.commandTitles ?? {})) {
            this.titles.set(id, renderCodicons(title));
        }
        for (const [id, category] of Object.entries(metadata.commandCategories ?? {})) {
            this.categories.set(id, renderCodicons(category));
        }
    }

    /**
     * Без ожидания активации команда не нашлась бы: настоящий прокси заводит сам субпроцесс.
     * Живой прокси заглушкой не затирается.
     */
    public arm(id: string): void {
        if (this.proxies?.has(id) === true || this.activationStubs.has(id)) return;
        const event = `onCommand:${id}`;
        this.activationStubs.set(
            id,
            this.commandService.registerProxy(
                id,
                async (args): Promise<unknown> => {
                    try {
                        await this.activate(event);
                    } catch (err) {
                        // Вызывающие (палитра, бинд) результат не ждут — reject ушёл бы
                        // в unhandledRejection главного процесса.
                        this.logger?.error(`failed to activate extension for command "${id}"`, err);
                        return undefined;
                    }
                    // Расширение поднялось, но команду не завело — повторный вызов через
                    // заглушку дал бы петлю.
                    if (this.proxies?.has(id) !== true) {
                        this.logger?.warn(`command "${id}" is still unregistered after activation`);
                        return undefined;
                    }
                    return this.commandService.execute(id, args);
                },
                this.titles.get(id),
                this.categories.get(id),
            ),
        );
    }

    public disarm(id: string): void {
        this.activationStubs.deleteAndDispose(id);
    }

    /** Заглушки живут в ОБЩЕМ реестре ядра — после выключения там висели бы записи, которые некого поднимать. */
    public disarmAll(): void {
        this.activationStubs.clearAndDisposeAll();
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const proxies = store.add(new DisposableMap<string>());
        this.proxies = proxies;
        // Handler ядра может вернуть значение или thenable.
        store.add(
            rpc.handleRequest("commands.executeCommand", (params): unknown => {
                const { id, args } = parseCommandInvocation(params);
                // Курсор, сдвинутый командой, приедет как `TextEditorSelectionChangeKind.Command`; область
                // синхронная — после await `kind === undefined` (см. cursorChangeSource.ts).
                return Promise.resolve(withCursorChangeSource("command", () => this.commandService.execute(id, args)));
            }),
        );
        store.add(
            rpc.handleNotification("commands.registerCommand", (params): void => {
                const id = parseCommandId(params);
                if (id === null) return;
                this.disarm(id);
                // Повторная регистрация id: `set` снимает прежний прокси уже после заведения нового —
                // реестр снимает запись, только если она всё ещё указывает на снимаемый обработчик.
                proxies.set(
                    id,
                    this.commandService.registerProxy(
                        id,
                        (args) => rpc.request("commands.executeCommand", { id, args }),
                        this.titles.get(id),
                        this.categories.get(id),
                    ),
                );
            }),
        );
        store.add(
            rpc.handleNotification("commands.unregisterCommand", (params): void => {
                const id = parseCommandId(params);
                // Stryker disable next-line ConditionalExpression: эквивалентный — снятие отсутствующего ключа (`null`) из карты прокси ничего не делает; ранний выход только для типа
                if (id === null) return;
                proxies.deleteAndDispose(id);
            }),
        );
        store.add({
            // Stryker disable next-line BlockStatement: гигиена — карту ушедшего спавна уже опустошил его store (DisposableMap отдаёт всё на dispose), `has` на ней и так false; забываем ссылку, чтобы не держать мёртвую карту
            dispose: () => {
                this.proxies = null;
            },
        });
        return store;
    }
}

function parseCommandInvocation(raw: unknown): { id: string; args: unknown[] } {
    if (typeof raw !== "object" || raw === null) {
        throw new Error("commands.executeCommand: params must be an object");
    }
    const obj = raw as { id?: unknown; args?: unknown };
    if (typeof obj.id !== "string" || obj.id === "") {
        throw new Error("commands.executeCommand: id must be a non-empty string");
    }
    const args = Array.isArray(obj.args) ? (obj.args as unknown[]) : [];
    return { id: obj.id, args };
}

function parseCommandId(raw: unknown): string | null {
    // Stryker disable next-line ConditionalExpression,LogicalOperator: без проверки примитив отсеивает чтение `.id` ниже, а `null`/`undefined` падает на нём — RpcEndpoint глотает исключение нотификации, наблюдаемо то же «проигнорировано»
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as { id?: unknown };
    return typeof obj.id === "string" && obj.id !== "" ? obj.id : null;
}

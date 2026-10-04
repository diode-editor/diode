import { renderCodicons } from "../../../../../base/common/codicons.ts";
import { DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { withCursorChangeSource } from "../../../../../editor/common/core/cursorChangeSource.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../../api/common/iCommandService.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";

/** Заголовки и группы команд из `contributes.commands` одного расширения. */
export interface ICommandPaletteMetadata {
    readonly commandTitles?: Readonly<Record<string, string>>;
    readonly commandCategories?: Readonly<Record<string, string>>;
}

/**
 * Команды расширений в реестре команд ядра. Прокси команд, заведённых
 * субпроцессом (`commands.registerCommand`), живут один спавн и уходят вместе
 * с ним. Заглушки-активаторы `onCommand:<id>` и подписи палитры живут
 * столько же, сколько хост: команда видна в палитре и исполнима по id ещё до
 * активации расширения — и после смерти субпроцесса, пока его не оживят.
 */
export class CommandsCustomer implements IExtensionHostCustomer {
    /** Прокси-регистрации команд текущего спавна (по id); `null` — спавна нет. */
    private proxies: DisposableMap<string> | null = null;
    /**
     * Заглушки команд под `onCommand:<id>` (id → регистрация в реестре ядра).
     * Стоят ВМЕСТО прокси, пока расширение не активировано: исполнение такой
     * команды сперва поднимает расширение, а потом уходит в уже настоящий прокси.
     */
    private readonly activationStubs = new DisposableMap<string>();
    /** Заголовки команд (id → title) — для видимости в палитре. */
    private readonly titles = new Map<string, string>();
    /** Группы команд (id → category) — префикс подписи в палитре. */
    private readonly categories = new Map<string, string>();

    /**
     * @param activate поднимает расширения события активации (реестр и
     *   активация остаются у хоста)
     */
    public constructor(
        private readonly commandService: ICommandService,
        private readonly activate: (event: string) => Promise<void>,
        private readonly logger: ILogger | undefined,
    ) {}

    /**
     * Запоминает подписи команд расширения. Здесь же разворачиваем разметку
     * значков: это точка, где текст манифеста становится подписью НАШЕГО пункта
     * палитры, а у эталона подпись команды — метка quick pick'а, то есть значки
     * в ней живые.
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
     * Ставит заглушку-активатор на команду `id`: до активации расширения
     * команда уже есть в реестре ядра (значит видна в палитре и исполнима по
     * id), а её исполнение СНАЧАЛА поднимает расширение и только потом уходит в
     * настоящий прокси. Без ожидания активации команда не нашлась бы: реальный
     * прокси заводит сам субпроцесс в `commands.registerCommand`.
     *
     * Настоящий прокси заглушкой не затирается: если команда уже живая (её
     * зарегистрировало активное расширение), ставить поверх нечего.
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
                        // Провал хоста (subprocess не поднялся) гасим здесь:
                        // вызывающие команду (палитра, бинд) результат не ждут,
                        // и reject ушёл бы в unhandledRejection главного процесса.
                        this.logger?.error(`failed to activate extension for command "${id}"`, err);
                        return undefined;
                    }
                    // Расширение поднялось, но команду не завело (ошибка в
                    // `activate()`, опечатка в манифесте) — исполнять нечего, и
                    // зваться повторно через заглушку тоже: получилась бы петля.
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

    /** Снимает заглушку-активатор команды (расширение активировалось или снято). */
    public disarm(id: string): void {
        this.activationStubs.deleteAndDispose(id);
    }

    /**
     * Снимает все заглушки: хост выключается. Заглушки живут в ОБЩЕМ реестре
     * команд ядра — после выключения там висели бы записи, которые уже некого
     * поднимать.
     */
    public disarmAll(): void {
        this.activationStubs.clearAndDisposeAll();
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const proxies = store.add(new DisposableMap<string>());
        this.proxies = proxies;
        // Сабпроцесс просит исполнить команду ядра (напр. встроенную
        // editor.action.trimTrailingWhitespace). Нормализуем через Promise —
        // handler ядра может вернуть значение или thenable.
        store.add(
            rpc.handleRequest("commands.executeCommand", (params): unknown => {
                const { id, args } = parseCommandInvocation(params);
                // Источник `command` для смены каретки: команда, сдвинувшая курсор,
                // приедет расширению как `TextEditorSelectionChangeKind.Command`.
                // Область синхронная — команда, двигающая каретку уже после await,
                // отдаст `kind === undefined` (см. cursorChangeSource.ts).
                return Promise.resolve(withCursorChangeSource("command", () => this.commandService.execute(id, args)));
            }),
        );
        // Сабпроцесс зарегистрировал команду — заводим прокси в реестре ядра,
        // который уводит исполнение обратно в сабпроцесс обратным RPC.
        store.add(
            rpc.handleNotification("commands.registerCommand", (params): void => {
                const id = parseCommandId(params);
                if (id === null) return;
                // Заглушка-активатор отработала (или её никто не трогал) — теперь
                // команду держит настоящий прокси, и ждать активации больше нечего.
                this.disarm(id);
                // Повторная регистрация того же id: `set` снимает прежний прокси
                // сам, уже после заведения нового, — реестр ядра снимает запись
                // id, только если она всё ещё указывает на снимаемый обработчик.
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
        // Прокси указывали на ушедший субпроцесс — они снимаются вместе с
        // `proxies` (store), здесь только забываем саму карту.
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

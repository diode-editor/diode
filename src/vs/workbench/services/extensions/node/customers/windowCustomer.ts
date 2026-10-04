import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import {
    type IWireInputBoxResult,
    type IWireQuickPickResult,
    type IWireShowMessageResult,
    type IWireValidationMessage,
    parseWireDiagnosticsPublish,
    parseWireInputBoxRequest,
    parseWireOutputAppend,
    parseWireOutputShow,
    parseWireProgressEnd,
    parseWireProgressReport,
    parseWireProgressStart,
    parseWireQuickInputCancel,
    parseWireQuickPickRequest,
    parseWireShowMessageRequest,
    parseWireStatusBarItem,
    parseWireStatusBarItemDispose,
    parseWireValidationMessage,
    type WireMessageSeverity,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import type {
    DiagnosticsSink,
    INotificationSink,
    IOutputSink,
    IProgressSink,
    IQuickInputSink,
    IStatusBarItemSink,
} from "../extensionHost.ts";

/** Стоки поверхностей окна; без стока поверхность молча отбрасывает своё. */
export interface IWindowSinks {
    readonly diagnosticsSink: DiagnosticsSink | undefined;
    readonly progressSink: IProgressSink | undefined;
    readonly outputSink: IOutputSink | undefined;
    readonly statusBarItemSink: IStatusBarItemSink | undefined;
    readonly quickInputSink: IQuickInputSink | undefined;
    readonly notificationSink: INotificationSink | undefined;
}

/**
 * Поверхности окна, которые расширение держит на экране: прогресс
 * (`window.withProgress`), пункты статус-бара, output-каналы, диагностики,
 * quick input и сообщения человеку. Всё, что субпроцесс показал, принадлежит
 * ему: на его смерти или выключении спиннеры гаснут, пункты полосы снимаются,
 * а оверлеи ввода и сообщения закрываются — ответить на них стало некому.
 */
export class WindowCustomer implements IExtensionHostCustomer {
    /** Счётчик адресов показов сообщений — монотонен на всё время жизни хоста. */
    private nextMessageHandle = 1;

    public constructor(private readonly sinks: IWindowSinks) {}

    public attach({ rpc, logger }: IExtensionHostContext): IDisposable {
        const { diagnosticsSink, progressSink, outputSink, statusBarItemSink, quickInputSink, notificationSink } =
            this.sinks;
        const store = new DisposableStore();
        /** Живые handle'ы withProgress — на смерти всем шлётся end (спиннеры не зависают). */
        const progressHandles = new Set<number>();
        /** Живые показы quick input'а: на смерти всем шлётся cancel. */
        const quickInputHandles = new Set<number>();
        /** Живые показы сообщений — по той же причине, что у quick input'а. */
        const messageHandles = new Set<number>();

        // Жизненный цикл withProgress расширения — отдаём стоку (module рисует
        // запись статус-бара со спиннером и снимает её на end).
        store.add(
            rpc.handleNotification("window.progress.start", (params) => {
                const start = parseWireProgressStart(params);
                if (start === null) return;
                progressHandles.add(start.handle);
                progressSink?.start(start.handle, start.title);
            }),
        );
        store.add(
            rpc.handleNotification("window.progress.report", (params) => {
                const report = parseWireProgressReport(params);
                if (report === null) return;
                progressSink?.report(report.handle, report.message, report.increment);
            }),
        );
        store.add(
            rpc.handleNotification("window.progress.end", (params) => {
                const end = parseWireProgressEnd(params);
                if (end === null) return;
                progressHandles.delete(end.handle);
                progressSink?.end(end.handle);
            }),
        );
        // Пункт статус-бара расширения (`window.createStatusBarItem`) показан или
        // изменён / снят — отдаём стоку (module ведёт в StatusBarService).
        // `update` — полное состояние, а не дельта: у хоста нет своей копии пункта.
        store.add(
            rpc.handleNotification("window.statusBarItem.update", (params) => {
                const item = parseWireStatusBarItem(params);
                if (item === null) return;
                statusBarItemSink?.update(item);
            }),
        );
        store.add(
            rpc.handleNotification("window.statusBarItem.dispose", (params) => {
                const removed = parseWireStatusBarItemDispose(params);
                if (removed === null) return;
                statusBarItemSink?.remove(removed.handle);
            }),
        );
        // Строка output-канала расширения / просьба показать канал — отдаём
        // стоку (module ведёт в реестр Output + логгер + команду show).
        store.add(
            rpc.handleNotification("output.append", (params) => {
                const append = parseWireOutputAppend(params);
                if (append === null) return;
                outputSink?.append(append.channel, append.label, append.level, append.value);
            }),
        );
        store.add(
            rpc.handleNotification("output.show", (params) => {
                const show = parseWireOutputShow(params);
                if (show === null) return;
                outputSink?.show(show.channel, show.label);
            }),
        );
        // Расширение опубликовало диагностики (createDiagnosticCollection().set)
        // — отдаём их стоку (module ведёт в MarkerService → squiggle + Problems).
        store.add(
            rpc.handleNotification("diagnostics.publish", (params) => {
                const publish = parseWireDiagnosticsPublish(params);
                if (publish === null) return;
                diagnosticsSink?.(publish.owner, publish.resource, publish.markers);
            }),
        );
        // ─── Quick input (ввод и выбор по просьбе расширения) ────────────────
        // Показ адресуется handle'ом расширения. Валидацию хост спрашивает
        // обратным запросом в тот же субпроцесс — она живёт в расширении.
        store.add(
            rpc.handleRequest("window.showInputBox", async (params): Promise<IWireInputBoxResult> => {
                const request = parseWireInputBoxRequest(params);
                // Мусорные параметры или отсутствующий сток — «человек отменил»:
                // расширение получает undefined сразу, а не зависает навсегда.
                if (request === null || quickInputSink === undefined) return { value: null };
                // Именованной константой, а не стрелкой внутри спреда: Stryker
                // разбирает исходник своим babel'ом и на типизированной стрелке в
                // спред-тернарнике падает (`Did not expect a type annotation here`).
                const askExtension = async (text: string): Promise<IWireValidationMessage | null> => {
                    try {
                        const answer = await rpc.request("window.inputBox.validate", {
                            handle: request.handle,
                            value: text,
                        });
                        return parseWireValidationMessage(answer);
                    } catch {
                        // Расширение упало на валидации — считаем значение годным,
                        // а не вешаем поле навсегда.
                        return null;
                    }
                };
                quickInputHandles.add(request.handle);
                try {
                    const value = await quickInputSink.showInputBox({
                        ...request,
                        ...(request.validates ? { validate: askExtension } : {}),
                    });
                    return { value: value ?? null };
                } finally {
                    quickInputHandles.delete(request.handle);
                }
            }),
        );
        store.add(
            rpc.handleRequest("window.showQuickPick", async (params): Promise<IWireQuickPickResult> => {
                const request = parseWireQuickPickRequest(params);
                if (request === null || quickInputSink === undefined) return { indices: null };
                quickInputHandles.add(request.handle);
                try {
                    const indices = await quickInputSink.showQuickPick(request);
                    return { indices: indices ?? null };
                } finally {
                    quickInputHandles.delete(request.handle);
                }
            }),
        );
        // Токен отмены расширения стрельнул — снимаем показ, обещание расширения
        // доводится до undefined закрытием оверлея.
        store.add(
            rpc.handleNotification("window.quickInput.cancel", (params) => {
                const handle = parseWireQuickInputCancel(params);
                if (handle === null) return;
                // Stryker disable next-line OptionalChaining: ветка «стока нет» ниже по коду недостижима из тестов иначе как этим же путём, а без стока обращение кинуло бы
                quickInputSink?.cancel(handle);
            }),
        );
        // ─── Сообщения человеку (window.show*Message) ────────────────────────
        // Сообщение одновременно уходит в лог расширений (история сообщений
        // остаётся читаемой после того, как тост погас) и на поверхность стока.
        // Ответ — индекс нажатой кнопки; без стока и на мусорных параметрах
        // расширение получает «закрыто без выбора», а не висит.
        store.add(
            rpc.handleRequest("window.showMessage", async (params): Promise<IWireShowMessageResult> => {
                const request = parseWireShowMessageRequest(params);
                if (request === null) return { index: null };
                logExtensionMessage(logger, request.severity, request.message);
                if (notificationSink === undefined) return { index: null };
                // Stryker disable next-line UpdateOperator: от счётчика нужна только уникальность адреса, направление шага ненаблюдаемо
                const handle = this.nextMessageHandle++;
                messageHandles.add(handle);
                // `.catch` вместо try/catch: поверхность, не сумевшая показать
                // сообщение, — это НАША поломка, и расширение за неё платить не
                // должно. Отказ этого запроса отклонил бы его `await show*Message(...)`,
                // а необработанный reject валит весь субпроцесс расширений (поймано
                // живым прогоном). Отвечаем «закрыто без выбора» и пишем в лог.
                const index = await notificationSink
                    .showMessage({ ...request, handle })
                    .catch((error: unknown): undefined => {
                        logger?.error(`[extension] showMessage failed: ${String(error)}`);
                        return undefined;
                    });
                messageHandles.delete(handle);
                return { index: index ?? null };
            }),
        );

        // Субпроцесс ушёл — его `end`/`dispose`/ответы уже не придут: всё, что он
        // держал на экране, снимаем сами.
        store.add({
            dispose: () => {
                for (const handle of progressHandles) progressSink?.end(handle);
                statusBarItemSink?.clear();
                // Stryker disable next-line OptionalChaining: handle попадает в набор только после проверки стока, поэтому пары «набор непуст, а стока нет» не бывает; `?.` стоит защитой
                for (const handle of quickInputHandles) quickInputSink?.cancel(handle);
                // Stryker disable next-line OptionalChaining: см. выше
                for (const handle of messageHandles) notificationSink?.cancel(handle);
            },
        });
        return store;
    }
}

/**
 * Дублирует сообщение расширения в лог по строгости: тост гаснет, а
 * прочитать, что расширение сказало, надо и потом.
 */
function logExtensionMessage(logger: ILogger | undefined, severity: WireMessageSeverity, text: string): void {
    if (severity === "error") logger?.error(`[extension] ${text}`);
    else if (severity === "warn") logger?.warn(`[extension] ${text}`);
    else logger?.info(`[extension] ${text}`);
}

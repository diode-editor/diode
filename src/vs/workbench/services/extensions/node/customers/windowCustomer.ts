import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import type {
    IFileDialogSink,
    INotificationSink,
    IOutputSink,
    IProgressSink,
    IQuickInputSink,
    IStatusBarItemSink,
} from "../../../../api/common/iExtensionWindowSinks.ts";
import type {
    IWireInputBoxResult,
    IWireOpenDialogResult,
    IWireQuickPickEvent,
    IWireQuickPickResult,
    IWireSaveDialogResult,
    IWireShowMessageResult,
    IWireValidationMessage,
    WireMessageSeverity,
} from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireInputBoxRequest,
    parseWireOpenDialogRequest,
    parseWireOutputAppend,
    parseWireOutputShow,
    parseWireProgressEnd,
    parseWireProgressReport,
    parseWireProgressStart,
    parseWireQuickInputCancel,
    parseWireQuickPickDispose,
    parseWireQuickPickRequest,
    parseWireQuickPickUpdate,
    parseWireSaveDialogRequest,
    parseWireShowMessageRequest,
    parseWireStatusBarItem,
    parseWireStatusBarItemDispose,
    parseWireValidationMessage,
} from "../hostWireParsers.ts";

/** Стоки поверхностей окна; без стока поверхность молча отбрасывает своё. */
export interface IWindowSinks {
    readonly progressSink: IProgressSink | undefined;
    readonly outputSink: IOutputSink | undefined;
    readonly statusBarItemSink: IStatusBarItemSink | undefined;
    readonly quickInputSink: IQuickInputSink | undefined;
    readonly notificationSink: INotificationSink | undefined;
    readonly fileDialogSink?: IFileDialogSink;
}

/**
 * Всё, что субпроцесс показал, принадлежит ему: на его смерти спиннеры гаснут,
 * пункты полосы снимаются, оверлеи ввода и сообщения закрываются.
 */
export class WindowCustomer implements IExtensionHostCustomer {
    /** Монотонен на всё время жизни хоста, а не спавна. */
    private nextMessageHandle = 1;

    public constructor(private readonly sinks: IWindowSinks) {}

    public attach({ rpc, logger }: IExtensionHostContext): IDisposable {
        const { progressSink, outputSink, statusBarItemSink, quickInputSink, notificationSink, fileDialogSink } =
            this.sinks;
        const store = new DisposableStore();
        const progressHandles = new Set<number>();
        const quickInputHandles = new Set<number>();
        const messageHandles = new Set<number>();
        const quickPickHandles = new Set<number>();
        /** Пикер, снятый на смерти субпроцесса, сообщает о скрытии — слать это в закрытый канал некому. */
        let attached = true;
        const emitQuickPickEvent = (event: IWireQuickPickEvent): void => {
            if (attached) rpc.notify("window.quickPick.event", event);
        };

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
        // Валидацию хост спрашивает обратным запросом в тот же субпроцесс — она живёт в расширении.
        store.add(
            rpc.handleRequest("window.showInputBox", async (params): Promise<IWireInputBoxResult> => {
                const request = parseWireInputBoxRequest(params);
                // «Человек отменил» сразу, а не вечное ожидание расширения.
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
                        // Упавшая валидация — значение годно, а не поле, висящее навсегда.
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
        store.add(
            rpc.handleNotification("window.quickInput.cancel", (params) => {
                const handle = parseWireQuickInputCancel(params);
                if (handle === null) return;
                // Stryker disable next-line OptionalChaining: ветка «стока нет» ниже по коду недостижима из тестов иначе как этим же путём, а без стока обращение кинуло бы
                quickInputSink?.cancel(handle);
            }),
        );
        store.add(
            rpc.handleNotification("window.quickPick.update", (params) => {
                const update = parseWireQuickPickUpdate(params);
                if (update === null || quickInputSink === undefined) return;
                quickPickHandles.add(update.handle);
                quickInputSink.updateQuickPick(update, emitQuickPickEvent);
            }),
        );
        store.add(
            rpc.handleNotification("window.quickPick.dispose", (params) => {
                const handle = parseWireQuickPickDispose(params);
                // Stryker disable next-line ConditionalExpression: проверка null — для типов; `Set.delete(null)` и так false, и мусор отсеивается второй половиной
                if (handle === null || !quickPickHandles.delete(handle)) return;
                // Stryker disable next-line OptionalChaining: handle попадает в набор только после проверки стока (см. update) — пары «набор непуст, а стока нет» не бывает
                quickInputSink?.disposeQuickPick(handle);
            }),
        );
        // Диалоги файлов: без стока — «человек отменил» сразу, а не вечное ожидание.
        store.add(
            rpc.handleRequest("window.showOpenDialog", async (params): Promise<IWireOpenDialogResult> => {
                const uris = await fileDialogSink?.showOpenDialog(parseWireOpenDialogRequest(params));
                return { uris: uris ?? null };
            }),
        );
        store.add(
            rpc.handleRequest("window.showSaveDialog", async (params): Promise<IWireSaveDialogResult> => {
                const uri = await fileDialogSink?.showSaveDialog(parseWireSaveDialogRequest(params));
                return { uri: uri ?? null };
            }),
        );
        store.add(
            rpc.handleRequest("window.showMessage", async (params): Promise<IWireShowMessageResult> => {
                const request = parseWireShowMessageRequest(params);
                if (request === null) return { index: null };
                logExtensionMessage(logger, request.severity, request.message);
                if (notificationSink === undefined) return { index: null };
                // Stryker disable next-line UpdateOperator: от счётчика нужна только уникальность адреса, направление шага ненаблюдаемо
                const handle = this.nextMessageHandle++;
                messageHandles.add(handle);
                // Сбой показа — наша поломка: отказ запроса отклонил бы `await show*Message`
                // расширения, а необработанный reject валит весь субпроцесс (поймано живым прогоном).
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

        store.add({
            dispose: () => {
                attached = false;
                for (const handle of progressHandles) progressSink?.end(handle);
                statusBarItemSink?.clear();
                // Stryker disable next-line OptionalChaining: handle попадает в набор только после проверки стока, поэтому пары «набор непуст, а стока нет» не бывает; `?.` стоит защитой
                for (const handle of quickInputHandles) quickInputSink?.cancel(handle);
                // Stryker disable next-line OptionalChaining: см. выше
                for (const handle of messageHandles) notificationSink?.cancel(handle);
                // Stryker disable next-line OptionalChaining: см. выше
                for (const handle of quickPickHandles) quickInputSink?.disposeQuickPick(handle);
            },
        });
        return store;
    }
}

/** Тост гаснет, а прочитать, что расширение сказало, надо и потом. */
function logExtensionMessage(logger: ILogger | undefined, severity: WireMessageSeverity, text: string): void {
    if (severity === "error") logger?.error(`[extension] ${text}`);
    else if (severity === "warn") logger?.warn(`[extension] ${text}`);
    else logger?.info(`[extension] ${text}`);
}

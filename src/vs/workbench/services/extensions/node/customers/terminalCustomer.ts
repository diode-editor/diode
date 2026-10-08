import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionTerminalSink } from "../../../../api/common/iExtensionWindowSinks.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireTerminalCreate,
    parseWireTerminalSendText,
    parseWireTerminalShow,
    parseWireTerminalTarget,
} from "../hostWireParsers.ts";

/**
 * Терминалы для расширений (`MainThreadTerminalService` эталона):
 * нотификации `terminal.*` субпроцесса уходят в сток, а жизнь инстансов
 * встроенного терминала — всех, не только заведённых расширением, —
 * возвращается субпроцессу `terminal.opened`/`closed`/`activeChanged`.
 *
 * Пересказ начинается с {@link pushInitialState} (после `host.ready`, до первой
 * активации): до него у субпроцесса нет обработчиков, а всё случившееся раньше
 * войдёт в снимок. Без стока терминалы заводятся «в никуда»: расширение
 * получает объект, но `onDidOpenTerminal` не стреляет.
 */
export class TerminalCustomer implements IExtensionHostCustomer {
    /** Живой спавн: его RPC и признак «снимок уже ушёл, события можно слать». */
    private spawn: { readonly rpc: HostRpc; ready: boolean } | null = null;

    public constructor(private readonly sink: IExtensionTerminalSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        if (sink === undefined) return store;
        const spawn = { rpc, ready: false };
        this.spawn = spawn;

        store.add(
            sink.subscribe({
                opened: (terminal) => {
                    if (spawn.ready) rpc.notify("terminal.opened", terminal);
                },
                closed: (terminal) => {
                    if (spawn.ready) rpc.notify("terminal.closed", terminal);
                },
                activeChanged: (id) => {
                    if (spawn.ready) rpc.notify("terminal.activeChanged", { id });
                },
            }),
        );
        store.add(
            rpc.handleNotification("terminal.create", (params) => {
                const request = parseWireTerminalCreate(params);
                if (request !== null) sink.create(request);
            }),
        );
        store.add(
            rpc.handleNotification("terminal.show", (params) => {
                const request = parseWireTerminalShow(params);
                if (request !== null) sink.show(request.terminal, request.preserveFocus);
            }),
        );
        store.add(
            rpc.handleNotification("terminal.hide", (params) => {
                const request = parseWireTerminalTarget(params);
                if (request !== null) sink.hide(request.terminal);
            }),
        );
        store.add(
            rpc.handleNotification("terminal.sendText", (params) => {
                const request = parseWireTerminalSendText(params);
                if (request !== null) sink.sendText(request.terminal, request.text, request.shouldExecute);
            }),
        );
        store.add(
            rpc.handleNotification("terminal.dispose", (params) => {
                const request = parseWireTerminalTarget(params);
                if (request !== null) sink.dispose(request.terminal);
            }),
        );
        store.add({
            dispose: () => {
                if (this.spawn === spawn) this.spawn = null;
                // Метки умершего субпроцесса больше ничего не значат; шеллы живут.
                sink.reset();
            },
        });
        return store;
    }

    /**
     * Семя субпроцесса (`$acceptTerminalOpened` по всем инстансам и активный —
     * в конструкторе `MainThreadTerminalService` эталона); дальше — события.
     */
    public pushInitialState(): void {
        const spawn = this.spawn;
        if (spawn === null || this.sink === undefined) return;
        const { terminals, activeId } = this.sink.snapshot();
        for (const terminal of terminals) spawn.rpc.notify("terminal.opened", terminal);
        spawn.rpc.notify("terminal.activeChanged", { id: activeId });
        spawn.ready = true;
    }
}

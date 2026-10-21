import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { IExtensionTerminalSink } from "../../../../api/common/iExtensionWindowSinks.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireTerminalCreate,
    parseWireTerminalPtyData,
    parseWireTerminalPtyExit,
    parseWireTerminalSendText,
    parseWireTerminalShow,
    parseWireTerminalTarget,
} from "../hostWireParsers.ts";

/**
 * Upstream `MainThreadTerminalService`. The subprocess is told about all terminals,
 * not only those created by an extension, starting with {@link pushInitialState} (after
 * `host.ready`, before the first activation): before that the subprocess has no handlers,
 * and everything that happened earlier goes into the snapshot.
 */
export class TerminalCustomer implements IExtensionHostCustomer {
    /**
     * Liveness flag: cleanup on subprocess death closes its pty terminals, and there is no one left to send their
     * `closed` to.
     */
    private spawn: {
        readonly rpc: HostRpc;
        readonly sink: IExtensionTerminalSink;
        ready: boolean;
        alive: boolean;
    } | null = null;

    public constructor(private readonly sink: IExtensionTerminalSink | undefined) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        const sink = this.sink;
        if (sink === undefined) return store;
        const spawn = { rpc, sink, ready: false, alive: true };
        const seeded = (): boolean => spawn.alive && spawn.ready;
        this.spawn = spawn;

        store.add(
            sink.subscribe({
                opened: (terminal) => {
                    if (seeded()) rpc.notify("terminal.opened", terminal);
                },
                closed: (terminal) => {
                    if (seeded()) rpc.notify("terminal.closed", terminal);
                },
                activeChanged: (id) => {
                    if (seeded()) rpc.notify("terminal.activeChanged", { id });
                },
                // No gate needed: only a live subprocess creates a pty terminal, and cleaning up
                // its pty on death triggers neither start, nor input, nor resize.
                ptyStart: (id, cols, rows) => {
                    rpc.notify("terminal.pty.start", { id, cols, rows });
                },
                ptyInput: (id, data) => {
                    rpc.notify("terminal.pty.input", { id, data });
                },
                ptyResize: (id, cols, rows) => {
                    rpc.notify("terminal.pty.resize", { id, cols, rows });
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
        store.add(
            rpc.handleNotification("terminal.pty.data", (params) => {
                const request = parseWireTerminalPtyData(params);
                if (request !== null) sink.ptyData(request.terminal, request.data);
            }),
        );
        store.add(
            rpc.handleNotification("terminal.pty.exit", (params) => {
                const request = parseWireTerminalPtyExit(params);
                if (request !== null) sink.ptyExit(request.terminal, request.code);
            }),
        );
        store.add({
            dispose: () => {
                spawn.alive = false;
                if (this.spawn === spawn) this.spawn = null;
                sink.reset();
            },
        });
        return store;
    }

    /**
     * Like the upstream `MainThreadTerminalService` constructor: `$acceptTerminalOpened` for all instances, plus
     * the active one.
     */
    public pushInitialState(): void {
        const spawn = this.spawn;
        if (spawn === null) return;
        const { terminals, activeId } = spawn.sink.snapshot();
        for (const terminal of terminals) spawn.rpc.notify("terminal.opened", terminal);
        spawn.rpc.notify("terminal.activeChanged", { id: activeId });
        spawn.ready = true;
    }
}

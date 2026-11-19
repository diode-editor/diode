import { DisposableMap, DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type {
    IExtensionTerminalProfileSink,
    IExtensionTerminalSink,
} from "../../../../api/common/iExtensionWindowSinks.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import {
    parseWireTerminalCreate,
    parseWireTerminalExecuteCommand,
    parseWireTerminalProfileProvider,
    parseWireTerminalPtyData,
    parseWireTerminalPtyExit,
    parseWireTerminalPtyName,
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

    public constructor(
        private readonly sink: IExtensionTerminalSink | undefined,
        private readonly profiles?: IExtensionTerminalProfileSink,
    ) {}

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        const store = new DisposableStore();
        if (this.profiles !== undefined) store.add(attachProfileProviders(rpc, this.profiles));
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
                interaction: (id) => {
                    if (seeded()) rpc.notify("terminal.interaction", { id });
                },
                titleChanged: (id, name) => {
                    if (seeded()) rpc.notify("terminal.titleChanged", { id, name });
                },
                shellIntegrationChanged: (event) => {
                    if (seeded()) rpc.notify("terminal.shellIntegration.changed", event);
                },
                shellIntegrationCwd: (event) => {
                    if (seeded()) rpc.notify("terminal.shellIntegration.cwd", event);
                },
                shellIntegrationEnv: (event) => {
                    if (seeded()) rpc.notify("terminal.shellIntegration.env", event);
                },
                shellExecutionStart: (event) => {
                    if (seeded()) rpc.notify("terminal.shellExecution.start", event);
                },
                shellExecutionData: (event) => {
                    if (seeded()) rpc.notify("terminal.shellExecution.data", event);
                },
                shellExecutionEnd: (event) => {
                    if (seeded()) rpc.notify("terminal.shellExecution.end", event);
                },
            }),
        );
        store.add(
            rpc.handleNotification("terminal.shellIntegration.executeCommand", (params) => {
                const request = parseWireTerminalExecuteCommand(params);
                if (request !== null) sink.executeCommand(request.id, request.commandLine);
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
        store.add(
            rpc.handleNotification("terminal.pty.name", (params) => {
                const request = parseWireTerminalPtyName(params);
                if (request !== null) sink.ptyName(request.terminal, request.name);
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
     * the active one; then, as the `MainThreadTerminalShellIntegration` constructor, the shell integration already
     * alive, with its cwd and environment.
     */
    public pushInitialState(): void {
        const spawn = this.spawn;
        if (spawn === null) return;
        const { rpc } = spawn;
        const { terminals, activeId, shellIntegrations } = spawn.sink.snapshot();
        for (const terminal of terminals) rpc.notify("terminal.opened", terminal);
        rpc.notify("terminal.activeChanged", { id: activeId });
        for (const { integration, cwd, env } of shellIntegrations) {
            rpc.notify("terminal.shellIntegration.changed", integration);
            if (cwd !== undefined) rpc.notify("terminal.shellIntegration.cwd", cwd);
            if (env !== undefined) rpc.notify("terminal.shellIntegration.env", env);
        }
        spawn.ready = true;
    }
}

/** Upstream `$registerProfileProvider`/`$unregisterProfileProvider`; the registrations die with the spawn. */
function attachProfileProviders(rpc: HostRpc, profiles: IExtensionTerminalProfileSink): IDisposable {
    const store = new DisposableStore();
    const providers = store.add(new DisposableMap<string>());
    store.add(
        rpc.handleNotification("terminal.registerProfileProvider", (params) => {
            const request = parseWireTerminalProfileProvider(params);
            if (request === null) return;
            const { id } = request;
            providers.set(
                id,
                profiles.registerProvider(id, async (target) => {
                    await rpc.request("terminal.createContributedProfile", {
                        id,
                        location: target === "editor" ? 2 : 1,
                    });
                }),
            );
        }),
    );
    store.add(
        rpc.handleNotification("terminal.unregisterProfileProvider", (params) => {
            const request = parseWireTerminalProfileProvider(params);
            if (request !== null) providers.deleteAndDispose(request.id);
        }),
    );
    return store;
}

import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter, TerminalExitReason, Uri } from "./vscodeTypes.ts";
import {
    type IWireTerminalCreate,
    type IWireTerminalLaunch,
    type IWireTerminalLocation,
    type IWireTerminalRef,
    parseWireTerminalActive,
    parseWireTerminalClosed,
    parseWireTerminalOpened,
    parseWireTerminalPtyDimensions,
    parseWireTerminalPtyInput,
    type WireTerminalExitReason,
} from "./wireTypes.ts";

/**
 * Upstream's `ExtHostTerminalService`. The host relays the lifecycle of ALL instances, including
 * the user's shells. A pty terminal's `sendText` goes through the host, as upstream, so it never overtakes `open`.
 */
export interface ITerminalNamespace {
    readonly terminals: readonly vscode.Terminal[];
    readonly activeTerminal: vscode.Terminal | undefined;
    readonly onDidOpenTerminal: vscode.Event<vscode.Terminal>;
    readonly onDidCloseTerminal: vscode.Event<vscode.Terminal>;
    readonly onDidChangeActiveTerminal: vscode.Event<vscode.Terminal | undefined>;
    createTerminal(name?: string, shellPath?: string, shellArgs?: readonly string[] | string): vscode.Terminal;
    createTerminal(options: vscode.TerminalOptions | vscode.ExtensionTerminalOptions): vscode.Terminal;
    /** The previous pty of the same terminal (task rerun) is detached without `close()`: it has already closed itself. */
    attachPty(terminalId: number, pty: vscode.Pseudoterminal): void;
}

/** As upstream `TerminalDataBufferer`. */
export const PTY_DATA_BUFFER_MS = 5;

class ExtensionPty {
    private readonly subscriptions: vscode.Disposable[] = [];
    private pending = "";
    private timer: ReturnType<typeof setTimeout> | undefined;

    public constructor(
        private readonly pty: vscode.Pseudoterminal,
        private readonly ref: IWireTerminalRef,
        private readonly rpc: SubprocessRpc,
    ) {}

    public start(cols: number, rows: number): void {
        this.subscriptions.push(
            this.pty.onDidWrite((data) => {
                this.pending += data;
                this.timer ??= setTimeout(() => {
                    this.flush();
                }, PTY_DATA_BUFFER_MS);
            }),
        );
        const onDidClose = this.pty.onDidClose;
        if (onDidClose !== undefined) {
            this.subscriptions.push(
                onDidClose((code) => {
                    this.flush();
                    // `undefined` does not survive JSON — an exit without a code arrives as such.
                    this.rpc.notify("terminal.pty.exit", { terminal: this.ref, code: code as number | undefined });
                }),
            );
        }
        const dimensions = { columns: cols, rows };
        this.pty.open(dimensions);
        this.pty.setDimensions?.(dimensions);
    }

    public input(data: string): void {
        this.pty.handleInput?.(data);
    }

    public resize(cols: number, rows: number): void {
        this.pty.setDimensions?.({ columns: cols, rows });
    }

    public shutdown(): void {
        this.detach();
        try {
            this.pty.close();
        } catch {
            // The extension's `close()` threw — that does not block closing the terminal.
        }
    }

    public detach(): void {
        clearTimeout(this.timer);
        for (const sub of this.subscriptions) sub.dispose();
    }

    private flush(): void {
        // From onDidClose the timer is still armed: left alone, it would later send the batch after the instance closed.
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.pending === "") return;
        const data = this.pending;
        this.pending = "";
        this.rpc.notify("terminal.pty.data", { terminal: this.ref, data });
    }
}

const EXIT_REASONS: Readonly<Record<WireTerminalExitReason, TerminalExitReason>> = {
    unknown: TerminalExitReason.Unknown,
    shutdown: TerminalExitReason.Shutdown,
    process: TerminalExitReason.Process,
    user: TerminalExitReason.User,
    extension: TerminalExitReason.Extension,
};

class TerminalRecord {
    public name: string;
    public exitStatus: vscode.TerminalExitStatus | undefined;
    public disposed = false;
    public readonly value: vscode.Terminal;
    /** Resolves to `undefined` for a pty or a foreign terminal without a process. */
    private readonly pid = Promise.withResolvers<number | undefined>();
    public pty: ExtensionPty | undefined;
    /** A task terminal attaches its pty later and starts with the last size from the host. */
    public dimensions: { cols: number; rows: number } | undefined;

    public constructor(
        /** An own terminal is addressed by the subprocess tag (the host keeps it until close), a foreign one by the host id. */
        public readonly ref: IWireTerminalRef,
        name: string,
        creationOptions: vscode.TerminalOptions | vscode.ExtensionTerminalOptions,
        rpc: SubprocessRpc,
    ) {
        this.name = name;
        const frozen = Object.freeze(creationOptions);
        const name_ = (): string => this.name;
        const pid = (): Promise<number | undefined> => this.pid.promise;
        const exitStatus = (): vscode.TerminalExitStatus | undefined => this.exitStatus;
        const live = (): IWireTerminalRef => {
            // As upstream `_checkDisposed`: methods of an already disposed terminal throw.
            if (this.disposed) throw new Error("Terminal has already been disposed");
            return this.ref;
        };
        this.value = {
            get name(): string {
                return name_();
            },
            get processId(): Thenable<number | undefined> {
                return pid();
            },
            creationOptions: frozen,
            get exitStatus(): vscode.TerminalExitStatus | undefined {
                return exitStatus();
            },
            // Deviation (see API-COVERAGE): the host does not relay user input.
            state: { isInteractedWith: false, shell: undefined },
            // No shell integration: by contract `undefined` means "not activated", and extensions fall back to `sendText`.
            shellIntegration: undefined,
            sendText: (text: string, shouldExecute = true): void => {
                rpc.notify("terminal.sendText", { terminal: live(), text, shouldExecute });
            },
            show: (preserveFocus?: boolean): void => {
                rpc.notify("terminal.show", { terminal: live(), preserveFocus: preserveFocus === true });
            },
            hide: (): void => {
                rpc.notify("terminal.hide", { terminal: live() });
            },
            dispose: (): void => {
                if (this.disposed) return;
                this.disposed = true;
                rpc.notify("terminal.dispose", { terminal: this.ref });
            },
        };
    }

    public get extHostId(): number | undefined {
        return (this.ref as Partial<{ readonly extHostId: number }>).extHostId;
    }

    public settlePid(pid: number | undefined): void {
        this.pid.resolve(pid);
    }
}

function normalizeOptions(
    nameOrOptions: string | vscode.TerminalOptions | undefined,
    shellPath: string | undefined,
    shellArgs: readonly string[] | string | undefined,
): vscode.TerminalOptions {
    if (typeof nameOrOptions === "object") return nameOrOptions;
    return {
        ...(nameOrOptions !== undefined ? { name: nameOrOptions } : {}),
        ...(shellPath !== undefined ? { shellPath } : {}),
        ...(shellArgs !== undefined ? { shellArgs: shellArgs as string[] | string } : {}),
    };
}

/** `iconPath`/`color`/`isTransient` are not sent: tabs have no icons or colors, and terminals are never restored anyway. */
function toWireCreate(
    extHostId: number,
    options: vscode.TerminalOptions,
    location: IWireTerminalLocation | undefined,
): IWireTerminalCreate {
    const { shellArgs, cwd, env } = options;
    const args = typeof shellArgs === "string" ? shellArgs.split(/\s/u).filter((a) => a !== "") : shellArgs;
    const wireEnv: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(env ?? {})) {
        if (value !== undefined) wireEnv[key] = value;
    }
    return {
        extHostId,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.shellPath !== undefined ? { shellPath: options.shellPath } : {}),
        ...(args !== undefined ? { shellArgs: args } : {}),
        ...(cwd !== undefined ? { cwd: typeof cwd === "string" ? cwd : cwd.fsPath } : {}),
        ...(env !== undefined ? { env: wireEnv } : {}),
        ...(options.strictEnv === true ? { strictEnv: true } : {}),
        ...(options.hideFromUser === true ? { hideFromUser: true } : {}),
        ...(options.message !== undefined ? { message: options.message } : {}),
        ...(location !== undefined ? { location } : {}),
    };
}

/** Upstream's `_serializeParentTerminal`: an unknown parent (closed, foreign object) drops the option. */
function toWireLocation(
    location: vscode.TerminalOptions["location"],
    refOf: (terminal: vscode.Terminal) => IWireTerminalRef | undefined,
): IWireTerminalLocation | undefined {
    if (typeof location === "number") {
        // `TerminalLocation` numbers match the wire; unknown ones mean "unset".
        const value: number = location;
        return value === 1 || value === 2 ? value : undefined;
    }
    if (location === undefined) return undefined;
    if ("viewColumn" in location) {
        return {
            viewColumn: location.viewColumn,
            ...(location.preserveFocus === true ? { preserveFocus: true } : {}),
        };
    }
    const parentTerminal = refOf(location.parentTerminal);
    return parentTerminal === undefined ? undefined : { parentTerminal };
}

function fromWireLaunch(launch: IWireTerminalLaunch): vscode.TerminalOptions {
    return {
        ...(launch.name !== undefined ? { name: launch.name } : {}),
        ...(launch.shellPath !== undefined ? { shellPath: launch.shellPath } : {}),
        ...(launch.shellArgs !== undefined ? { shellArgs: [...launch.shellArgs] } : {}),
        ...(launch.cwd !== undefined ? { cwd: Uri.file(launch.cwd) } : {}),
        ...(launch.env !== undefined ? { env: { ...launch.env } } : {}),
        ...(launch.hideFromUser !== undefined ? { hideFromUser: launch.hideFromUser } : {}),
    };
}

export function createTerminalNamespace(rpc: SubprocessRpc): ITerminalNamespace {
    const order: TerminalRecord[] = [];
    const byId = new Map<number | null, TerminalRecord>();
    /** `get`/`delete` with `undefined` (a foreign terminal) are no-ops. */
    const byExtHostId = new Map<number | undefined, TerminalRecord>();
    let nextExtHostId = 1;
    let active: TerminalRecord | undefined;

    const onDidOpenTerminal = new EventEmitter<vscode.Terminal>();
    const onDidCloseTerminal = new EventEmitter<vscode.Terminal>();
    const onDidChangeActiveTerminal = new EventEmitter<vscode.Terminal | undefined>();

    rpc.handleNotification("terminal.opened", (params) => {
        const opened = parseWireTerminalOpened(params);
        if (opened === null || byId.has(opened.id)) return;
        const own = byExtHostId.get(opened.extHostId);
        const record = own ?? new TerminalRecord({ id: opened.id }, opened.name, fromWireLaunch(opened.launch), rpc);
        if (own === undefined) order.push(record);
        record.name = opened.name;
        record.settlePid(opened.pid);
        byId.set(opened.id, record);
        onDidOpenTerminal.fire(record.value);
    });

    rpc.handleNotification("terminal.closed", (params) => {
        const closed = parseWireTerminalClosed(params);
        if (closed === null) return;
        const record = byId.get(closed.id);
        if (record === undefined) return;
        byId.delete(closed.id);
        byExtHostId.delete(record.extHostId);
        order.splice(order.indexOf(record), 1);
        record.exitStatus = {
            code: closed.code,
            reason: EXIT_REASONS[closed.reason] as unknown as vscode.TerminalExitReason,
        };
        record.pty?.shutdown();
        onDidCloseTerminal.fire(record.value);
    });

    rpc.handleNotification("terminal.pty.start", (params) => {
        const start = parseWireTerminalPtyDimensions(params);
        if (start === null) return;
        const record = byId.get(start.id);
        if (record === undefined) return;
        record.dimensions = { cols: start.cols, rows: start.rows };
        record.pty?.start(start.cols, start.rows);
    });

    rpc.handleNotification("terminal.pty.resize", (params) => {
        const resize = parseWireTerminalPtyDimensions(params);
        if (resize === null) return;
        const record = byId.get(resize.id);
        if (record === undefined) return;
        record.dimensions = { cols: resize.cols, rows: resize.rows };
        record.pty?.resize(resize.cols, resize.rows);
    });

    rpc.handleNotification("terminal.pty.input", (params) => {
        const input = parseWireTerminalPtyInput(params);
        if (input !== null) byId.get(input.id)?.pty?.input(input.data);
    });

    rpc.handleNotification("terminal.activeChanged", (params) => {
        const { id } = parseWireTerminalActive(params);
        const next = byId.get(id);
        // Unknown id — as upstream, the active terminal stays unchanged.
        if (next === undefined && id !== null) return;
        if (next === active) return;
        active = next;
        onDidChangeActiveTerminal.fire(next?.value);
    });

    function createTerminal(
        nameOrOptions?: string | vscode.TerminalOptions | vscode.ExtensionTerminalOptions,
        shellPath?: string,
        shellArgs?: readonly string[] | string,
    ): vscode.Terminal {
        const extHostId = nextExtHostId++;
        if (typeof nameOrOptions === "object" && "pty" in nameOrOptions) {
            const record = new TerminalRecord({ extHostId }, nameOrOptions.name, nameOrOptions, rpc);
            record.pty = new ExtensionPty(nameOrOptions.pty, { extHostId }, rpc);
            byExtHostId.set(extHostId, record);
            order.push(record);
            const location = toWireLocation(nameOrOptions.location, refOf);
            rpc.notify("terminal.create", {
                extHostId,
                pty: true,
                name: nameOrOptions.name,
                ...(location !== undefined ? { location } : {}),
            });
            return record.value;
        }
        const options = normalizeOptions(nameOrOptions, shellPath, shellArgs);
        // Resolve the parent before creating the record: a terminal cannot be its own parent.
        const location = toWireLocation(options.location, refOf);
        const record = new TerminalRecord({ extHostId }, options.name ?? "", options, rpc);
        byExtHostId.set(extHostId, record);
        order.push(record);
        rpc.notify("terminal.create", toWireCreate(extHostId, options, location));
        return record.value;
    }

    function refOf(terminal: vscode.Terminal): IWireTerminalRef | undefined {
        const record = order.find((r) => r.value === terminal);
        return record === undefined || record.disposed ? undefined : record.ref;
    }

    function attachPty(terminalId: number, pty: vscode.Pseudoterminal): void {
        const record = byId.get(terminalId);
        if (record === undefined)
            throw new Error(`Cannot resolve terminal with id ${String(terminalId)} for virtual process`);
        record.pty?.detach();
        record.pty = new ExtensionPty(pty, { id: terminalId }, rpc);
        const { cols, rows } = record.dimensions ?? { cols: 80, rows: 24 };
        record.pty.start(cols, rows);
    }

    return {
        attachPty,
        get terminals(): readonly vscode.Terminal[] {
            return order.map((r) => r.value);
        },
        get activeTerminal(): vscode.Terminal | undefined {
            return active?.value;
        },
        onDidOpenTerminal: onDidOpenTerminal.event,
        onDidCloseTerminal: onDidCloseTerminal.event,
        onDidChangeActiveTerminal: onDidChangeActiveTerminal.event,
        createTerminal,
    };
}

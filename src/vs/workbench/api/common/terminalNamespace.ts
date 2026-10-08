import type * as vscode from "vscode";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { EventEmitter, TerminalExitReason, Uri } from "./vscodeTypes.ts";
import {
    type IWireTerminalCreate,
    type IWireTerminalLaunch,
    type IWireTerminalRef,
    parseWireTerminalActive,
    parseWireTerminalClosed,
    parseWireTerminalOpened,
    type WireTerminalExitReason,
} from "./wireTypes.ts";

/**
 * Терминальная часть `vscode.window` в субпроцессе (`ExtHostTerminalService`
 * эталона): `createTerminal`, `terminals`, `activeTerminal` и три события.
 *
 * Состояние `vscode.Terminal` живёт здесь, инстансом владеет хост
 * (`TerminalCustomer` → встроенный терминал). Хост пересказывает жизнь ВСЕХ
 * инстансов, включая шеллы человека: `terminal.opened` (у своего терминала —
 * с `extHostId`), `terminal.closed`, `terminal.activeChanged`.
 */
export interface ITerminalNamespace {
    readonly terminals: readonly vscode.Terminal[];
    readonly activeTerminal: vscode.Terminal | undefined;
    readonly onDidOpenTerminal: vscode.Event<vscode.Terminal>;
    readonly onDidCloseTerminal: vscode.Event<vscode.Terminal>;
    readonly onDidChangeActiveTerminal: vscode.Event<vscode.Terminal | undefined>;
    createTerminal(name?: string, shellPath?: string, shellArgs?: readonly string[] | string): vscode.Terminal;
    createTerminal(options: vscode.TerminalOptions): vscode.Terminal;
}

const EXIT_REASONS: Readonly<Record<WireTerminalExitReason, TerminalExitReason>> = {
    unknown: TerminalExitReason.Unknown,
    shutdown: TerminalExitReason.Shutdown,
    process: TerminalExitReason.Process,
    user: TerminalExitReason.User,
    extension: TerminalExitReason.Extension,
};

/** Один терминал: объект расширения и то, что о нём известно от хоста. */
class TerminalRecord {
    public name: string;
    public exitStatus: vscode.TerminalExitStatus | undefined;
    public disposed = false;
    public readonly value: vscode.Terminal;
    /** `processId`: резолвится pid из `terminal.opened` (у pty и чужого без процесса — `undefined`). */
    private readonly pid = Promise.withResolvers<number | undefined>();

    public constructor(
        /**
         * Адрес в нотификациях: свой терминал — меткой субпроцесса (хост помнит
         * её до закрытия), чужой — хостовым id.
         */
        private readonly ref: IWireTerminalRef,
        name: string,
        creationOptions: vscode.TerminalOptions,
        rpc: SubprocessRpc,
    ) {
        this.name = name;
        const frozen = Object.freeze(creationOptions);
        // Геттеры объекта расширения читают запись через стрелки: `this` литерала — сам литерал.
        const name_ = (): string => this.name;
        const pid = (): Promise<number | undefined> => this.pid.promise;
        const exitStatus = (): vscode.TerminalExitStatus | undefined => this.exitStatus;
        const live = (): IWireTerminalRef => {
            // Как `_checkDisposed` эталона: у уже отпущенного терминала методы бросают.
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
            // Ввод человека хост пока не пересказывает: состояние — как у
            // терминала, с которым ещё не работали (отступление, см. API-COVERAGE).
            state: { isInteractedWith: false, shell: undefined },
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

    /** Метка субпроцесса — только у терминала, который он сам завёл. */
    public get extHostId(): number | undefined {
        return (this.ref as Partial<{ readonly extHostId: number }>).extHostId;
    }

    public settlePid(pid: number | undefined): void {
        this.pid.resolve(pid);
    }
}

/** Аргументы `createTerminal` → `TerminalOptions` (позиционная форма эталона). */
function normalizeOptions(
    nameOrOptions: string | vscode.TerminalOptions | undefined,
    shellPath: string | undefined,
    shellArgs: readonly string[] | string | undefined,
): vscode.TerminalOptions {
    if (typeof nameOrOptions === "object") return nameOrOptions;
    return {
        ...(nameOrOptions !== undefined ? { name: nameOrOptions } : {}),
        ...(shellPath !== undefined ? { shellPath } : {}),
        ...(shellArgs !== undefined ? { shellArgs: typeof shellArgs === "string" ? shellArgs : [...shellArgs] } : {}),
    };
}

/**
 * `TerminalOptions` → `terminal.create`. Строковые `shellArgs` (Windows-форма
 * одной командной строкой) режутся по пробелам; `env` без `undefined`-значений;
 * `iconPath`/`color`/`location`/`isTransient` не уезжают — терминал всегда в панели.
 */
function toWireCreate(extHostId: number, options: vscode.TerminalOptions): IWireTerminalCreate {
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
    };
}

/** `creationOptions` чужого терминала — из того, чем его запустил хост. */
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
    /** Порядок появления — им отдаётся `terminals`. */
    const order: TerminalRecord[] = [];
    const byId = new Map<number, TerminalRecord>();
    /** Свои терминалы по метке; `get`/`delete` по `undefined` (чужой терминал) — пустые операции. */
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
        onDidCloseTerminal.fire(record.value);
    });

    rpc.handleNotification("terminal.activeChanged", (params) => {
        const { id } = parseWireTerminalActive(params);
        const next = id === null ? undefined : byId.get(id);
        // Незнакомый id — как у эталона: активный не меняется.
        if (next === undefined && id !== null) return;
        if (next === active) return;
        active = next;
        onDidChangeActiveTerminal.fire(next?.value);
    });

    function createTerminal(
        nameOrOptions?: string | vscode.TerminalOptions,
        shellPath?: string,
        shellArgs?: readonly string[] | string,
    ): vscode.Terminal {
        const options = normalizeOptions(nameOrOptions, shellPath, shellArgs);
        const extHostId = nextExtHostId++;
        const record = new TerminalRecord({ extHostId }, options.name ?? "", options, rpc);
        byExtHostId.set(extHostId, record);
        order.push(record);
        rpc.notify("terminal.create", toWireCreate(extHostId, options));
        return record.value;
    }

    return {
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

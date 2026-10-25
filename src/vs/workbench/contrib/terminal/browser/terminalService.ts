import { basename } from "node:path";

import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import {
    type ITerminalSession,
    type ITerminalSessionOptions,
    type TerminalSessionFactory,
    TerminalSessionFactoryDIToken,
} from "../common/terminalSessionFactory.ts";

export const TERMINAL_VIEW_ID = "terminal";

export const TerminalServiceDIToken = token<TerminalService>("TerminalService");

/** Until the first performLayout. */
export const INITIAL_COLS = 80;
export const INITIAL_ROWS = 24;

/** `user` — the Kill command, `extension` — the extension's `Terminal.dispose()`. */
export type TerminalExitReason = "process" | "user" | "extension";

/** What an extension sees as `Terminal.creationOptions` of a foreign terminal. */
export interface ITerminalLaunchInfo {
    readonly shellPath: string;
    readonly shellArgs: readonly string[] | undefined;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | null>> | undefined;
    readonly hideFromUser: boolean;
}

/** The TERMINAL view tab list and the active instance are panel-only; `TerminalEditorService` owns editor ones. */
export type TerminalTarget = "panel" | "editor";

export interface ITerminalInstance {
    readonly id: number;
    readonly target: TerminalTarget;
    /**
     * The "N:" number is prepended only by the quick pick and dropdown; identical titles aren't
     * deduplicated — as in upstream.
     */
    readonly title: string;
    readonly session: ITerminalSurface & Pick<ITerminalSession, "setAnsiColors" | "buffer" | "getCwd">;
    /** `undefined` if there is no process on our side. */
    readonly processId: number | undefined;
    readonly launch: ITerminalLaunchInfo;
    /** `undefined` while the shell is alive or if the instance was closed by something other than exit. */
    readonly exitCode: number | undefined;
    readonly exitReason: TerminalExitReason | undefined;
}

export interface IDisposedTerminalInstance extends ITerminalInstance {
    readonly exitReason: TerminalExitReason;
}

export interface ITerminalCreateOptions {
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    /** `null` removes the variable from the inherited environment. */
    readonly env?: Readonly<Record<string, string | null>>;
    /** The shell environment is exactly `env`, nothing inherited from the process. */
    readonly strictEnv?: boolean;
    /** Printed before shell output; not sent to the shell. */
    readonly message?: string;
    /**
     * The process runs, but it has no tab and doesn't become active until shown
     * ({@link TerminalService.showInstance}).
     */
    readonly hideFromUser?: boolean;
    /** An extension pty owns the process; of the shell options only `message` applies with it. */
    readonly session?: ITerminalSession;
    /**
     * Don't remove the instance after the process exits: print the exit code (if not 0) and
     * `waitOnExit`; any key or Kill closes it.
     */
    readonly waitOnExit?: TerminalWaitOnExit;
    /** Absent — the panel; `TerminalEditorService` opens a tab for an editor terminal. */
    readonly target?: TerminalTarget;
}

export type TerminalWaitOnExit = boolean | string | ((exitCode: number) => string);

export interface ITerminalRelaunchInstanceOptions extends Omit<
    ITerminalCreateOptions,
    "session" | "hideFromUser" | "target"
> {
    readonly clear?: boolean;
}

interface TerminalInstanceRecord extends ITerminalInstance {
    readonly session: ITerminalSession;
    readonly subscriptions: IDisposable[];
    target: TerminalTarget;
    title: string;
    processId: number | undefined;
    launch: ITerminalLaunchInfo;
    exitCode: number | undefined;
    exitReason: TerminalExitReason | undefined;
    waitOnExit: TerminalWaitOnExit | undefined;
    /** The process exited; the instance waits for a key (`waitOnExit`). */
    waiting: boolean;
    /** An extension pty owns the process — there is no command line. */
    readonly external: boolean;
}

/**
 * The shell spawns lazily — on TERMINAL tab activation or toggle/new commands.
 * `TerminalPanelComponent` builds widgets from service events. There are no groups (splits):
 * an upstream group is a single instance here.
 */
export class TerminalService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        ViewsServiceDIToken,
        IConfigurationServiceDIToken,
        TerminalSessionFactoryDIToken,
    ] as const;

    private instances: TerminalInstanceRecord[] = [];
    private backgroundInstances: TerminalInstanceRecord[] = [];
    private editorInstances: TerminalInstanceRecord[] = [];
    /** The panel host's active instance (the TERMINAL view tab list). */
    private activeId: number | null = null;
    /**
     * Upstream `_hostActiveTerminals` for the editor host: the terminal tab last active in the editor area.
     * Never reset: {@link editorActive} looks it up among the live editor instances, and ids are not reused.
     */
    private editorActiveId: number | null = null;
    /** Upstream `TerminalService._activeInstance`: the last active of the two hosts — `window.activeTerminal`. */
    private activeAcrossHostsId: number | null = null;
    private nextId = 1;
    private cwd: string | null = null;

    private readonly onDidOpenInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidCloseInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidChangeActiveInstanceEmitter = this.register(new Emitter<ITerminalInstance | null>());
    private readonly onDidChangeActiveInstanceAcrossHostsEmitter = this.register(
        new Emitter<ITerminalInstance | null>(),
    );
    private readonly onDidRequestFocusEmitter = this.register(new Emitter<void>());
    private readonly onDidCreateInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidDisposeInstanceEmitter = this.register(new Emitter<IDisposedTerminalInstance>());
    private readonly onDidExitInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidChangeInstanceTitleEmitter = this.register(new Emitter<ITerminalInstance>());

    public constructor(
        private readonly viewsService: ViewsService,
        private readonly configuration: IConfigurationService,
        private readonly factory: TerminalSessionFactory,
    ) {
        super();
        // Without a body the view draws a hint; the shell spawns on activation.
        viewsService.registerContainer({ id: TERMINAL_VIEW_ID, title: "TERMINAL", location: "panel", order: 2 });
        viewsService.registerView({
            canMoveView: true,
            id: TERMINAL_VIEW_ID,
            containerId: TERMINAL_VIEW_ID,
            title: "TERMINAL",
            order: 10,
            body: null,
            placeholder: "No active terminal.",
            focus: () => {
                this.ensureAndFocus();
            },
        });
        // The view activates in any part (panel, secondary panel, viewlet).
        this.register(
            viewsService.onDidActivateView((id) => {
                if (id === TERMINAL_VIEW_ID) this.ensureAndFocus();
            }),
        );
    }

    public get hasOpenTerminals(): boolean {
        return this.instances.length > 0;
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("terminalIsOpen", this.hasOpenTerminals);
        contextKeys.set("terminalCount", this.instances.length);
        // Ids are never reused: one handed out means a terminal was created, wherever it lives now.
        contextKeys.set("terminalHasBeenCreated", this.nextId > 1);
    }

    /** Excludes editor and background ones. */
    public getInstances(): readonly ITerminalInstance[] {
        return this.instances;
    }

    /** The panel's; for `window.activeTerminal` see {@link getActiveInstanceAcrossHosts}. */
    public getActiveInstance(): ITerminalInstance | null {
        return this.active() ?? null;
    }

    /**
     * Upstream `ITerminalService.activeInstance`: whichever host — the panel or the editor area —
     * activated a terminal last. A file tab becoming active does not reset it, so an extension's
     * `activeTerminal.show()` returns to the terminal tab instead of opening the panel.
     */
    public getActiveInstanceAcrossHosts(): ITerminalInstance | null {
        return this.find(this.activeAcrossHostsId ?? undefined) ?? null;
    }

    /**
     * Upstream `host.onDidFocusInstance` of the panel: the focused terminal is the active one across hosts, even
     * when a terminal tab was activated after it.
     */
    public setFocusedPanelInstance(id: number): void {
        const instance = this.instances.find((i) => i.id === id);
        if (instance !== undefined) this.evaluateActiveAcrossHosts(instance, undefined);
    }

    /** Upstream `TerminalEditorService.setActiveInstance`: a terminal tab became the active editor (or got the focus). */
    public setActiveEditorInstance(id: number): void {
        const instance = this.editorInstances.find((i) => i.id === id);
        if (instance === undefined) return;
        this.editorActiveId = id;
        this.evaluateActiveAcrossHosts(instance, undefined);
    }

    /** Including background ones. */
    public getInstance(id: number | undefined): ITerminalInstance | null {
        return this.find(id) ?? null;
    }

    public getBackgroundInstances(): readonly ITerminalInstance[] {
        return this.backgroundInstances;
    }

    public getEditorInstances(): readonly ITerminalInstance[] {
        return this.editorInstances;
    }

    public setWorkingDirectory(cwd: string): void {
        this.cwd = cwd;
    }

    public openTerminal(): void {
        this.ensureAndFocus();
    }

    public newTerminal(): void {
        this.createInstance();
        this.fireFocus();
    }

    /**
     * Without focus. Background and editor instances don't enter the tab list and don't become
     * active, but {@link onDidCreateInstance} reports them.
     */
    public createInstance(options: ITerminalCreateOptions = {}): ITerminalInstance {
        const id = this.nextId++;
        const cwd = options.cwd ?? this.cwd ?? process.cwd();
        const session =
            options.session ??
            this.factory({ cols: INITIAL_COLS, rows: INITIAL_ROWS, ...sessionOptions(options, cwd) });
        // For a ready session we print `message` ourselves — a shell session prints it on spawn.
        if (options.session !== undefined && options.message !== undefined)
            session.printMessage(`${options.message}\r\n`);
        const hideFromUser = options.hideFromUser === true;
        const instance: TerminalInstanceRecord = {
            id,
            target: options.target ?? "panel",
            title: titleOf(options, session),
            session,
            processId: session.pid,
            launch: launchInfo(options, session, cwd, hideFromUser),
            exitCode: undefined,
            exitReason: undefined,
            waitOnExit: options.waitOnExit,
            waiting: false,
            external: options.session !== undefined,
            subscriptions: [
                session.onExit((code) => {
                    this.handleProcessExit(instance, code);
                }),
                // A key after exit closes only a waiting terminal: for other exited
                // processes the instance is already removed by now.
                session.onDidInputAfterExit(() => {
                    // An exited non-waiting instance is removed on exit along with this subscription;
                    // the check is a safeguard.
                    // Stryker disable next-line ConditionalExpression: equivalent — see above
                    if (instance.waiting) this.removeInstance(instance, "user");
                }),
            ],
        };
        if (hideFromUser || instance.target === "editor") {
            (hideFromUser ? this.backgroundInstances : this.editorInstances).push(instance);
            this.onDidCreateInstanceEmitter.fire(instance);
            return instance;
        }
        this.instances.push(instance);
        this.activeId = id;
        this.onDidCreateInstanceEmitter.fire(instance);
        this.onDidOpenInstanceEmitter.fire(instance);
        this.firePanelActive(instance);
        return instance;
    }

    /** Same emulator, tab and id, new process (upstream `reuseTerminal`). A non-waiting instance — `undefined`. */
    public relaunchInstance(id: number, options: ITerminalRelaunchInstanceOptions = {}): ITerminalInstance | undefined {
        const instance = this.find(id);
        if (instance?.waiting !== true) return undefined;
        const cwd = options.cwd ?? this.cwd ?? process.cwd();
        instance.waiting = false;
        instance.exitCode = undefined;
        instance.waitOnExit = options.waitOnExit;
        instance.session.relaunch({
            ...sessionOptions(options, cwd),
            ...(options.clear === true ? { clear: true } : {}),
        });
        instance.processId = instance.session.pid;
        instance.launch = launchInfo(options, instance.session, cwd, instance.launch.hideFromUser);
        const title = titleOf(options, instance.session);
        if (title !== instance.title) {
            instance.title = title;
            this.onDidChangeInstanceTitleEmitter.fire(instance);
        }
        return instance;
    }

    /** The caller shows the panel, editor tab and focus. */
    public showInstance(id: number): void {
        const background = this.backgroundInstances.find((i) => i.id === id);
        if (background !== undefined) {
            this.backgroundInstances.splice(this.backgroundInstances.indexOf(background), 1);
            if (background.target === "editor") {
                this.editorInstances.push(background);
                return;
            }
            this.instances.push(background);
            this.onDidOpenInstanceEmitter.fire(background);
        }
        this.setActiveInstance(id);
    }

    /** Same process and emulator; the caller opens the editor tab. */
    public moveToEditor(id: number): ITerminalInstance | undefined {
        const instance = this.instances.find((i) => i.id === id);
        if (instance === undefined) return undefined;
        instance.target = "editor";
        this.removeFromPanel(instance, () => {
            this.editorInstances.push(instance);
        });
        return instance;
    }

    /** Goes last and becomes active; the caller removes the editor tab. */
    public moveToPanel(id: number): ITerminalInstance | undefined {
        const instance = this.editorInstances.find((i) => i.id === id);
        if (instance === undefined) return undefined;
        this.editorInstances.splice(this.editorInstances.indexOf(instance), 1);
        instance.target = "panel";
        this.instances.push(instance);
        this.activeId = id;
        this.onDidOpenInstanceEmitter.fire(instance);
        this.firePanelActive(instance);
        return instance;
    }

    /** Line breaks are sent as Enter presses (`\r`); `shouldExecute` appends Enter if it's not at the end. */
    public sendText(id: number | undefined, text: string, shouldExecute: boolean): void {
        const instance = this.find(id);
        if (instance === undefined) return;
        const normalized = text.replace(/\r?\n/gu, "\r");
        instance.session.write(shouldExecute && !normalized.endsWith("\r") ? `${normalized}\r` : normalized);
    }

    /** Without focus — like arrows and clicks in upstream's tab list. */
    public setActiveInstance(id: number): void {
        const instance = this.instances.find((i) => i.id === id);
        if (instance === undefined || this.activeId === id) return;
        this.activeId = id;
        this.firePanelActive(instance);
    }

    public setActiveInstanceByIndex(index: number): void {
        if (index < 0 || index >= this.instances.length) return;
        this.setActiveInstance(this.instances[index].id);
    }

    public setActiveToNext(): void {
        this.setActiveByOffset(1);
    }

    public setActiveToPrevious(): void {
        this.setActiveByOffset(-1);
    }

    /** The neighbor at the same index becomes active, otherwise the last one — like upstream `removeGroup`. */
    public closeInstance(id: number | undefined, reason: TerminalExitReason = "user"): void {
        this.removeInstance(this.find(id), reason);
    }

    public focusActive(): void {
        this.fireFocus();
    }

    /** Including background ones; for widgets see {@link onDidOpenInstance}. */
    public readonly onDidCreateInstance = this.onDidCreateInstanceEmitter.event;

    /** Including background ones; `exitReason`/`exitCode` are already set. */
    public readonly onDidDisposeInstance = this.onDidDisposeInstanceEmitter.event;

    /**
     * Fires before the instance is removed; a waiting one (`waitOnExit`) stays after it.
     * Closing via Kill or by an extension is not reported by this event.
     */
    public readonly onDidExitInstance = this.onDidExitInstanceEmitter.event;

    public readonly onDidChangeInstanceTitle = this.onDidChangeInstanceTitleEmitter.event;

    public readonly onDidOpenInstance = this.onDidOpenInstanceEmitter.event;

    public readonly onDidCloseInstance = this.onDidCloseInstanceEmitter.event;

    /** The panel's; `null` — no terminals left in it. */
    public readonly onDidChangeActiveInstance = this.onDidChangeActiveInstanceEmitter.event;

    /** {@link getActiveInstanceAcrossHosts} changed; `null` — no active terminal in either host. */
    public readonly onDidChangeActiveInstanceAcrossHosts = this.onDidChangeActiveInstanceAcrossHostsEmitter.event;

    public readonly onDidRequestFocus = this.onDidRequestFocusEmitter.event;

    public override dispose(): void {
        // Don't fire close events: their owner cleans up the widgets in its own dispose.
        for (const instance of [...this.instances, ...this.backgroundInstances, ...this.editorInstances])
            this.destroyInstance(instance);
        this.instances = [];
        this.backgroundInstances = [];
        this.editorInstances = [];
        this.activeId = null;
        super.dispose();
    }

    private ensureAndFocus(): void {
        if (this.active() === undefined) this.createInstance();
        this.fireFocus();
    }

    private setActiveByOffset(offset: number): void {
        const count = this.instances.length;
        // With one terminal the "next" one is itself, and setActiveInstance makes that a no-op.
        if (count === 0) return;
        const current = this.instances.findIndex((i) => i.id === this.activeId);
        const next = this.instances[(current + offset + count) % count];
        this.setActiveInstance(next.id);
    }

    private handleProcessExit(instance: TerminalInstanceRecord, code: number): void {
        instance.exitCode = code;
        this.onDidExitInstanceEmitter.fire(instance);
        const { waitOnExit } = instance;
        if (waitOnExit === undefined || waitOnExit === false) {
            this.removeInstance(instance, "process");
            return;
        }
        if (code !== 0) instance.session.printMessage(formatMessageForTerminal(exitMessage(instance, code)));
        const message = typeof waitOnExit === "function" ? waitOnExit(code) : waitOnExit;
        if (typeof message === "string") {
            instance.session.printMessage(formatMessageForTerminal(message, { excludeLeadingNewLine: true }));
        }
        instance.waiting = true;
    }

    /**
     * Closing the last one hides the panel (`hideOnLastClosed`) if the TERMINAL tab
     * is active — like upstream `hidePanel`.
     */
    private removeInstance(instance: TerminalInstanceRecord | undefined, reason: TerminalExitReason): void {
        if (instance === undefined) return;
        // Set the reason before any events: close/dispose subscribers already see it.
        const disposed: IDisposedTerminalInstance = Object.assign(instance, { exitReason: reason });
        for (const list of [this.backgroundInstances, this.editorInstances]) {
            const index = list.indexOf(instance);
            if (index === -1) continue;
            // Background and editor instances aren't among the view tabs — just remove.
            list.splice(index, 1);
            this.destroyInstance(instance);
            this.onDidDisposeInstanceEmitter.fire(disposed);
            if (this.editorActiveId === instance.id) this.evaluateActiveAcrossHosts(null, this.active());
            return;
        }
        this.removeFromPanel(
            instance,
            () => {
                this.destroyInstance(instance);
            },
            () => {
                this.onDidDisposeInstanceEmitter.fire(disposed);
            },
        );
    }

    /** `detach` — before the close event (kill or relocate), `closed` — after it. */
    private removeFromPanel(instance: TerminalInstanceRecord, detach: () => void, closed?: () => void): void {
        const index = this.instances.indexOf(instance);
        const wasActive = this.activeId === instance.id;
        this.instances.splice(index, 1);
        detach();
        this.onDidCloseInstanceEmitter.fire(instance);
        closed?.();

        if (!wasActive) return;
        const next = this.instances.at(Math.min(index, this.instances.length - 1)) ?? null;
        this.activeId = next === null ? null : next.id;
        this.firePanelActive(next);
        if (next !== null) return;
        if (!this.configuration.get("terminal.integrated.hideOnLastClosed")) return;
        this.viewsService.closeView(TERMINAL_VIEW_ID);
    }

    private firePanelActive(instance: TerminalInstanceRecord | null): void {
        this.onDidChangeActiveInstanceEmitter.fire(instance);
        this.evaluateActiveAcrossHosts(instance, this.editorActive());
    }

    /**
     * Upstream `_evaluateActiveInstance`: a host's new active instance wins; a host left without one
     * hands over to the other host's (`fallback`).
     */
    private evaluateActiveAcrossHosts(
        instance: TerminalInstanceRecord | null,
        fallback: TerminalInstanceRecord | undefined,
    ): void {
        const next = instance ?? fallback ?? null;
        const nextId = next === null ? null : next.id;
        if (nextId === this.activeAcrossHostsId) return;
        this.activeAcrossHostsId = nextId;
        this.onDidChangeActiveInstanceAcrossHostsEmitter.fire(next);
    }

    private destroyInstance(instance: TerminalInstanceRecord): void {
        instance.session.dispose();
        for (const sub of instance.subscriptions) sub.dispose();
    }

    private find(id: number | undefined): TerminalInstanceRecord | undefined {
        return [...this.instances, ...this.backgroundInstances, ...this.editorInstances].find((i) => i.id === id);
    }

    private active(): TerminalInstanceRecord | undefined {
        return this.instances.find((i) => i.id === this.activeId);
    }

    private editorActive(): TerminalInstanceRecord | undefined {
        return this.editorInstances.find((i) => i.id === this.editorActiveId);
    }

    private fireFocus(): void {
        this.onDidRequestFocusEmitter.fire();
    }
}

function sessionOptions(
    options: ITerminalRelaunchInstanceOptions,
    cwd: string,
): Omit<ITerminalSessionOptions, "cols" | "rows"> {
    return {
        cwd,
        ...(options.shellPath !== undefined ? { shell: options.shellPath } : {}),
        ...(options.shellArgs !== undefined ? { args: [...options.shellArgs] } : {}),
        ...(options.env !== undefined ? { env: { ...options.env } } : {}),
        ...(options.strictEnv === true ? { strictEnv: true } : {}),
        ...(options.message !== undefined ? { message: options.message } : {}),
    };
}

/** Upstream treats an empty name as "not set": the title comes from the process. */
function titleOf(options: ITerminalRelaunchInstanceOptions, session: ITerminalSession): string {
    return options.name !== undefined && options.name !== "" ? options.name : basename(session.shell);
}

function launchInfo(
    options: ITerminalRelaunchInstanceOptions,
    session: ITerminalSession,
    cwd: string,
    hideFromUser: boolean,
): ITerminalLaunchInfo {
    return { shellPath: session.shell, shellArgs: options.shellArgs, cwd, env: options.env, hideFromUser };
}

/** Like upstream `parseExitResult`; an extension pty has no command line. */
function exitMessage(instance: TerminalInstanceRecord, code: number): string {
    if (instance.external) return `The terminal process terminated with exit code: ${code}.`;
    const args = (instance.launch.shellArgs ?? []).map((a) => ` '${a}'`).join();
    return `The terminal process "${instance.launch.shellPath}${args}" terminated with exit code: ${code}.`;
}

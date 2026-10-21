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

/** До первого performLayout. */
export const INITIAL_COLS = 80;
export const INITIAL_ROWS = 24;

/** `user` — команда Kill, `extension` — `Terminal.dispose()` расширения. */
export type TerminalExitReason = "process" | "user" | "extension";

/** То, что расширение видит как `Terminal.creationOptions` чужого терминала. */
export interface ITerminalLaunchInfo {
    readonly shellPath: string;
    readonly shellArgs: readonly string[] | undefined;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | null>> | undefined;
    readonly hideFromUser: boolean;
}

/** Список вкладок вида TERMINAL и активный инстанс — только панельные; редакторными владеет `TerminalEditorService`. */
export type TerminalTarget = "panel" | "editor";

export interface ITerminalInstance {
    readonly id: number;
    readonly target: TerminalTarget;
    /**
     * Номер «N:» приписывают только quick pick и дропдаун, одинаковые заголовки не
     * дедуплицируются — как у эталона.
     */
    readonly title: string;
    readonly session: ITerminalSurface & Pick<ITerminalSession, "setAnsiColors">;
    /** `undefined`, если процесса на нашей стороне нет. */
    readonly processId: number | undefined;
    readonly launch: ITerminalLaunchInfo;
    /** `undefined`, пока шелл жив или если инстанс закрыли не выходом. */
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
    /** `null` снимает переменную из унаследованного окружения. */
    readonly env?: Readonly<Record<string, string | null>>;
    /** Окружение шелла — ровно `env`, без наследования от процесса. */
    readonly strictEnv?: boolean;
    /** Печатается до вывода шелла, в шелл не уходит. */
    readonly message?: string;
    /** Процесс жив, но вкладки нет и активным не становится, пока не покажут ({@link TerminalService.showInstance}). */
    readonly hideFromUser?: boolean;
    /** Процессом владеет pty расширения; из шелловых опций при ней работает только `message`. */
    readonly session?: ITerminalSession;
    /**
     * Не снимать инстанс после выхода процесса: печатается код выхода (если не 0) и
     * `waitOnExit`; закрывает любая клавиша или Kill.
     */
    readonly waitOnExit?: TerminalWaitOnExit;
    /** Без него — панель; вкладку редакторному открывает `TerminalEditorService`. */
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
    /** Процесс вышел, инстанс ждёт клавишу (`waitOnExit`). */
    waiting: boolean;
    /** Процессом владеет pty расширения — командной строки нет. */
    readonly external: boolean;
}

/**
 * Шелл спавнится лениво — по активации вкладки TERMINAL или командам toggle/new.
 * Виджеты строит `TerminalPanelComponent` по событиям сервиса. Групп (сплитов)
 * нет: группа эталона здесь — один инстанс.
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
    private activeId: number | null = null;
    private nextId = 1;
    private cwd: string | null = null;

    private readonly onDidOpenInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidCloseInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidChangeActiveInstanceEmitter = this.register(new Emitter<ITerminalInstance | null>());
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
        // Без тела view рисует подсказку; шелл спавнится при активации.
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
        // Вид активируется в любой части (панель, вторичная панель, вьюлет).
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
    }

    /** Без редакторных и фоновых. */
    public getInstances(): readonly ITerminalInstance[] {
        return this.instances;
    }

    public getActiveInstance(): ITerminalInstance | null {
        return this.active() ?? null;
    }

    /** В том числе фоновый. */
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
     * Без фокуса. Фоновый и редакторный в список вкладок не попадают и активными не
     * становятся, но {@link onDidCreateInstance} о них сообщает.
     */
    public createInstance(options: ITerminalCreateOptions = {}): ITerminalInstance {
        const id = this.nextId++;
        const cwd = options.cwd ?? this.cwd ?? process.cwd();
        const session =
            options.session ??
            this.factory({ cols: INITIAL_COLS, rows: INITIAL_ROWS, ...sessionOptions(options, cwd) });
        // Готовой сессии `message` печатаем сами — шелловая печатает его при спавне.
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
                // Клавиша после выхода закрывает только ждущий терминал: у
                // прочих вышедших процесса инстанс к этому моменту уже снят.
                session.onDidInputAfterExit(() => {
                    // Stryker disable next-line ConditionalExpression: эквивалентный — вышедший не ждущий инстанс снят на выходе вместе с этой подпиской; проверка — страховка
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
        this.onDidChangeActiveInstanceEmitter.fire(instance);
        return instance;
    }

    /** Эмулятор, вкладка и id те же, процесс новый (`reuseTerminal` эталона). Не ждущий инстанс — `undefined`. */
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

    /** Панель, вкладку редактора и фокус показывает вызывающий. */
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

    /** Процесс и эмулятор те же; вкладку редактора открывает вызывающий. */
    public moveToEditor(id: number): ITerminalInstance | undefined {
        const instance = this.instances.find((i) => i.id === id);
        if (instance === undefined) return undefined;
        instance.target = "editor";
        this.removeFromPanel(instance, () => {
            this.editorInstances.push(instance);
        });
        return instance;
    }

    /** Встаёт последним и становится активным; вкладку редактора снимает вызывающий. */
    public moveToPanel(id: number): ITerminalInstance | undefined {
        const instance = this.editorInstances.find((i) => i.id === id);
        if (instance === undefined) return undefined;
        this.editorInstances.splice(this.editorInstances.indexOf(instance), 1);
        instance.target = "panel";
        this.instances.push(instance);
        this.activeId = id;
        this.onDidOpenInstanceEmitter.fire(instance);
        this.onDidChangeActiveInstanceEmitter.fire(instance);
        return instance;
    }

    /** Переводы строк уходят нажатиями Enter (`\r`); `shouldExecute` дописывает Enter, если его нет в конце. */
    public sendText(id: number | undefined, text: string, shouldExecute: boolean): void {
        const instance = this.find(id);
        if (instance === undefined) return;
        const normalized = text.replace(/\r?\n/gu, "\r");
        instance.session.write(shouldExecute && !normalized.endsWith("\r") ? `${normalized}\r` : normalized);
    }

    /** Без фокуса — как стрелки и клик по списку вкладок эталона. */
    public setActiveInstance(id: number): void {
        const instance = this.instances.find((i) => i.id === id);
        if (instance === undefined || this.activeId === id) return;
        this.activeId = id;
        this.onDidChangeActiveInstanceEmitter.fire(instance);
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

    /** Активным становится сосед с тем же индексом, иначе последний — как `removeGroup` эталона. */
    public closeInstance(id: number | undefined, reason: TerminalExitReason = "user"): void {
        this.removeInstance(this.find(id), reason);
    }

    public focusActive(): void {
        this.fireFocus();
    }

    /** В том числе фоновый; для виджетов — {@link onDidOpenInstance}. */
    public readonly onDidCreateInstance = this.onDidCreateInstanceEmitter.event;

    /** В том числе фоновый; `exitReason`/`exitCode` уже заполнены. */
    public readonly onDidDisposeInstance = this.onDidDisposeInstanceEmitter.event;

    /**
     * Приходит раньше снятия инстанса; ждущий (`waitOnExit`) после него остаётся.
     * Закрытие Kill'ом и расширением этим событием не сообщается.
     */
    public readonly onDidExitInstance = this.onDidExitInstanceEmitter.event;

    public readonly onDidChangeInstanceTitle = this.onDidChangeInstanceTitleEmitter.event;

    public readonly onDidOpenInstance = this.onDidOpenInstanceEmitter.event;

    public readonly onDidCloseInstance = this.onDidCloseInstanceEmitter.event;

    /** `null` — терминалов не осталось. */
    public readonly onDidChangeActiveInstance = this.onDidChangeActiveInstanceEmitter.event;

    public readonly onDidRequestFocus = this.onDidRequestFocusEmitter.event;

    public override dispose(): void {
        // События close не файрим: виджеты чистит их владелец в своём dispose.
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
        // При одном терминале «следующий» — он сам, и setActiveInstance это погасит.
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
     * Последний закрытый прячет панель (`hideOnLastClosed`), если активна вкладка
     * TERMINAL — как `hidePanel` эталона.
     */
    private removeInstance(instance: TerminalInstanceRecord | undefined, reason: TerminalExitReason): void {
        if (instance === undefined) return;
        // Причина — до любых событий: подписчики close/dispose её уже видят.
        const disposed: IDisposedTerminalInstance = Object.assign(instance, { exitReason: reason });
        for (const list of [this.backgroundInstances, this.editorInstances]) {
            const index = list.indexOf(instance);
            if (index === -1) continue;
            // Фоновых и редакторных нет среди вкладок вида — только снять.
            list.splice(index, 1);
            this.destroyInstance(instance);
            this.onDidDisposeInstanceEmitter.fire(disposed);
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

    /** `detach` — до события закрытия (убить или переселить), `closed` — после него. */
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
        this.onDidChangeActiveInstanceEmitter.fire(next);
        if (next !== null) return;
        if (!this.configuration.get("terminal.integrated.hideOnLastClosed")) return;
        this.viewsService.closeView(TERMINAL_VIEW_ID);
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

/** Пустое имя у эталона — «не задано»: заголовок по процессу. */
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

/** Как `parseExitResult` эталона; у pty расширения командной строки нет. */
function exitMessage(instance: TerminalInstanceRecord, code: number): string {
    if (instance.external) return `The terminal process terminated with exit code: ${code}.`;
    const args = (instance.launch.shellArgs ?? []).map((a) => ` '${a}'`).join();
    return `The terminal process "${instance.launch.shellPath}${args}" terminated with exit code: ${code}.`;
}

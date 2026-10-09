import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IExtensionTerminalEvents, IExtensionTerminalSink } from "../../../api/common/iExtensionWindowSinks.ts";
import type {
    IWireTerminalCreate,
    IWireTerminalLaunch,
    IWireTerminalOpened,
    IWireTerminalRef,
} from "../../../api/common/wireTypes.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
import type { IExtensionPtyTerminalOptions, IExtensionPtyTerminals } from "../common/extensionPtyTerminals.ts";
import type { ExtensionPtySessionFactory, IExtensionPtySession } from "../common/terminalSessionFactory.ts";

import {
    INITIAL_COLS,
    INITIAL_ROWS,
    type ITerminalCreateOptions,
    type ITerminalInstance,
    TERMINAL_VIEW_ID,
    type TerminalService,
} from "./terminalService.ts";

/**
 * Мост `window.createTerminal` расширений к {@link TerminalService}
 * (`MainThreadTerminalService` эталона): шелл расширения — обычный инстанс
 * встроенного терминала с его опциями, `show`/`hide` водят нижнюю панель на
 * вкладке TERMINAL, а жизнь ВСЕХ инстансов (и шеллов человека) уходит
 * подписчику — так `window.terminals` видит каждый терминал, как у эталона.
 *
 * Свой терминал субпроцесс адресует `extHostId`, пока не узнал хостовый id
 * из `opened`; адаптер помнит соответствие до `reset()` (смерть субпроцесса).
 *
 * Pty расширения (`ExtensionTerminalOptions`) — инстанс с готовой сессией-
 * эмулятором (`session`, как `customPtyImplementation` эталона): вывод
 * pty приезжает `ptyData`, набор человека и размер виджета уходят подписчику
 * `ptyInput`/`ptyResize`, а `ptyStart` зовёт `pty.open` сразу после создания.
 */
export class ExtensionTerminalAdapter implements IExtensionTerminalSink, IExtensionPtyTerminals {
    /** `extHostId` субпроцесса → id инстанса (терминалов единицы — обратный поиск перебором). */
    private readonly byExtHostId = new Map<number, number>();
    /**
     * `extHostId` терминала, который заводится прямо сейчас: `onDidCreateInstance`
     * стреляет изнутри `createInstance`, раньше, чем тот вернёт инстанс.
     */
    private creating: number | undefined;
    /** Подписчик жизни инстансов — туда же уходят события pty. */
    private events: IExtensionTerminalEvents | null = null;
    /**
     * Живые pty-терминалы: id инстанса → сессия-эмулятор. Ключ допускает
     * `undefined` (неразрешённый адрес) — поиск по нему просто пуст.
     */
    private readonly ptySessions = new Map<number | undefined, IExtensionPtySession>();
    /** Pty, закрывшиеся без кода: `exitStatus.code` у расширения — `undefined`, как у эталона. */
    private readonly ptyExitedWithoutCode = new Set<number | undefined>();

    public constructor(
        private readonly terminals: TerminalService,
        private readonly panel: PanelService,
        private readonly createPtySession: ExtensionPtySessionFactory,
    ) {}

    public snapshot(): { readonly terminals: readonly IWireTerminalOpened[]; readonly activeId: number | null } {
        const all = [...this.terminals.getInstances(), ...this.terminals.getBackgroundInstances()].sort(
            (a, b) => a.id - b.id,
        );
        return {
            terminals: all.map((instance) => this.toOpened(instance)),
            activeId: this.terminals.getActiveInstance()?.id ?? null,
        };
    }

    public subscribe(events: IExtensionTerminalEvents): IDisposable {
        const store = new DisposableStore();
        this.events = events;
        store.add({
            dispose: () => {
                if (this.events === events) this.events = null;
            },
        });
        store.add(
            this.terminals.onDidCreateInstance((instance) => {
                events.opened(this.toOpened(instance));
            }),
        );
        store.add(
            this.terminals.onDidDisposeInstance((instance) => {
                const withoutCode = this.ptyExitedWithoutCode.delete(instance.id);
                this.ptySessions.delete(instance.id);
                events.closed({
                    id: instance.id,
                    ...(instance.exitCode !== undefined && !withoutCode ? { code: instance.exitCode } : {}),
                    reason: instance.exitReason,
                });
                // Метка закрытого больше ничего не адресует (у чужого её и нет).
                for (const [extHostId, id] of this.byExtHostId) {
                    if (id === instance.id) this.byExtHostId.delete(extHostId);
                }
            }),
        );
        store.add(
            this.terminals.onDidChangeActiveInstance((instance) => {
                events.activeChanged(instance === null ? null : instance.id);
            }),
        );
        return store;
    }

    public create(request: IWireTerminalCreate): void {
        // Повтор метки — не наш случай (субпроцесс минтит их монотонно); второй
        // инстанс под той же меткой сделал бы первый неадресуемым.
        if (this.byExtHostId.has(request.extHostId)) return;
        this.creating = request.extHostId;
        try {
            if (request.pty === true) {
                this.createPty(request.extHostId, request.name ?? "");
                return;
            }
            // Опции провода — те же поля, что у `createInstance` (разбор их уже
            // отфильтровал); лишняя метка сервису не мешает.
            const instance = this.terminals.createInstance(request);
            this.byExtHostId.set(request.extHostId, instance.id);
        } finally {
            this.creating = undefined;
        }
    }

    /**
     * `Terminal.show` (`$show` эталона): инстанс — активный (фоновый переезжает
     * в список вкладок), панель открыта на вкладке TERMINAL, фокус — в
     * терминал, если не `preserveFocus`.
     */
    public show(terminal: IWireTerminalRef, preserveFocus: boolean): void {
        const id = this.resolve(terminal);
        if (id === undefined) return;
        this.terminals.showInstance(id);
        this.panel.setActiveView(TERMINAL_VIEW_ID);
        this.panel.setVisible(true);
        if (!preserveFocus) this.terminals.focusActive();
    }

    /**
     * `Terminal.hide` (`$hide` эталона): прячет панель, только если показан
     * именно этот терминал (неразрешённый адрес не совпадёт ни с одним id).
     */
    public hide(terminal: IWireTerminalRef): void {
        const active = this.terminals.getActiveInstance();
        if (active === null || active.id !== this.resolve(terminal)) return;
        if (this.panel.getActiveViewId() !== TERMINAL_VIEW_ID) return;
        this.panel.setVisible(false);
    }

    /** Неразрешённый адрес сервис пропускает молча. */
    public sendText(terminal: IWireTerminalRef, text: string, shouldExecute: boolean): void {
        this.terminals.sendText(this.resolve(terminal), text, shouldExecute);
    }

    /** `Terminal.dispose` (`$dispose` эталона): инстанс закрывается с причиной `extension`. */
    public dispose(terminal: IWireTerminalRef): void {
        this.terminals.closeInstance(this.resolve(terminal), "extension");
    }

    public ptyData(terminal: IWireTerminalRef, data: string): void {
        this.ptySessions.get(this.resolve(terminal))?.feed(data);
    }

    public ptyExit(terminal: IWireTerminalRef, code: number | undefined): void {
        const id = this.resolve(terminal);
        const session = this.ptySessions.get(id);
        if (session === undefined) return;
        // Терминал задачи переживает выход pty и запускается заново — признак
        // «без кода» относится к последнему выходу.
        if (code === undefined) this.ptyExitedWithoutCode.add(id);
        else this.ptyExitedWithoutCode.delete(id);
        session.exit(code);
    }

    /**
     * Pty-терминал, который заводит ядро (терминал задачи с `CustomExecution`):
     * сам pty субпроцесс подключит по id инстанса, когда узнает о старте
     * задачи, — `ptyStart` с размером уходит сразу, субпроцесс его запомнит.
     */
    public createPtyInstance(options: IExtensionPtyTerminalOptions): number {
        return this.createPtySessionInstance(options.name, options);
    }

    /**
     * Субпроцесс умер: метки забыты, шеллы живут, а pty-терминалы закрываются —
     * их процесс (объект расширения) умер вместе с субпроцессом.
     */
    public reset(): void {
        this.byExtHostId.clear();
        for (const id of [...this.ptySessions.keys()]) this.terminals.closeInstance(id, "process");
    }

    private labelOf(instanceId: number): number | undefined {
        for (const [extHostId, id] of this.byExtHostId) if (id === instanceId) return extHostId;
        return undefined;
    }

    /**
     * Pty-терминал: инстанс с сессией-эмулятором; `ptyStart` с начальным
     * размером — сразу, как `$startExtensionTerminal` эталона при создании
     * инстанса. Настоящий размер виджета придёт `ptyResize` после раскладки.
     */
    private createPty(extHostId: number, name: string): void {
        this.byExtHostId.set(extHostId, this.createPtySessionInstance(name, {}));
    }

    private createPtySessionInstance(
        name: string,
        extra: Pick<ITerminalCreateOptions, "message" | "waitOnExit">,
    ): number {
        // Id инстанса узнаём после createInstance; ввод и ресайз виджета раньше не случаются.
        // Stryker disable next-line UnaryOperator: плейсхолдер до createInstance — колбэки сессии его не видят
        let instanceId = -1;
        const session = this.createPtySession({
            cols: INITIAL_COLS,
            rows: INITIAL_ROWS,
            name,
            onInput: (data) => {
                this.events?.ptyInput(instanceId, data);
            },
            onResize: (cols, rows) => {
                this.events?.ptyResize(instanceId, cols, rows);
            },
        });
        // Пустое имя сервис и так считает «не задано».
        const instance = this.terminals.createInstance({ ...extra, name, session });
        instanceId = instance.id;
        this.ptySessions.set(instance.id, session);
        this.events?.ptyStart(instance.id, INITIAL_COLS, INITIAL_ROWS);
        return instance.id;
    }

    private resolve(terminal: IWireTerminalRef): number | undefined {
        return "id" in terminal ? terminal.id : this.byExtHostId.get(terminal.extHostId);
    }

    private toOpened(instance: ITerminalInstance): IWireTerminalOpened {
        const extHostId = this.creating ?? this.labelOf(instance.id);
        return {
            id: instance.id,
            ...(extHostId !== undefined ? { extHostId } : {}),
            name: instance.title,
            ...(instance.processId !== undefined ? { pid: instance.processId } : {}),
            launch: toWireLaunch(instance),
        };
    }
}

/** `creationOptions` чужого терминала — из того, чем он запущен (`IShellLaunchConfigDto` эталона). */
function toWireLaunch(instance: ITerminalInstance): IWireTerminalLaunch {
    const { launch } = instance;
    return {
        name: instance.title,
        shellPath: launch.shellPath,
        ...(launch.shellArgs !== undefined ? { shellArgs: launch.shellArgs } : {}),
        cwd: launch.cwd,
        ...(launch.env !== undefined ? { env: launch.env } : {}),
        ...(launch.hideFromUser ? { hideFromUser: true } : {}),
    };
}

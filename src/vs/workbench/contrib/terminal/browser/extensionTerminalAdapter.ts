import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IExtensionTerminalEvents, IExtensionTerminalSink } from "../../../api/common/iExtensionWindowSinks.ts";
import type {
    IWireTerminalCreate,
    IWireTerminalLaunch,
    IWireTerminalLocation,
    IWireTerminalOpened,
    IWireTerminalRef,
} from "../../../api/common/wireTypes.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { IExtensionPtyTerminalOptions, IExtensionPtyTerminals } from "../common/extensionPtyTerminals.ts";
import type { ExtensionPtySessionFactory, IExtensionPtySession } from "../common/terminalSessionFactory.ts";

import type { ITerminalEditorLocation, TerminalEditorService } from "./terminalEditorService.ts";
import {
    INITIAL_COLS,
    INITIAL_ROWS,
    type ITerminalCreateOptions,
    type ITerminalInstance,
    TERMINAL_VIEW_ID,
    type TerminalService,
} from "./terminalService.ts";

/** Что мосту нужно от {@link TerminalEditorService}: вкладки-терминалы. */
export type IExtensionEditorTerminals = Pick<TerminalEditorService, "createTerminal" | "splitInstance" | "reveal">;

/**
 * Куда встаёт терминал расширения (`resolveLocation` эталона): вид TERMINAL,
 * вкладка в области редакторов или рядом с редакторным родителем.
 */
type TerminalPlace =
    | { readonly kind: "panel" }
    | { readonly kind: "editor"; readonly location: ITerminalEditorLocation }
    | { readonly kind: "split"; readonly parentId: number };

/**
 * Мост `window.createTerminal` расширений к {@link TerminalService}
 * (`MainThreadTerminalService` эталона): шелл расширения — обычный инстанс
 * встроенного терминала с его опциями; `location` ставит его в вид TERMINAL
 * или вкладкой в область редакторов ({@link TerminalEditorService});
 * `show`/`hide` водят вид TERMINAL либо вкладку, а жизнь ВСЕХ инстансов (и
 * шеллов человека) уходит подписчику — так `window.terminals` видит каждый
 * терминал, как у эталона.
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
        private readonly views: ViewsService,
        private readonly createPtySession: ExtensionPtySessionFactory,
        private readonly editorTerminals: IExtensionEditorTerminals,
        private readonly configuration: IConfigurationService,
    ) {}

    public snapshot(): { readonly terminals: readonly IWireTerminalOpened[]; readonly activeId: number | null } {
        const all = [
            ...this.terminals.getInstances(),
            ...this.terminals.getBackgroundInstances(),
            ...this.terminals.getEditorInstances(),
        ].sort((a, b) => a.id - b.id);
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
        // Родителя адресуем до заведения: метка нового ещё ничего не значит.
        const place = this.resolvePlace(request.location);
        this.creating = request.extHostId;
        try {
            if (request.pty === true) {
                this.createPty(request.extHostId, request.name ?? "", place);
                return;
            }
            // Опции провода — те же поля, что у `createInstance` (разбор их уже
            // отфильтровал); лишние метка и место сервису не мешают.
            const instance = this.createIn(place, request);
            this.byExtHostId.set(request.extHostId, instance.id);
        } finally {
            this.creating = undefined;
        }
    }

    /**
     * `Terminal.show` (`$show` эталона): фоновый переезжает в список вкладок
     * своего места; редакторный — его вкладка показана (`revealActiveEditor`),
     * панельный — активный, вид TERMINAL показан там, где стоит; фокус — в
     * терминал, если не `preserveFocus`.
     */
    public show(terminal: IWireTerminalRef, preserveFocus: boolean): void {
        const id = this.resolve(terminal);
        if (id === undefined) return;
        this.terminals.showInstance(id);
        if (this.terminals.getInstance(id)?.target === "editor") {
            this.editorTerminals.reveal(id, preserveFocus);
            return;
        }
        this.views.openView(TERMINAL_VIEW_ID, false, false);
        if (!preserveFocus) this.terminals.focusActive();
    }

    /**
     * `Terminal.hide` (`$hide` эталона): прячет часть с видом TERMINAL, только если показан
     * именно этот терминал (неразрешённый адрес не совпадёт ни с одним id).
     */
    public hide(terminal: IWireTerminalRef): void {
        const active = this.terminals.getActiveInstance();
        if (active === null || active.id !== this.resolve(terminal)) return;
        this.views.closeView(TERMINAL_VIEW_ID);
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
    private createPty(extHostId: number, name: string, place: TerminalPlace): void {
        this.byExtHostId.set(extHostId, this.createPtySessionInstance(name, {}, place));
    }

    private createPtySessionInstance(
        name: string,
        extra: Pick<ITerminalCreateOptions, "message" | "waitOnExit">,
        place: TerminalPlace = { kind: "panel" },
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
        const instance = this.createIn(place, { ...extra, name, session });
        instanceId = instance.id;
        this.ptySessions.set(instance.id, session);
        this.events?.ptyStart(instance.id, INITIAL_COLS, INITIAL_ROWS);
        return instance.id;
    }

    /**
     * Место по `location` провода: без него — `terminal.integrated.defaultLocation`;
     * родитель — туда же, где он: редакторный — вкладкой справа от его группы,
     * панельный — в вид (сплитов в виде нет). Родитель, которого уже нет, —
     * как отсутствие `location` (у эталона опция пропадает так же).
     */
    private resolvePlace(location: IWireTerminalLocation | undefined): TerminalPlace {
        if (location === 1) return { kind: "panel" };
        if (location === 2) return { kind: "editor", location: {} };
        if (location !== undefined && "viewColumn" in location) {
            return {
                kind: "editor",
                location: { viewColumn: location.viewColumn, preserveFocus: location.preserveFocus === true },
            };
        }
        const parent =
            location === undefined ? null : this.terminals.getInstance(this.resolve(location.parentTerminal));
        if (parent !== null)
            return parent.target === "editor" ? { kind: "split", parentId: parent.id } : { kind: "panel" };
        return this.configuration.get("terminal.integrated.defaultLocation") === "editor"
            ? { kind: "editor", location: {} }
            : { kind: "panel" };
    }

    private createIn(place: TerminalPlace, options: ITerminalCreateOptions): ITerminalInstance {
        switch (place.kind) {
            case "panel":
                return this.terminals.createInstance(options);
            case "split":
                return this.editorTerminals.splitInstance(place.parentId, options);
            case "editor":
                return this.editorTerminals.createTerminal(options, place.location);
        }
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

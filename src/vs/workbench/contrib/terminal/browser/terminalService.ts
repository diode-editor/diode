// Оркестратор встроенного терминала — headless-сервис: держит список инстансов
// (multi-terminal готов с первого дня — список-UI добавит следующий этап), лениво
// спавнит шелл при первом открытии/активации вкладки TERMINAL и убивает PTY при
// выходе шелла или dispose(). Виджеты (`TerminalViewElement`) сервис не трогает —
// ими владеет `TerminalPanelComponent`, подписанный на события инстансов.
//
// Связка с PTY/эмулятором спрятана за `TerminalSessionFactory` (DI-шов): в тестах
// фабрика возвращает FakeTerminalSurface, в проде — EmbeddedTerminalSession.
// См. docs/TODO/IntegratedTerminal.md.

import { basename } from "node:path";

import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { PanelServiceDIToken } from "../../../browser/parts/panel/panelService.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { type TerminalSessionFactory, TerminalSessionFactoryDIToken } from "../common/terminalSessionFactory.ts";

/** VS Code view id of the integrated Terminal view living in the bottom Panel. */
export const TERMINAL_VIEW_ID = "terminal";

export const TerminalServiceDIToken = token<TerminalService>("TerminalService");

/** Начальный размер PTY до первого performLayout (реальный размер придёт с ресайзом). */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

/** Один открытый терминал: сессия (PTY+эмулятор) за интерфейсом поверхности. */
export interface ITerminalInstance {
    readonly id: number;
    readonly title: string;
    /** Поверхность сессии — по ней компонент строит `TerminalViewElement`. */
    readonly session: ITerminalSurface;
}

interface TerminalInstanceRecord extends ITerminalInstance {
    readonly session: ITerminalSurface & IDisposable;
    readonly subscriptions: IDisposable[];
}

/**
 * Владеет инстансами встроенного терминала и вкладкой TERMINAL нижней Panel
 * (регистрирует её в {@link PanelService}; шелл спавнится **лениво** — по
 * `onDidActivateView` вкладки или командам toggle/new). Видимостью Panel
 * управляют toggle-команды через `PanelService.setVisible`; сервис лишь
 * создаёт/активирует инстансы и чистит PTY. View не знает: виджеты строит
 * `TerminalPanelComponent` по событиям `onDidOpenInstance` /
 * `onDidCloseInstance` / `onDidChangeActiveInstance` / `onDidRequestFocus`.
 */
export class TerminalService extends Disposable {
    public static dependencies = [PanelServiceDIToken, ViewsServiceDIToken, TerminalSessionFactoryDIToken] as const;

    private instances: TerminalInstanceRecord[] = [];
    private activeId: number | null = null;
    private nextId = 1;
    private cwd: string | null = null;

    private openListeners = new Set<(instance: ITerminalInstance) => void>();
    private closeListeners = new Set<(instance: ITerminalInstance) => void>();
    private activeListeners = new Set<(instance: ITerminalInstance | null) => void>();
    private focusListeners = new Set<() => void>();

    public constructor(
        panelService: PanelService,
        viewsService: ViewsService,
        private readonly factory: TerminalSessionFactory,
    ) {
        super();
        // Вкладка TERMINAL присутствует всегда; шелл спавнится лениво при её
        // активации, поэтому по умолчанию у view нет тела и она рисует подсказку.
        viewsService.registerContainer({ id: TERMINAL_VIEW_ID, title: "TERMINAL", location: "panel" });
        viewsService.registerView({
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
        viewsService.attachContainer(TERMINAL_VIEW_ID);
        // Клик по вкладке TERMINAL лениво спавнит шелл и фокусирует его; чужие
        // вкладки игнорируем.
        this.register(
            panelService.onDidActivateView((id) => {
                if (id === TERMINAL_VIEW_ID) this.ensureAndFocus();
            }),
        );
    }

    /** True, пока открыт хотя бы один инстанс терминала (для контекст-ключа terminalIsOpen). */
    public get hasOpenTerminals(): boolean {
        return this.instances.length > 0;
    }

    /** Открытые инстансы в порядке создания. */
    public getInstances(): readonly ITerminalInstance[] {
        return this.instances;
    }

    /** Активный инстанс или null, если ни одного не открыто. */
    public getActiveInstance(): ITerminalInstance | null {
        return this.active() ?? null;
    }

    /** Задать рабочий каталог для будущих инстансов (следует за папкой воркспейса). */
    public setWorkingDirectory(cwd: string): void {
        this.cwd = cwd;
    }

    /**
     * Показать активный терминал (создав лениво, если ни одного нет) и сфокусировать.
     * Используется командой Toggle Terminal и активацией вкладки.
     */
    public openTerminal(): void {
        this.ensureAndFocus();
    }

    /** Создать НОВЫЙ инстанс, сделать его активным и сфокусировать (команда «Create New Terminal»). */
    public newTerminal(): void {
        this.createInstance();
        this.fireFocus();
    }

    /** Создаёт инстанс терминала и делает его активным (без фокуса). */
    public createInstance(): void {
        const id = this.nextId++;
        const session = this.factory({ cols: INITIAL_COLS, rows: INITIAL_ROWS, cwd: this.cwd ?? process.cwd() });
        const shell = process.env.SHELL ?? "bash";
        const instance: TerminalInstanceRecord = {
            id,
            title: `${basename(shell)} (${id})`,
            session,
            subscriptions: [
                session.onExit(() => {
                    this.handleExit(instance);
                }),
            ],
        };
        this.instances.push(instance);
        this.activeId = id;
        for (const listener of [...this.openListeners]) listener(instance);
        for (const listener of [...this.activeListeners]) listener(instance);
    }

    /** Сфокусировать активный терминал (если он есть). */
    public focusActive(): void {
        this.fireFocus();
    }

    /** Открытие нового инстанса (компонент строит по нему виджет). */
    public onDidOpenInstance(listener: (instance: ITerminalInstance) => void): IDisposable {
        return this.subscribe(this.openListeners, listener);
    }

    /** Закрытие инстанса — выход шелла (компонент dispose'ит его виджет). */
    public onDidCloseInstance(listener: (instance: ITerminalInstance) => void): IDisposable {
        return this.subscribe(this.closeListeners, listener);
    }

    /** Смена активного инстанса; null — терминалов не осталось (вернуть placeholder). */
    public onDidChangeActiveInstance(listener: (instance: ITerminalInstance | null) => void): IDisposable {
        return this.subscribe(this.activeListeners, listener);
    }

    /** Запрос фокуса на виджет активного инстанса. */
    public onDidRequestFocus(listener: () => void): IDisposable {
        return this.subscribe(this.focusListeners, listener);
    }

    public override dispose(): void {
        // Убиваем все PTY и рвём подписки до базового dispose(). События close не
        // файрим: виджеты чистит их владелец (TerminalPanelComponent) в своём dispose.
        for (const instance of this.instances) this.destroyInstance(instance);
        this.instances = [];
        this.activeId = null;
        super.dispose();
    }

    /** Гарантирует активный инстанс (создав при необходимости) и фокусирует его. */
    private ensureAndFocus(): void {
        if (this.active() === undefined) this.createInstance();
        this.fireFocus();
    }

    /** Обработка выхода шелла: снести инстанс, переключиться на самый свежий из оставшихся. */
    private handleExit(instance: TerminalInstanceRecord): void {
        const index = this.instances.indexOf(instance);
        /* v8 ignore start -- defensive re-entrancy guard: both handleExit and dispose() drop the onExit subscription (via destroyInstance) as part of removing the instance, and a real session reports its exit asynchronously, so handleExit is never re-entered for an instance already gone from the list */
        if (index === -1) return; // уже снесён (dispose)
        /* v8 ignore stop */
        const wasActive = this.activeId === instance.id;
        this.instances.splice(index, 1);
        this.destroyInstance(instance);
        for (const listener of [...this.closeListeners]) listener(instance);

        if (!wasActive) return;
        const next = this.instances.at(-1) ?? null;
        this.activeId = next === null ? null : next.id;
        for (const listener of [...this.activeListeners]) listener(next);
    }

    /** Освобождает ресурсы одного инстанса: PTY и наши подписки на сессию. */
    private destroyInstance(instance: TerminalInstanceRecord): void {
        instance.session.dispose();
        for (const sub of instance.subscriptions) sub.dispose();
    }

    private active(): TerminalInstanceRecord | undefined {
        return this.instances.find((i) => i.id === this.activeId);
    }

    private fireFocus(): void {
        for (const listener of [...this.focusListeners]) listener();
    }

    private subscribe<T>(listeners: Set<T>, listener: T): IDisposable {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
    }
}

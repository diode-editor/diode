// Оркестратор встроенного терминала — headless-сервис: держит список инстансов,
// активный из них, лениво спавнит шелл при первом открытии/активации вкладки
// TERMINAL и убивает PTY при выходе шелла, по команде kill или в dispose().
// Виджеты (`TerminalViewElement`) и список вкладок сервис не трогает — ими
// владеет `TerminalPanelComponent`, подписанный на события инстансов.
//
// Связка с PTY/эмулятором спрятана за `TerminalSessionFactory` (DI-шов): в тестах
// фабрика возвращает FakeTerminalSurface, в проде — EmbeddedTerminalSession.
// См. docs/TODO/IntegratedTerminal.md.

import { basename } from "node:path";

import type { ITerminalSurface } from "@tuidom/core/common/iTerminalSurface";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
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
    /**
     * Заголовок вкладки — имя процесса шелла (`${process}` эталона: `bash`,
     * `zsh`). Номер «N:» к нему приписывают только quick pick и дропдаун, как
     * у эталона; одинаковые заголовки не дедуплицируются — у эталона тоже.
     */
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
 * создаёт/активирует/закрывает инстансы и чистит PTY. View не знает: виджеты и
 * список вкладок строит `TerminalPanelComponent` по событиям
 * `onDidOpenInstance` / `onDidCloseInstance` / `onDidChangeActiveInstance` /
 * `onDidRequestFocus`.
 *
 * Групп (сплитов) нет: группа эталона здесь — один инстанс, поэтому
 * `setActiveToNext`/`setActiveToPrevious` ходят по инстансам.
 */
export class TerminalService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        PanelServiceDIToken,
        ViewsServiceDIToken,
        IConfigurationServiceDIToken,
        TerminalSessionFactoryDIToken,
    ] as const;

    private instances: TerminalInstanceRecord[] = [];
    private activeId: number | null = null;
    private nextId = 1;
    private cwd: string | null = null;

    private readonly onDidOpenInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidCloseInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidChangeActiveInstanceEmitter = this.register(new Emitter<ITerminalInstance | null>());
    private readonly onDidRequestFocusEmitter = this.register(new Emitter<void>());

    public constructor(
        private readonly panelService: PanelService,
        viewsService: ViewsService,
        private readonly configuration: IConfigurationService,
        private readonly factory: TerminalSessionFactory,
    ) {
        super();
        // Вкладка TERMINAL присутствует всегда; шелл спавнится лениво при её
        // активации, поэтому по умолчанию у view нет тела и она рисует подсказку.
        viewsService.registerContainer({ id: TERMINAL_VIEW_ID, title: "TERMINAL", location: "panel", order: 2 });
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

    /** IContextKeyContributor: `terminalIsOpen`, `terminalCount`. */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("terminalIsOpen", this.hasOpenTerminals);
        contextKeys.set("terminalCount", this.instances.length);
    }

    /** Открытые инстансы в порядке создания. */
    public getInstances(): readonly ITerminalInstance[] {
        return this.instances;
    }

    /** Активный инстанс или null, если ни одного не открыто. */
    public getActiveInstance(): ITerminalInstance | null {
        return this.active() ?? null;
    }

    /** Инстанс по id (null — такого нет или уже закрыт). */
    public getInstance(id: number): ITerminalInstance | null {
        return this.instances.find((i) => i.id === id) ?? null;
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
    public createInstance(): ITerminalInstance {
        const id = this.nextId++;
        const session = this.factory({ cols: INITIAL_COLS, rows: INITIAL_ROWS, cwd: this.cwd ?? process.cwd() });
        const instance: TerminalInstanceRecord = {
            id,
            title: basename(session.shell),
            session,
            subscriptions: [
                session.onExit(() => {
                    this.removeInstance(instance);
                }),
            ],
        };
        this.instances.push(instance);
        this.activeId = id;
        this.onDidOpenInstanceEmitter.fire(instance);
        this.onDidChangeActiveInstanceEmitter.fire(instance);
        return instance;
    }

    /**
     * Сделать инстанс активным (без фокуса — так ведут себя стрелки и клик по
     * списку вкладок эталона). Неизвестный id и уже активный — no-op.
     */
    public setActiveInstance(id: number): void {
        const instance = this.instances.find((i) => i.id === id);
        if (instance === undefined || this.activeId === id) return;
        this.activeId = id;
        this.onDidChangeActiveInstanceEmitter.fire(instance);
    }

    /** Активировать инстанс по позиции в списке (`focusAtIndexN` эталона); вне диапазона — no-op. */
    public setActiveInstanceByIndex(index: number): void {
        if (index < 0 || index >= this.instances.length) return;
        this.setActiveInstance(this.instances[index].id);
    }

    /** Следующий инстанс по кругу (`setActiveGroupToNext` эталона); при одном — no-op. */
    public setActiveToNext(): void {
        this.setActiveByOffset(1);
    }

    /** Предыдущий инстанс по кругу (`setActiveGroupToPrevious` эталона). */
    public setActiveToPrevious(): void {
        this.setActiveByOffset(-1);
    }

    /**
     * Убить инстанс (команды Kill): PTY закрывается, инстанс снимается со
     * списка. Активным становится сосед с тем же индексом, иначе последний —
     * как `removeGroup` эталона. Неизвестный id — no-op.
     */
    public closeInstance(id: number): void {
        const instance = this.instances.find((i) => i.id === id);
        if (instance === undefined) return;
        this.removeInstance(instance);
    }

    /** Сфокусировать активный терминал (если он есть). */
    public focusActive(): void {
        this.fireFocus();
    }

    /** Открытие нового инстанса (компонент строит по нему виджет). */
    public readonly onDidOpenInstance = this.onDidOpenInstanceEmitter.event;

    /** Закрытие инстанса — выход шелла или kill (компонент dispose'ит его виджет). */
    public readonly onDidCloseInstance = this.onDidCloseInstanceEmitter.event;

    /** Смена активного инстанса; null — терминалов не осталось (вернуть placeholder). */
    public readonly onDidChangeActiveInstance = this.onDidChangeActiveInstanceEmitter.event;

    /** Запрос фокуса на виджет активного инстанса. */
    public readonly onDidRequestFocus = this.onDidRequestFocusEmitter.event;

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

    private setActiveByOffset(offset: number): void {
        const count = this.instances.length;
        if (count <= 1) return;
        const current = this.instances.findIndex((i) => i.id === this.activeId);
        const next = this.instances[(current + offset + count) % count];
        this.setActiveInstance(next.id);
    }

    /**
     * Снять инстанс (выход шелла или kill): закрыть PTY, оповестить, выбрать
     * нового активного. Последний закрытый терминал прячет панель
     * (`terminal.integrated.hideOnLastClosed`), если вкладка TERMINAL сейчас
     * активна — у эталона `hidePanel` закрывает view, когда она одна в контейнере.
     */
    private removeInstance(instance: TerminalInstanceRecord): void {
        const index = this.instances.indexOf(instance);
        /* v8 ignore start -- defensive re-entrancy guard: both removeInstance and dispose() drop the onExit subscription (via destroyInstance) as part of removing the instance, and a real session reports its exit asynchronously, so removeInstance is never re-entered for an instance already gone from the list */
        if (index === -1) return; // уже снесён (dispose)
        /* v8 ignore stop */
        const wasActive = this.activeId === instance.id;
        this.instances.splice(index, 1);
        this.destroyInstance(instance);
        this.onDidCloseInstanceEmitter.fire(instance);

        if (!wasActive) return;
        const next = this.instances.at(Math.min(index, this.instances.length - 1)) ?? null;
        this.activeId = next === null ? null : next.id;
        this.onDidChangeActiveInstanceEmitter.fire(next);
        if (next !== null) return;
        if (!this.configuration.get("terminal.integrated.hideOnLastClosed")) return;
        if (this.panelService.getActiveViewId() === TERMINAL_VIEW_ID) this.panelService.setVisible(false);
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
        this.onDidRequestFocusEmitter.fire();
    }
}

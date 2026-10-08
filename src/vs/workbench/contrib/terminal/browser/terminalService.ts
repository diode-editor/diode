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
import {
    type ITerminalSession,
    type TerminalSessionFactory,
    TerminalSessionFactoryDIToken,
} from "../common/terminalSessionFactory.ts";

/** VS Code view id of the integrated Terminal view living in the bottom Panel. */
export const TERMINAL_VIEW_ID = "terminal";

export const TerminalServiceDIToken = token<TerminalService>("TerminalService");

/** Начальный размер PTY до первого performLayout (реальный размер придёт с ресайзом). */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 24;

/**
 * Почему инстанс закрылся — `TerminalExitReason` эталона: шелл вышел сам
 * (`process`), его убил человек командой Kill (`user`), закрыло расширение
 * (`Terminal.dispose()`, `extension`).
 */
export type TerminalExitReason = "process" | "user" | "extension";

/**
 * Чем запущен инстанс — `IShellLaunchConfig` эталона в объёме, который
 * расширение видит как `Terminal.creationOptions` чужого терминала.
 */
export interface ITerminalLaunchInfo {
    readonly shellPath: string;
    readonly shellArgs: readonly string[] | undefined;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string | null>> | undefined;
    readonly hideFromUser: boolean;
}

/** Один открытый терминал: сессия (PTY+эмулятор) за интерфейсом поверхности. */
export interface ITerminalInstance {
    readonly id: number;
    /**
     * Заголовок вкладки — имя процесса шелла (`${process}` эталона: `bash`,
     * `zsh`) либо имя, данное создателем (`TerminalOptions.name` расширения).
     * Номер «N:» к нему приписывают только quick pick и дропдаун, как
     * у эталона; одинаковые заголовки не дедуплицируются — у эталона тоже.
     */
    readonly title: string;
    /** Поверхность сессии — по ней компонент строит `TerminalViewElement`. */
    readonly session: ITerminalSurface;
    /** Pid процесса шелла; `undefined`, если процесса на нашей стороне нет. */
    readonly processId: number | undefined;
    readonly launch: ITerminalLaunchInfo;
    /** Код выхода шелла; `undefined`, пока он жив или если его закрыли не выходом. */
    readonly exitCode: number | undefined;
    /** Причина закрытия; `undefined`, пока инстанс жив. */
    readonly exitReason: TerminalExitReason | undefined;
}

/**
 * Чем терминал расширения (`window.createTerminal`) отличается от шелла по
 * умолчанию — `TerminalOptions` эталона в объёме, который понимает сессия.
 */
export interface ITerminalCreateOptions {
    /** Заголовок; без него — имя процесса шелла. */
    readonly name?: string;
    readonly shellPath?: string;
    readonly shellArgs?: readonly string[];
    readonly cwd?: string;
    /** `null` снимает переменную из унаследованного окружения. */
    readonly env?: Readonly<Record<string, string | null>>;
    /** Окружение шелла — ровно `env`, без наследования от процесса. */
    readonly strictEnv?: boolean;
    /** Строка, напечатанная в терминале до вывода шелла (в шелл не уходит). */
    readonly message?: string;
    /**
     * Фоновый терминал (`hideFromUser`): процесс жив, но в списке вкладок его
     * нет и активным он не становится, пока его не покажут
     * ({@link TerminalService.showInstance}) — `_backgroundedTerminalInstances`
     * эталона.
     */
    readonly hideFromUser?: boolean;
}

interface TerminalInstanceRecord extends ITerminalInstance {
    readonly session: ITerminalSession;
    readonly subscriptions: IDisposable[];
    exitCode: number | undefined;
    exitReason: TerminalExitReason | undefined;
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
    /** Фоновые (`hideFromUser`): живы, но не в списке вкладок, пока их не покажут. */
    private backgroundInstances: TerminalInstanceRecord[] = [];
    private activeId: number | null = null;
    private nextId = 1;
    private cwd: string | null = null;

    private readonly onDidOpenInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidCloseInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidChangeActiveInstanceEmitter = this.register(new Emitter<ITerminalInstance | null>());
    private readonly onDidRequestFocusEmitter = this.register(new Emitter<void>());
    private readonly onDidCreateInstanceEmitter = this.register(new Emitter<ITerminalInstance>());
    private readonly onDidDisposeInstanceEmitter = this.register(new Emitter<ITerminalInstance>());

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

    /** Инстанс по id, в том числе фоновый (null — такого нет или уже закрыт). */
    public getInstance(id: number): ITerminalInstance | null {
        return this.find(id) ?? null;
    }

    /** Фоновые инстансы (`hideFromUser`), ещё не показанные, в порядке создания. */
    public getBackgroundInstances(): readonly ITerminalInstance[] {
        return this.backgroundInstances;
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

    /**
     * Создаёт инстанс терминала и делает его активным (без фокуса). Опции —
     * у терминалов расширений; фоновый (`hideFromUser`) в список не попадает
     * и активным не становится — {@link onDidCreateInstance} о нём всё равно
     * сообщает.
     */
    public createInstance(options: ITerminalCreateOptions = {}): ITerminalInstance {
        const id = this.nextId++;
        const cwd = options.cwd ?? this.cwd ?? process.cwd();
        const session = this.factory({
            cols: INITIAL_COLS,
            rows: INITIAL_ROWS,
            cwd,
            ...(options.shellPath !== undefined ? { shell: options.shellPath } : {}),
            ...(options.shellArgs !== undefined ? { args: [...options.shellArgs] } : {}),
            ...(options.env !== undefined ? { env: { ...options.env } } : {}),
            ...(options.strictEnv === true ? { strictEnv: true } : {}),
            ...(options.message !== undefined ? { message: options.message } : {}),
        });
        const hideFromUser = options.hideFromUser === true;
        const instance: TerminalInstanceRecord = {
            id,
            // Пустое имя у эталона — «не задано»: заголовок по процессу.
            title: options.name !== undefined && options.name !== "" ? options.name : basename(session.shell),
            session,
            processId: session.pid,
            launch: {
                shellPath: session.shell,
                shellArgs: options.shellArgs,
                cwd,
                env: options.env,
                hideFromUser,
            },
            exitCode: undefined,
            exitReason: undefined,
            subscriptions: [
                session.onExit((code) => {
                    instance.exitCode = code;
                    this.removeInstance(instance, "process");
                }),
            ],
        };
        if (hideFromUser) {
            this.backgroundInstances.push(instance);
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

    /**
     * Показать инстанс (`Terminal.show` расширения, `$show` эталона): фоновый
     * переезжает в список вкладок, инстанс становится активным. Панель и фокус —
     * забота вызывающего. Неизвестный id — no-op.
     */
    public showInstance(id: number): void {
        const background = this.backgroundInstances.find((i) => i.id === id);
        if (background !== undefined) {
            this.backgroundInstances.splice(this.backgroundInstances.indexOf(background), 1);
            this.instances.push(background);
            this.onDidOpenInstanceEmitter.fire(background);
        }
        this.setActiveInstance(id);
    }

    /**
     * Подать текст в шелл как набор (`Terminal.sendText`, `TerminalInstance.sendText`
     * эталона): переводы строк — нажатия Enter (`\r`), `shouldExecute` добавляет
     * Enter в конец, если его там нет. Неизвестный id — no-op.
     */
    public sendText(id: number, text: string, shouldExecute: boolean): void {
        const instance = this.find(id);
        if (instance === undefined) return;
        const normalized = text.replace(/\r?\n/gu, "\r");
        instance.session.write(shouldExecute && !normalized.endsWith("\r") ? `${normalized}\r` : normalized);
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
     * Убить инстанс (команды Kill — причина `user`; `Terminal.dispose()`
     * расширения — `extension`): PTY закрывается, инстанс снимается со
     * списка. Активным становится сосед с тем же индексом, иначе последний —
     * как `removeGroup` эталона. Неизвестный id (и `undefined` — «нечего
     * убивать») — no-op.
     */
    public closeInstance(id: number | undefined, reason: TerminalExitReason = "user"): void {
        this.removeInstance(id === undefined ? undefined : this.find(id), reason);
    }

    /** Сфокусировать активный терминал (если он есть). */
    public focusActive(): void {
        this.fireFocus();
    }

    /**
     * Инстанс заведён — любой, в том числе фоновый (`onDidCreateInstance`
     * эталона). Для виджетов — {@link onDidOpenInstance}.
     */
    public readonly onDidCreateInstance = this.onDidCreateInstanceEmitter.event;

    /**
     * Инстанс снят — любой, в том числе фоновый; `exitReason`/`exitCode` уже
     * заполнены (`onDidDisposeInstance` эталона).
     */
    public readonly onDidDisposeInstance = this.onDidDisposeInstanceEmitter.event;

    /** Инстанс появился в списке вкладок (компонент строит по нему виджет). */
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
        for (const instance of [...this.instances, ...this.backgroundInstances]) this.destroyInstance(instance);
        this.instances = [];
        this.backgroundInstances = [];
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
        // При одном терминале «следующий» — он сам, и setActiveInstance это погасит.
        if (count === 0) return;
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
    private removeInstance(instance: TerminalInstanceRecord | undefined, reason: TerminalExitReason): void {
        // Неизвестный id у closeInstance — инстанса нет в списке.
        if (instance === undefined) return;
        instance.exitReason = reason;
        const background = this.backgroundInstances.indexOf(instance);
        if (background !== -1) {
            // Фонового нет ни в списке вкладок, ни среди активных — только снять.
            this.backgroundInstances.splice(background, 1);
            this.destroyInstance(instance);
            this.onDidDisposeInstanceEmitter.fire(instance);
            return;
        }
        const index = this.instances.indexOf(instance);
        const wasActive = this.activeId === instance.id;
        this.instances.splice(index, 1);
        this.destroyInstance(instance);
        this.onDidCloseInstanceEmitter.fire(instance);
        this.onDidDisposeInstanceEmitter.fire(instance);

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

    private find(id: number): TerminalInstanceRecord | undefined {
        return this.instances.find((i) => i.id === id) ?? this.backgroundInstances.find((i) => i.id === id);
    }

    private active(): TerminalInstanceRecord | undefined {
        return this.instances.find((i) => i.id === this.activeId);
    }

    private fireFocus(): void {
        this.onDidRequestFocusEmitter.fire();
    }
}

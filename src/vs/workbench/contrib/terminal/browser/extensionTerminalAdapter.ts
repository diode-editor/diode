import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IExtensionTerminalEvents, IExtensionTerminalSink } from "../../../api/common/iExtensionWindowSinks.ts";
import type {
    IWireTerminalCreate,
    IWireTerminalLaunch,
    IWireTerminalOpened,
    IWireTerminalRef,
} from "../../../api/common/wireTypes.ts";
import type { PanelService } from "../../../browser/parts/panel/panelService.ts";

import { type ITerminalInstance, TERMINAL_VIEW_ID, type TerminalService } from "./terminalService.ts";

/**
 * Мост `window.createTerminal` расширений к {@link TerminalService}
 * (`MainThreadTerminalService` эталона): шелл расширения — обычный инстанс
 * встроенного терминала с его опциями, `show`/`hide` водят нижнюю панель на
 * вкладке TERMINAL, а жизнь ВСЕХ инстансов (и шеллов человека) уходит
 * подписчику — так `window.terminals` видит каждый терминал, как у эталона.
 *
 * Свой терминал субпроцесс адресует `extHostId`, пока не узнал хостовый id
 * из `opened`; адаптер помнит соответствие до `reset()` (смерть субпроцесса).
 */
export class ExtensionTerminalAdapter implements IExtensionTerminalSink {
    /** `extHostId` субпроцесса → id инстанса (терминалов единицы — обратный поиск перебором). */
    private readonly byExtHostId = new Map<number, number>();
    /**
     * `extHostId` терминала, который заводится прямо сейчас: `onDidCreateInstance`
     * стреляет изнутри `createInstance`, раньше, чем тот вернёт инстанс.
     */
    private creating: number | undefined;

    public constructor(
        private readonly terminals: TerminalService,
        private readonly panel: PanelService,
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
        store.add(
            this.terminals.onDidCreateInstance((instance) => {
                events.opened(this.toOpened(instance));
            }),
        );
        store.add(
            this.terminals.onDidDisposeInstance((instance) => {
                events.closed({
                    id: instance.id,
                    ...(instance.exitCode !== undefined ? { code: instance.exitCode } : {}),
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

    public reset(): void {
        this.byExtHostId.clear();
    }

    private labelOf(instanceId: number): number | undefined {
        for (const [extHostId, id] of this.byExtHostId) if (id === instanceId) return extHostId;
        return undefined;
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

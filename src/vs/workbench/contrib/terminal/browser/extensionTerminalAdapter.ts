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
    /** `extHostId` субпроцесса → id инстанса. */
    private readonly byExtHostId = new Map<number, number>();
    /** Обратная метка — её несёт `opened` своего терминала. */
    private readonly extHostIdOf = new Map<number, number>();
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
                    // Инстанс снимается только с причиной; `unknown` — защитный.
                    reason: instance.exitReason ?? "unknown",
                });
                const extHostId = this.extHostIdOf.get(instance.id);
                if (extHostId === undefined) return;
                this.extHostIdOf.delete(instance.id);
                this.byExtHostId.delete(extHostId);
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
            const instance = this.terminals.createInstance({
                ...(request.name !== undefined ? { name: request.name } : {}),
                ...(request.shellPath !== undefined ? { shellPath: request.shellPath } : {}),
                ...(request.shellArgs !== undefined ? { shellArgs: request.shellArgs } : {}),
                ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
                ...(request.env !== undefined ? { env: request.env } : {}),
                ...(request.strictEnv === true ? { strictEnv: true } : {}),
                ...(request.message !== undefined ? { message: request.message } : {}),
                ...(request.hideFromUser === true ? { hideFromUser: true } : {}),
            });
            this.byExtHostId.set(request.extHostId, instance.id);
            this.extHostIdOf.set(instance.id, request.extHostId);
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

    /** `Terminal.hide` (`$hide` эталона): прячет панель, только если показан именно этот терминал. */
    public hide(terminal: IWireTerminalRef): void {
        const id = this.resolve(terminal);
        if (id === undefined) return;
        if (this.terminals.getActiveInstance()?.id !== id) return;
        if (this.panel.getActiveViewId() !== TERMINAL_VIEW_ID) return;
        this.panel.setVisible(false);
    }

    public sendText(terminal: IWireTerminalRef, text: string, shouldExecute: boolean): void {
        const id = this.resolve(terminal);
        if (id !== undefined) this.terminals.sendText(id, text, shouldExecute);
    }

    /** `Terminal.dispose` (`$dispose` эталона): инстанс закрывается с причиной `extension`. */
    public dispose(terminal: IWireTerminalRef): void {
        const id = this.resolve(terminal);
        if (id !== undefined) this.terminals.closeInstance(id, "extension");
    }

    public reset(): void {
        this.byExtHostId.clear();
        this.extHostIdOf.clear();
    }

    private resolve(terminal: IWireTerminalRef): number | undefined {
        return "id" in terminal ? terminal.id : this.byExtHostId.get(terminal.extHostId);
    }

    private toOpened(instance: ITerminalInstance): IWireTerminalOpened {
        const extHostId = this.creating ?? this.extHostIdOf.get(instance.id);
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

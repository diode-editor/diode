import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import type { LifecyclePhase } from "../common/lifecyclePhase.ts";
import { LIFECYCLE_PHASES } from "../common/lifecyclePhase.ts";

export const LifecycleServiceDIToken = token<LifecycleService>("LifecycleService");

export interface IShutdownDirtyItem {
    readonly name: string;
    /** Пока отвечали по предыдущим, вкладку могли закрыть — такой элемент пропускается. */
    isStillDirty(): boolean;
    /**
     * Перезаписывает файл и при внешних изменениях — выбор пользователя не должен пропасть.
     * `false` — не сохранилось (untitled без пути, ошибка записи): прощание отменяется.
     */
    save(): Promise<boolean>;
}

/** Аналог vscode `onBeforeShutdown`-вето. */
export interface IShutdownParticipant {
    collectDirty(): readonly IShutdownDirtyItem[];
}

/** Почему приложение прощается: от причины зависит только то, что будет после (выход или новый процесс). */
export type ShutdownReason = "quit" | "reload" | "inspector";

/**
 * Аналог vscode `WillShutdownEvent`. Фаза ждёт промисы {@link join}, но не дольше общего
 * тайм-аута — зависший участник не держит выход.
 */
export interface IWillShutdownEvent {
    readonly reason: ShutdownReason;
    join(promise: Promise<unknown>): void;
}

export interface ILifecycleSubscription {
    dispose(): void;
}

/** Покрывает вежливую остановку extension host'а: RPC `host.shutdown` ждёт до 1.5 с, дальше SIGTERM. */
export const SHUTDOWN_JOIN_TIMEOUT_MS = 2000;

/**
 * Аналог vscode `ILifecycleService`. Прощание — в два шага: {@link requestShutdown}
 * (подтверждение «грязного», Cancel прерывает) и {@link shutdown}, единый для выхода,
 * перезагрузки и инспектора: async-фаза {@link onWillShutdown} с общим тайм-аутом, затем
 * {@link onShutdownSync} в порядке, обратном подписке, и только потом `then` вызывающего.
 * Участники подписываются сами там, где создаются, — новый ресурс не вписывают в каждый путь выхода.
 */
export class LifecycleService {
    public static dependencies = [DialogServiceDIToken] as const;

    private participants: IShutdownParticipant[] = [];
    private readonly willShutdownListeners = new Set<(event: IWillShutdownEvent) => void>();
    private readonly shutdownSyncListeners = new Set<() => void>();
    private shutdownPromise: Promise<void> | null = null;
    private currentPhase: LifecyclePhase = "starting";
    private readonly phaseListeners = new Set<(phase: LifecyclePhase) => void>();
    private readonly phaseBarriers: Readonly<Record<LifecyclePhase, IBarrier>> = {
        starting: createBarrier(),
        ready: createBarrier(),
        restored: createBarrier(),
        eventually: createBarrier(),
    };

    public constructor(
        private readonly dialogService: DialogService,
        private readonly joinTimeoutMs = SHUTDOWN_JOIN_TIMEOUT_MS,
    ) {
        this.barrier("starting").open();
    }

    public get phase(): LifecyclePhase {
        return this.currentPhase;
    }

    /**
     * Пропущенные промежуточные фазы проходятся по порядку (их слушатели тоже срабатывают);
     * повтор текущей — no-op, откат назад — ошибка в порядке старта.
     */
    public setPhase(phase: LifecyclePhase): void {
        const target = LIFECYCLE_PHASES.indexOf(phase);
        const current = LIFECYCLE_PHASES.indexOf(this.currentPhase);
        if (target < current) {
            throw new Error(`Lifecycle cannot go backwards: ${this.currentPhase} → ${phase}`);
        }
        for (const next of LIFECYCLE_PHASES.slice(current + 1, target + 1)) {
            this.currentPhase = next;
            for (const listener of [...this.phaseListeners]) listener(next);
            this.barrier(next).open();
        }
    }

    /** Синхронно в момент перехода, в отличие от {@link when}. */
    public onDidChangePhase(listener: (phase: LifecyclePhase) => void): ILifecycleSubscription {
        return subscribe(this.phaseListeners, listener);
    }

    public when(phase: LifecyclePhase): Promise<void> {
        return this.barrier(phase).promise;
    }

    private barrier(phase: LifecyclePhase): IBarrier {
        return this.phaseBarriers[phase];
    }

    public registerShutdownParticipant(participant: IShutdownParticipant): void {
        this.participants.push(participant);
    }

    /**
     * Без «грязных» элементов `onProceed` зовётся синхронно (до первого await). Cancel, как и
     * Save, который не сохранил, оставляет приложение как есть.
     */
    public async requestShutdown(onProceed: () => unknown): Promise<void> {
        for (const participant of this.participants) {
            for (const item of participant.collectDirty()) {
                if (!item.isStillDirty()) continue;
                const choice = await this.dialogService.confirmSave(item.name);
                if (choice === "cancel") return;
                if (choice === "save" && !(await item.save())) return;
            }
        }
        await onProceed();
    }

    /** Здесь отпускают то, что требует ответа (субпроцессы). */
    public onWillShutdown(listener: (event: IWillShutdownEvent) => void): ILifecycleSubscription {
        return subscribe(this.willShutdownListeners, listener);
    }

    /**
     * Только синхронный код: после `then` event loop может больше не провернуться (перезагрузка
     * блокирует его запуском нового процесса).
     */
    public onShutdownSync(listener: () => void): ILifecycleSubscription {
        return subscribe(this.shutdownSyncListeners, listener);
    }

    /**
     * Повторный вызов присоединяется к первому прощанию. Сбой участника не останавливает
     * остальных: на выходе отступать уже некуда.
     */
    public shutdown(reason: ShutdownReason, then: () => void): Promise<void> {
        this.shutdownPromise ??= this.doShutdown(reason, then);
        return this.shutdownPromise;
    }

    private async doShutdown(reason: ShutdownReason, then: () => void): Promise<void> {
        const joins = new Set<Promise<unknown>>();
        const event: IWillShutdownEvent = {
            reason,
            join: (promise) => {
                joins.add(promise.catch(() => undefined));
            },
        };
        for (const listener of [...this.willShutdownListeners]) {
            try {
                listener(event);
            } catch {
                // участник не смог начать прощание — остальные всё равно прощаются
            }
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.joinTimeoutMs);
        });
        await Promise.race([Promise.all(joins), timeout]);
        clearTimeout(timer);
        for (const listener of [...this.shutdownSyncListeners].reverse()) {
            try {
                listener();
            } catch {
                // то же: синхронный шаг одного участника не держит остальных
            }
        }
        then();
    }
}

interface IBarrier {
    readonly promise: Promise<void>;
    open(): void;
}

function createBarrier(): IBarrier {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

function subscribe<T>(listeners: Set<T>, listener: T): ILifecycleSubscription {
    listeners.add(listener);
    return {
        dispose: () => {
            listeners.delete(listener);
        },
    };
}

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import type { LifecyclePhase } from "../common/lifecyclePhase.ts";
import { LIFECYCLE_PHASES } from "../common/lifecyclePhase.ts";

export const LifecycleServiceDIToken = token<LifecycleService>("LifecycleService");

/**
 * «Грязный» элемент участника shutdown — то, что требует подтверждения
 * пользователя перед выходом (несохранённый редактор и т.п.).
 */
export interface IShutdownDirtyItem {
    /** Имя для диалога «сохранить изменения?». */
    readonly name: string;
    /**
     * Актуален ли элемент к моменту своего диалога: пока пользователь отвечал
     * по предыдущим, вкладку могли закрыть — такой элемент пропускается.
     */
    isStillDirty(): boolean;
    /**
     * Сохранить по выбору «Save». Явный Save при выходе перезаписывает файл
     * даже при внешних изменениях — выбор пользователя не должен пропасть.
     * `false` — не сохранилось (untitled без пути, ошибка записи): прощание
     * отменяется, как у закрытия вкладки.
     */
    save(): Promise<boolean>;
}

/**
 * Участник shutdown-протокола (аналог vscode `onBeforeShutdown`-вето):
 * отдаёт снапшот своих «грязных» элементов. Workbench объявляет интерфейс,
 * владельцы состояния (сейчас `EditorService`) реализуют его
 * структурно и регистрируются через {@link LifecycleService.registerShutdownParticipant}.
 */
export interface IShutdownParticipant {
    collectDirty(): readonly IShutdownDirtyItem[];
}

/** Почему приложение прощается: от причины зависит только то, что будет после (выход или новый процесс). */
export type ShutdownReason = "quit" | "reload" | "inspector";

/**
 * Событие асинхронной фазы прощания (аналог vscode `WillShutdownEvent`):
 * участник, которому нужно время (вежливо остановить субпроцесс), отдаёт
 * промис через {@link join}. Фаза ждёт все промисы, но не дольше общего
 * тайм-аута — зависший участник не держит выход.
 */
export interface IWillShutdownEvent {
    readonly reason: ShutdownReason;
    join(promise: Promise<unknown>): void;
}

/** Подписка на событие жизненного цикла; `dispose()` снимает её. */
export interface ILifecycleSubscription {
    dispose(): void;
}

/**
 * Общий потолок асинхронной фазы прощания. Покрывает вежливую остановку
 * extension host'а: RPC `host.shutdown` (там `deactivate()` расширений) ждёт
 * до 1.5 с, дальше host сам переходит к SIGTERM.
 */
export const SHUTDOWN_JOIN_TIMEOUT_MS = 2000;

/**
 * Жизненный цикл приложения (аналог vscode `ILifecycleService`): фазы старта и
 * прощание.
 *
 * Фазы ({@link LifecyclePhase}) двигает старт окна: `ready` — `WorkbenchComponent.mount`,
 * дальше — `workbenchStartup.ts`. Кто должен стартовать не сразу, ждёт свою
 * фазу сам: {@link onDidChangePhase} — синхронно в момент перехода (реестр
 * workbench-contributions), {@link when} — промисом.
 *
 * Прощание — в два шага:
 *
 * 1. {@link requestShutdown} — подтверждение: последовательно спрашивает про
 *    каждый «грязный» элемент участников через `DialogService.confirmSave`;
 *    Cancel прерывает прощание, иначе зовётся `onProceed`.
 * 2. {@link shutdown} — само прощание, единое для выхода, перезагрузки окна и
 *    выхода по команде инспектора: асинхронная фаза {@link onWillShutdown}
 *    (участники присоединяют промисы, общий тайм-аут), затем синхронная
 *    {@link onShutdownSync} в порядке, обратном подписке (последним
 *    подписался — первым отпускает), и только потом `then` вызывающего —
 *    выход или замена процесса новым.
 *
 * Участники подписываются сами там, где создаются (extension host и watcher
 * дерева — в своих DI-модулях; терминал, стор состояния и инспектор — у
 * владельца процесса, `main.ts`), поэтому новый ресурс не нужно вписывать в
 * каждый путь выхода по отдельности.
 */
export class LifecycleService {
    public static dependencies = [DialogServiceDIToken] as const;

    private participants: IShutdownParticipant[] = [];
    private readonly willShutdownListeners = new Set<(event: IWillShutdownEvent) => void>();
    private readonly shutdownSyncListeners = new Set<() => void>();
    private shutdownPromise: Promise<void> | null = null;
    private currentPhase: LifecyclePhase = "starting";
    private readonly phaseListeners = new Set<(phase: LifecyclePhase) => void>();
    private readonly phaseWaiters = new Map<LifecyclePhase, (() => void)[]>();

    public constructor(
        private readonly dialogService: DialogService,
        private readonly joinTimeoutMs = SHUTDOWN_JOIN_TIMEOUT_MS,
    ) {}

    public get phase(): LifecyclePhase {
        return this.currentPhase;
    }

    /**
     * Переход в фазу. Пропущенные промежуточные фазы проходятся по порядку, так
     * что их слушатели и ожидающие тоже срабатывают; повтор текущей — no-op,
     * откат назад — ошибка в порядке старта.
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
            for (const resolve of this.phaseWaiters.get(next) ?? []) resolve();
            this.phaseWaiters.delete(next);
        }
    }

    /** Синхронно в момент перехода в каждую следующую фазу. */
    public onDidChangePhase(listener: (phase: LifecyclePhase) => void): ILifecycleSubscription {
        return subscribe(this.phaseListeners, listener);
    }

    /** Резолвится, когда фаза достигнута (сразу — если уже). */
    public when(phase: LifecyclePhase): Promise<void> {
        if (LIFECYCLE_PHASES.indexOf(phase) <= LIFECYCLE_PHASES.indexOf(this.currentPhase)) return Promise.resolve();
        return new Promise((resolve) => {
            const waiters = this.phaseWaiters.get(phase) ?? [];
            waiters.push(resolve);
            this.phaseWaiters.set(phase, waiters);
        });
    }

    public registerShutdownParticipant(participant: IShutdownParticipant): void {
        this.participants.push(participant);
    }

    /**
     * Запрос на прощание с сессией: без «грязных» элементов `onProceed` зовётся
     * синхронно (до первого await), иначе — после последнего подтверждения.
     * Cancel в любом диалоге, как и Save, который не сохранил, оставляет
     * приложение как есть. Промис, который вернул `onProceed`, дожидается
     * (обычно это {@link shutdown}).
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

    /** Асинхронная фаза прощания: здесь отпускают то, что требует ответа (субпроцессы). */
    public onWillShutdown(listener: (event: IWillShutdownEvent) => void): ILifecycleSubscription {
        return subscribe(this.willShutdownListeners, listener);
    }

    /**
     * Синхронная фаза прощания: последний шаг перед `then`, после которого event
     * loop может больше не провернуться (перезагрузка блокирует его запуском
     * нового процесса). Только синхронный код: сброс состояния, снятие терминала,
     * добивание того, что не успело уйти вежливо.
     */
    public onShutdownSync(listener: () => void): ILifecycleSubscription {
        return subscribe(this.shutdownSyncListeners, listener);
    }

    /**
     * Прощание после подтверждения: обе фазы, затем `then`. Повторный вызов
     * (вторая команда выхода, пока ждём субпроцесс) присоединяется к первому
     * прощанию, не повторяя его. Сбой участника не останавливает остальных:
     * на выходе отступать уже некуда.
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

function subscribe<T>(listeners: Set<T>, listener: T): ILifecycleSubscription {
    listeners.add(listener);
    return {
        dispose: () => {
            listeners.delete(listener);
        },
    };
}

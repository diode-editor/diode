import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";
import { DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";

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
     */
    save(): Promise<unknown>;
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
    /** `id` — имя участника для отладки (как `join.stopExtensionHosts` у vscode). */
    join(promise: Promise<unknown>, id: string): void;
}

/** Подписка участника; `dispose()` снимает её. */
export interface IShutdownSubscription {
    dispose(): void;
}

/**
 * Общий потолок асинхронной фазы прощания. Покрывает вежливую остановку
 * extension host'а: RPC `host.shutdown` (там `deactivate()` расширений) ждёт
 * до 1.5 с, дальше host сам переходит к SIGTERM.
 */
export const SHUTDOWN_JOIN_TIMEOUT_MS = 2000;

/**
 * Жизненный цикл приложения (аналог vscode `ILifecycleService`, срез shutdown).
 * Прощание в два шага:
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

    public constructor(
        private readonly dialogService: DialogService,
        private readonly joinTimeoutMs = SHUTDOWN_JOIN_TIMEOUT_MS,
    ) {}

    public registerShutdownParticipant(participant: IShutdownParticipant): void {
        this.participants.push(participant);
    }

    /**
     * Запрос на прощание с сессией: без «грязных» элементов `onProceed` зовётся
     * синхронно (до первого await), иначе — после последнего подтверждения.
     * Cancel в любом диалоге оставляет приложение как есть. Промис, который
     * вернул `onProceed`, дожидается (обычно это {@link shutdown}).
     */
    public async requestShutdown(onProceed: () => unknown): Promise<void> {
        for (const participant of this.participants) {
            for (const item of participant.collectDirty()) {
                if (!item.isStillDirty()) continue;
                const choice = await this.dialogService.confirmSave(item.name);
                if (choice === "cancel") return;
                if (choice === "save") await item.save();
            }
        }
        await onProceed();
    }

    /** Асинхронная фаза прощания: здесь отпускают то, что требует ответа (субпроцессы). */
    public onWillShutdown(listener: (event: IWillShutdownEvent) => void): IShutdownSubscription {
        return subscribe(this.willShutdownListeners, listener);
    }

    /**
     * Синхронная фаза прощания: последний шаг перед `then`, после которого event
     * loop может больше не провернуться (перезагрузка блокирует его запуском
     * нового процесса). Только синхронный код: сброс состояния, снятие терминала,
     * добивание того, что не успело уйти вежливо.
     */
    public onShutdownSync(listener: () => void): IShutdownSubscription {
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
        const joins: Promise<unknown>[] = [];
        const event: IWillShutdownEvent = {
            reason,
            join: (promise) => {
                joins.push(promise.catch(() => undefined));
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

function subscribe<T>(listeners: Set<T>, listener: T): IShutdownSubscription {
    listeners.add(listener);
    return {
        dispose: () => {
            listeners.delete(listener);
        },
    };
}

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * Таблица фаз расширений хоста — без процесса, RPC и событий, только
 * переходы. Каждая регистрация в каждый момент либо ждёт активации
 * (`pending`), либо активна, либо поднимается прямо сейчас (не в одной из
 * фаз: её держит карта активаций хоста). Отдельно — все известные
 * регистрации в порядке появления: из них собирается каталог
 * `vscode.extensions`, и их состав от фазы не зависит.
 */
export class ExtensionPhases {
    /** Все известные регистрации в порядке появления (каталог, `onCommand`-заглушки). */
    private readonly known = new Map<string, IExtensionRegistration>();
    /**
     * Зарегистрированные, но ещё не активированные (id → reg). Ленивость: пока
     * reg здесь, субпроцесс под него не поднимается.
     */
    private readonly pending = new Map<string, IExtensionRegistration>();
    /** Активные (id → reg); регистрация нужна для оживления после смерти субпроцесса. */
    private readonly active = new Map<string, IExtensionRegistration>();

    /** Занят ли id: расширение ждёт активации или уже активно. */
    public isRegistered(id: string): boolean {
        return this.pending.has(id) || this.active.has(id);
    }

    /** Новая регистрация: в каталог и в ожидание активации. */
    public register(reg: IExtensionRegistration): void {
        this.known.set(reg.id, reg);
        this.pending.set(reg.id, reg);
    }

    /** Все известные регистрации в порядке появления. */
    public all(): IterableIterator<IExtensionRegistration> {
        return this.known.values();
    }

    /** Ожидающие активации — снимком: вызывающий может менять фазы по ходу обхода. */
    public pendingRegistrations(): readonly IExtensionRegistration[] {
        return [...this.pending.values()];
    }

    public isActive(id: string): boolean {
        return this.active.has(id);
    }

    public get activeCount(): number {
        return this.active.size;
    }

    /**
     * Забирает расширение из ожидания под активацию. `false` — его там нет:
     * уже поднимается другим вызовом, активно или снято.
     */
    public takePending(id: string): boolean {
        return this.pending.delete(id);
    }

    public markActive(reg: IExtensionRegistration): void {
        this.active.set(reg.id, reg);
    }

    /**
     * Активация оборвана смертью субпроцесса: расширение возвращается в
     * ожидание, если его за это время не сняли (и не зарегистрировали заново
     * другой записью). `true` — вернулось.
     */
    public returnInterrupted(reg: IExtensionRegistration): boolean {
        if (this.known.get(reg.id) !== reg) return false;
        this.pending.set(reg.id, reg);
        return true;
    }

    /** Убирает запись из каталога. `false` — её там уже не было. */
    public forget(id: string): boolean {
        return this.known.delete(id);
    }

    /** Снимает ожидание активации. `false` — расширение не ждало. */
    public dropPending(id: string): boolean {
        return this.pending.delete(id);
    }

    /** Снимает активное расширение. `false` — оно не было активно. */
    public deactivate(id: string): boolean {
        return this.active.delete(id);
    }

    /**
     * Субпроцесс умер: все активные возвращаются в ожидание (оживут на
     * следующем событии активации). Возвращает оживляемые регистрации.
     */
    public reviveAll(): readonly IExtensionRegistration[] {
        const revived = [...this.active.values()];
        for (const reg of revived) this.pending.set(reg.id, reg);
        this.active.clear();
        return revived;
    }

    /** Хост выключается: таблица пуста и регистраций больше не будет. */
    public clear(): void {
        this.known.clear();
        this.pending.clear();
        this.active.clear();
    }
}

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** Поднимающееся прямо сейчас расширение — ни в одной из фаз: его держит карта активаций хоста. */
export class ExtensionPhases {
    private readonly known = new Map<string, IExtensionRegistration>();
    /** Пока reg здесь, субпроцесс под него не поднимается. */
    private readonly pending = new Map<string, IExtensionRegistration>();
    /** Регистрация нужна для оживления после смерти субпроцесса. */
    private readonly active = new Map<string, IExtensionRegistration>();

    public isRegistered(id: string): boolean {
        return this.pending.has(id) || this.active.has(id);
    }

    public register(reg: IExtensionRegistration): void {
        this.known.set(reg.id, reg);
        this.pending.set(reg.id, reg);
    }

    public all(): IterableIterator<IExtensionRegistration> {
        return this.known.values();
    }

    /** Снимком: вызывающий может менять фазы по ходу обхода. */
    public pendingRegistrations(): readonly IExtensionRegistration[] {
        return [...this.pending.values()];
    }

    public isActive(id: string): boolean {
        return this.active.has(id);
    }

    public get activeCount(): number {
        return this.active.size;
    }

    /** `false` — уже поднимается другим вызовом, активно или снято. */
    public takePending(id: string): boolean {
        return this.pending.delete(id);
    }

    public markActive(reg: IExtensionRegistration): void {
        this.active.set(reg.id, reg);
    }

    /** `false` — за время активации расширение сняли или перерегистрировали другой записью. */
    public returnInterrupted(reg: IExtensionRegistration): boolean {
        if (this.known.get(reg.id) !== reg) return false;
        this.pending.set(reg.id, reg);
        return true;
    }

    public forget(id: string): boolean {
        return this.known.delete(id);
    }

    public dropPending(id: string): boolean {
        return this.pending.delete(id);
    }

    public deactivate(id: string): boolean {
        return this.active.delete(id);
    }

    /** Активные возвращаются в ожидание — оживут на следующем событии активации. */
    public reviveAll(): readonly IExtensionRegistration[] {
        const revived = [...this.active.values()];
        for (const reg of revived) this.pending.set(reg.id, reg);
        this.active.clear();
        return revived;
    }

    public clear(): void {
        this.known.clear();
        this.pending.clear();
        this.active.clear();
    }
}

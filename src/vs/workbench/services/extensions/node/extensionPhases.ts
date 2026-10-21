import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/** An extension activating right now is in neither phase: the host's activation map holds it. */
export class ExtensionPhases {
    private readonly known = new Map<string, IExtensionRegistration>();
    /** While reg is here, no subprocess is started for it. */
    private readonly pending = new Map<string, IExtensionRegistration>();
    /** The registration is needed to revive it after the subprocess dies. */
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

    /** A snapshot: the caller may change phases while iterating. */
    public pendingRegistrations(): readonly IExtensionRegistration[] {
        return [...this.pending.values()];
    }

    public isActive(id: string): boolean {
        return this.active.has(id);
    }

    public get activeCount(): number {
        return this.active.size;
    }

    /** `false` if already being activated by another call, active, or removed. */
    public takePending(id: string): boolean {
        return this.pending.delete(id);
    }

    public markActive(reg: IExtensionRegistration): void {
        this.active.set(reg.id, reg);
    }

    /** `false` if during activation the extension was removed or re-registered with another entry. */
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

    /** Active ones go back to pending and revive on the next activation event. */
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

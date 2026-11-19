// Upstream `terminalCapabilityStore.ts`: the capabilities a terminal has gained; the shell integration addon adds each
// on its first sequence.

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { CommandDetectionCapability } from "./commandDetectionCapability.ts";
import type { CwdDetectionCapability } from "./cwdDetectionCapability.ts";
import type { ShellEnvDetectionCapability } from "./shellEnvDetectionCapability.ts";

/** Upstream `ITerminalCapabilityImplMap`, keyed by name instead of the `TerminalCapability` enum. */
export interface ITerminalCapabilityImplMap {
    commandDetection: CommandDetectionCapability;
    cwdDetection: CwdDetectionCapability;
    shellEnvDetection: ShellEnvDetectionCapability;
}

export type TerminalCapability = keyof ITerminalCapabilityImplMap;

export type TerminalCapabilityChangeEvent = {
    [K in TerminalCapability]: { readonly id: K; readonly capability: ITerminalCapabilityImplMap[K] };
}[TerminalCapability];

export class TerminalCapabilityStore implements IDisposable {
    private readonly map = new Map<TerminalCapability, ITerminalCapabilityImplMap[TerminalCapability]>();
    private readonly onDidAddCapabilityEmitter = new Emitter<TerminalCapabilityChangeEvent>();
    private readonly onDidRemoveCapabilityEmitter = new Emitter<TerminalCapabilityChangeEvent>();
    private readonly onDidAddCommandDetectionEmitter = new Emitter<CommandDetectionCapability>();

    public readonly onDidAddCapability = this.onDidAddCapabilityEmitter.event;

    public readonly onDidRemoveCapability = this.onDidRemoveCapabilityEmitter.event;

    /** Shell integration came alive: once per shell process (a relaunch removes the capability first). */
    public readonly onDidAddCommandDetectionCapability = this.onDidAddCommandDetectionEmitter.event;

    public get<K extends TerminalCapability>(id: K): ITerminalCapabilityImplMap[K] | undefined {
        // The map pairs each key with its own implementation: `add` is the only writer.
        return this.map.get(id) as ITerminalCapabilityImplMap[K] | undefined;
    }

    public has(id: TerminalCapability): boolean {
        return this.map.has(id);
    }

    public add<K extends TerminalCapability>(id: K, capability: ITerminalCapabilityImplMap[K]): void {
        this.map.set(id, capability);
        const event = { id, capability } as TerminalCapabilityChangeEvent;
        this.onDidAddCapabilityEmitter.fire(event);
        if (event.id === "commandDetection") this.onDidAddCommandDetectionEmitter.fire(event.capability);
    }

    /** Removes and disposes every capability. */
    public clear(): void {
        for (const [id, capability] of [...this.map]) {
            this.map.delete(id);
            this.onDidRemoveCapabilityEmitter.fire({ id, capability } as TerminalCapabilityChangeEvent);
            capability.dispose();
        }
    }

    public dispose(): void {
        this.clear();
        this.onDidAddCapabilityEmitter.dispose();
        this.onDidRemoveCapabilityEmitter.dispose();
        this.onDidAddCommandDetectionEmitter.dispose();
    }
}

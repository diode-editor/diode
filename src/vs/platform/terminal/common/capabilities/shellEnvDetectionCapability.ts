// Upstream `shellEnvDetectionCapability.ts`: the shell reports its environment whole (`633;EnvJson`) or variable by
// variable between `EnvSingleStart` and `EnvSingleEnd`; a change is reported once, at the end.

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { ITerminalShellEnvironment } from "./capabilities.ts";

interface IShellEnv {
    readonly value: Map<string, string>;
    isTrusted: boolean;
}

export class ShellEnvDetectionCapability implements IDisposable {
    private pending: IShellEnv | undefined;
    private current: IShellEnv = { value: new Map(), isTrusted: true };
    private readonly onDidChangeEnvEmitter = new Emitter<ITerminalShellEnvironment>();

    public readonly onDidChangeEnv = this.onDidChangeEnvEmitter.event;

    public get env(): ITerminalShellEnvironment {
        return { value: Object.fromEntries(this.current.value), isTrusted: this.current.isTrusted };
    }

    /** Upstream compares the values only: the same environment with another trust is not a change. */
    public setEnvironment(env: Readonly<Record<string, unknown>>, isTrusted: boolean): void {
        const value = new Map(
            Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
        if (sameEnv(this.current.value, value)) return;
        this.current = { value, isTrusted };
        this.fireChange();
    }

    /** `clear` — the variables that follow are the whole environment, else they update the current one. */
    public startEnvironmentSingleVar(clear: boolean, isTrusted: boolean): void {
        this.pending = clear
            ? { value: new Map(), isTrusted }
            : { value: new Map(this.current.value), isTrusted: this.current.isTrusted && isTrusted };
    }

    public setEnvironmentSingleVar(key: string, value: string, isTrusted: boolean): void {
        if (this.pending === undefined) return;
        this.pending.value.set(key, value);
        this.pending.isTrusted &&= isTrusted;
    }

    public deleteEnvironmentSingleVar(key: string, isTrusted: boolean): void {
        if (this.pending === undefined) return;
        this.pending.value.delete(key);
        this.pending.isTrusted &&= isTrusted;
    }

    public endEnvironmentSingleVar(isTrusted: boolean): void {
        const pending = this.pending;
        if (pending === undefined) return;
        this.pending = undefined;
        pending.isTrusted &&= isTrusted;
        if (sameEnv(this.current.value, pending.value)) return;
        this.current = pending;
        this.fireChange();
    }

    private fireChange(): void {
        this.onDidChangeEnvEmitter.fire(this.env);
    }

    public dispose(): void {
        this.onDidChangeEnvEmitter.dispose();
    }
}

function sameEnv(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
    return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
}

import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../configuration/common/iConfigurationService.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import { type ContextKeyValue, deserializeWhen, evaluateWhen } from "./contextKeyExpr.ts";
import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

export type ContextKeySettableValue = Exclude<ContextKeyValue, undefined>;
type ContextValue = ContextKeySettableValue;

const CONFIG_KEY_PREFIX = "config.";

/**
 * `config.<setting>` keys read from settings on their own, like upstream `ConfigAwareContextValuesContainer`:
 * lazily, with a cache that a setting change clears and reports via {@link onDidChange}.
 */
export class ContextKeyService implements IDisposable {
    private values = new Map<string, ContextValue>();
    /** `undefined` means the setting is absent. */
    private readonly configValues = new Map<string, ContextValue | undefined>();
    private readonly configListener: IDisposable | undefined;
    private readonly onDidChangeEmitter = new Emitter<ReadonlySet<string>>();
    /** Non-null means a flush is already scheduled. */
    private pending: Set<string> | null = null;

    /** Without configuration, `config.*` are ordinary keys. */
    public constructor(private readonly configuration?: IConfigurationService) {
        this.configListener = configuration?.onDidChangeConfiguration((event) => {
            for (const key of [...this.configValues.keys()]) {
                if (!event.affectsConfiguration(key.slice(CONFIG_KEY_PREFIX.length))) continue;
                this.configValues.delete(key);
                this.markChanged(key);
            }
        });
    }

    public set<K extends ContextKey>(key: K, value: ContextKeyTypes[K]): void {
        this.write(key, value as ContextValue);
    }

    /** A key outside {@link ContextKeyTypes}: `mode_<name>`, extension `setContext`. No upfront registration needed. */
    public setRaw(key: string, value: ContextValue): void {
        this.write(key, value);
    }

    public get<K extends ContextKey>(key: K): ContextKeyTypes[K] | undefined {
        return this.lookup(key) as ContextKeyTypes[K] | undefined;
    }

    public getRaw(key: string): ContextValue | undefined {
        return this.lookup(key);
    }

    public reset(key: ContextKey): void {
        if (!this.values.has(key)) return;
        this.values.delete(key);
        this.markChanged(key);
    }

    /**
     * Otherwise the event becomes a load generator: writing the same value is not a change
     * (`WorkbenchContextKeys.update()` rewrites ~20 keys before every binding
     * resolve), and several writes within a tick coalesce into one event.
     */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    /**
     * A malformed string is false. `overlay` is a "what if" on top of current values without changing them
     * (VS Code `createOverlay`): which binding would apply with focus in another field.
     */
    public evaluate(when: string, overlay?: Readonly<Record<string, ContextValue>>): boolean {
        const expr = deserializeWhen(when);
        if (expr === undefined) return false;
        return evaluateWhen(expr, {
            getValue: (key) => (overlay !== undefined && Object.hasOwn(overlay, key) ? overlay[key] : this.lookup(key)),
        });
    }

    public dispose(): void {
        this.configListener?.dispose();
        this.values.clear();
        this.onDidChangeEmitter.dispose();
        this.pending = null;
    }

    /** `config.*` comes from settings even if the key was written (like upstream). */
    private lookup(key: string): ContextValue | undefined {
        if (this.configuration === undefined || !key.startsWith(CONFIG_KEY_PREFIX)) return this.values.get(key);
        if (this.configValues.has(key)) return this.configValues.get(key);
        const value = toContextValue(this.configuration.getValue(key.slice(CONFIG_KEY_PREFIX.length)));
        this.configValues.set(key, value);
        return value;
    }

    private write(key: string, value: ContextValue): void {
        if (this.values.get(key) === value) return;
        this.values.set(key, value);
        this.markChanged(key);
    }

    private markChanged(key: string): void {
        if (this.pending === null) {
            this.pending = new Set();
            queueMicrotask(() => {
                this.flush();
            });
        }
        this.pending.add(key);
    }

    private flush(): void {
        // Taken BEFORE iterating: a write from a listener schedules the next microtask.
        // The set is never empty: only `markChanged` schedules a flush.
        const changed = this.pending ?? new Set<string>();
        this.pending = null;
        this.onDidChangeEmitter.fire(changed);
    }
}

/** Like upstream container `getValue`: arrays as a JSON string (as `=~`/`==` see them), objects as is (for `in`). */
function toContextValue(value: unknown): ContextValue | undefined {
    if (value === null) return undefined;
    return Array.isArray(value) ? JSON.stringify(value) : (value as ContextValue | undefined);
}

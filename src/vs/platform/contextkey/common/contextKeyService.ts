import type { IDisposable } from "@tuidom/core/common/disposable";
import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";
import { getAllContextKeyNames } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

type ContextValue = boolean | string | number;

/** Compiled `when`-expression: takes the values of all known keys, in name order. */
type CompiledWhen = (...values: ContextValue[]) => boolean;

/** Listener of context changes; receives the names whose values actually changed. */
export type ContextKeyChangeListener = (changed: ReadonlySet<string>) => void;

export class ContextKeyService implements IDisposable {
    private values = new Map<string, ContextValue>();
    private readonly listeners = new Set<ContextKeyChangeListener>();
    /**
     * Names changed since the last flush. Non-null means a flush is already
     * queued — several `set` in one tick become one event.
     */
    private pending: Set<string> | null = null;

    public set<K extends ContextKey>(key: K, value: ContextKeyTypes[K]): void {
        this.write(key, value as ContextValue);
    }

    /**
     * Set a dynamically-registered context key (not in the typed {@link ContextKeyTypes}),
     * e.g. a custom-mode `mode_<name>`. The name must have been registered via
     * `registerContextKeys` so the `when`-evaluator knows it.
     */
    public setRaw(key: string, value: ContextValue): void {
        this.write(key, value);
    }

    public get<K extends ContextKey>(key: K): ContextKeyTypes[K] | undefined {
        return this.values.get(key) as ContextKeyTypes[K] | undefined;
    }

    public reset(key: ContextKey): void {
        if (!this.values.has(key)) return;
        this.values.delete(key);
        this.markChanged(key);
    }

    /**
     * Change notification (VS Code `onDidChangeContext`). Consumers: the live
     * view-title toolbar, which re-resolves its buttons when `when`/`enablement`
     * of their commands could have flipped.
     *
     * Two properties this event must keep, or it becomes a load generator:
     * writing the same value is not a change (`WorkbenchContextKeys.update()`
     * rewrites ~20 keys before every keybinding resolve), and several writes in
     * one tick coalesce into a single event.
     */
    public onDidChange(listener: ContextKeyChangeListener): IDisposable {
        this.listeners.add(listener);
        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    /**
     * Evaluates a when-expression string using the current context values.
     * Supports standard JS operators: &&, ||, !, ==, !=, >, <, >=, <=
     * Boolean keys are false by default, string/number keys are undefined.
     *
     * Example: evaluate("textInputFocus && !listFocus")
     * Example: evaluate("editorLangId == 'typescript'")
     */
    public evaluate(when: string): boolean {
        const names = getAllContextKeyNames();
        const args = names.map((k) => this.values.get(k) ?? false);
        try {
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const fn = new Function(...names, `return !!(${when})`) as CompiledWhen;
            return fn(...args);
        } catch {
            return false;
        }
    }

    public dispose(): void {
        this.values.clear();
        this.listeners.clear();
        this.pending = null;
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
        // Набор забираем ДО обхода: запись из слушателя планирует следующий
        // микротаск, а не дописывает в тот, который сейчас разбирают. Пустым он
        // не бывает — flush планирует только `markChanged`, уже положивший ключ.
        const changed = this.pending ?? new Set<string>();
        this.pending = null;
        for (const listener of [...this.listeners]) listener(changed);
    }
}

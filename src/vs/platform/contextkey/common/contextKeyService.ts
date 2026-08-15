import type { IDisposable } from "@tuidom/core/common/disposable";
import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";
import { getAllContextKeyNames } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

type ContextValue = boolean | string | number;

export class ContextKeyService implements IDisposable {
    private values = new Map<string, ContextValue>();

    public set<K extends ContextKey>(key: K, value: ContextKeyTypes[K]): void {
        this.values.set(key, value);
    }

    /**
     * Set a dynamically-registered context key (not in the typed {@link ContextKeyTypes}),
     * e.g. a custom-mode `mode_<name>`. The name must have been registered via
     * `registerContextKeys` so the `when`-evaluator knows it.
     */
    public setRaw(key: string, value: ContextValue): void {
        this.values.set(key, value);
    }

    public get<K extends ContextKey>(key: K): ContextKeyTypes[K] | undefined {
        return this.values.get(key) as ContextKeyTypes[K] | undefined;
    }

    public reset(key: ContextKey): void {
        this.values.delete(key);
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
            const fn = new Function(...names, `return !!(${when})`);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            return fn(...args) as boolean;
        } catch {
            return false;
        }
    }

    public dispose(): void {
        this.values.clear();
    }
}

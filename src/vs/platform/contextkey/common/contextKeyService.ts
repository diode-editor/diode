import type { IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";
import { getAllContextKeyNames } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

type ContextValue = boolean | string | number;

/** Значение, попадающее в скоуп вычислителя: сам ключ либо узел точечного пути. */
type ScopeValue = ContextValue | ScopeObject;
interface ScopeObject {
    [segment: string]: ScopeValue;
}

/** Compiled `when`-expression: takes the values of all known keys, in name order. */
type CompiledWhen = (...values: ScopeValue[]) => boolean;

/**
 * Идентификатор, годный в параметр функции. Скоуп вычислителя — это список
 * параметров `new Function(...)`, поэтому негодное имя ломает КОМПИЛЯЦИЮ, то
 * есть все when-выражения сразу, а не только своё.
 */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Слова, которые нельзя взять именем параметра. Имена ключей приходят от
 * расширений (`setContext`), так что «никто так не назовёт» — не гарантия.
 */
const RESERVED = new Set([
    "arguments",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "eval",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "let",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
]);

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
     * Example: evaluate("supermaven.isProUser") — точечный ключ расширения
     */
    public evaluate(when: string): boolean {
        const scope = this.buildScope();
        try {
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const fn = new Function(...scope.names, `return !!(${when})`) as CompiledWhen;
            return fn(...scope.values);
        } catch {
            return false;
        }
    }

    public dispose(): void {
        this.values.clear();
        this.listeners.clear();
        this.pending = null;
    }

    /**
     * Собирает скоуп для `new Function`: список имён-параметров и значений.
     *
     * Плоские имена (`textInputFocus`) — параметр напрямую. Точечные
     * (`supermaven.isProUser`, их приносит команда `setContext` расширений)
     * выражаются НЕ параметром — такое имя развалило бы список параметров, — а
     * вложенным объектом под корневым сегментом: в выражении `supermaven.isProUser`
     * это ровно обычное чтение свойства, то есть код when-клаузы не меняется.
     *
     * Что отбрасывается (значение по-прежнему хранится, просто не видно
     * вычислителю): имя, чей корень не годится в параметр (`foo-bar`, `2fa`,
     * `class`), и точечное имя, чей корень уже занят плоским ключом — плоское
     * значение примитивно, вложить в него нельзя. Отбросить тише, чем уронить
     * компиляцию: иначе один негодный ключ убил бы ВСЕ when-выражения.
     */
    private buildScope(): { names: string[]; values: ScopeValue[] } {
        const flat = new Map<string, ScopeValue>();
        const nested = new Map<string, ScopeObject>();
        for (const name of getAllContextKeyNames()) {
            const segments = name.split(".");
            const root = segments[0];
            if (!IDENTIFIER.test(root) || RESERVED.has(root)) continue;
            const value = this.values.get(name) ?? false;
            if (segments.length === 1) {
                flat.set(root, value);
                continue;
            }
            // Сегменты после корня — имена свойств: там reserved words законны
            // (`a.class` — валидное выражение), достаточно проверки идентификатора.
            if (!segments.slice(1).every((segment) => IDENTIFIER.test(segment))) continue;
            let node = nested.get(root);
            if (node === undefined) {
                node = {};
                nested.set(root, node);
            }
            let cursor: ScopeObject = node;
            for (const segment of segments.slice(1, -1)) {
                const next = cursor[segment];
                if (typeof next !== "object") {
                    const created: ScopeObject = {};
                    cursor[segment] = created;
                    cursor = created;
                    continue;
                }
                cursor = next;
            }
            cursor[segments[segments.length - 1]] = value;
        }
        const names: string[] = [];
        const values: ScopeValue[] = [];
        for (const [name, value] of flat) {
            names.push(name);
            values.push(value);
        }
        for (const [root, object] of nested) {
            if (flat.has(root)) continue;
            names.push(root);
            values.push(object);
        }
        return { names, values };
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

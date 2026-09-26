import type { IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../instantiation/common/diContainer.ts";

import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";
import { getAllContextKeyNames } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

type ContextValue = boolean | string | number;

/** Значение в скоупе вычислителя: сам ключ либо узел точечного пути. */
type ScopeValue = ContextValue | ScopeObject;
interface ScopeObject {
    // `| undefined` честно: чтение по произвольному сегменту может не найти
    // ничего, и `buildScope` на этом ветвится.
    [segment: string]: ScopeValue | undefined;
}

/** Compiled `when`-expression: reads key values off the scope object. */
type CompiledWhen = (scope: ScopeObject) => boolean;

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
        try {
            // `with` над скоуп-объектом, а не список параметров: имя ключа
            // приходит от расширения (`setContext`) и параметром быть не обязано
            // (`foo-bar`, `2fa`, `class`) — такое имя развалило бы КОМПИЛЯЦИЮ, то
            // есть все when-выражения сразу, а не только своё. `with` в теле
            // `new Function` законен: функция всегда компилируется в sloppy-режиме,
            // независимо от строгости модуля, который её создал.
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            const fn = new Function("__scope", `with (__scope) { return !!(${when}); }`) as CompiledWhen;
            return fn(this.buildScope());
        } catch {
            // Неизвестное имя даёт ReferenceError — непрописанный ключ ложен,
            // как и раньше. Сюда же падает синтаксически битое выражение.
            return false;
        }
    }

    public dispose(): void {
        this.values.clear();
        this.listeners.clear();
        this.pending = null;
    }

    /**
     * Собирает объект-скоуп выражения.
     *
     * Плоское имя (`textInputFocus`) — свойство верхнего уровня. Точечное
     * (`supermaven.isProUser`, их приносит команда `setContext` расширений) —
     * вложенный объект под корневым сегментом: в выражении `supermaven.isProUser`
     * это ровно обычное чтение свойства, то есть текст when-клаузы не меняется.
     *
     * Прототипа у скоупа нет (`Object.create(null)`): имя ключа приходит от
     * расширения, а на обычном объекте запись по имени `__proto__` молча уходит
     * в сеттер прототипа — значение бы не сохранилось, а чтение вернуло бы
     * прототип, то есть истину вместо записанной лжи.
     *
     * Плоское имя — это вырожденный случай пути (сегмент один), поэтому проход
     * один на всех. Столкновение плоского ключа с корнем точечного разрешается
     * в пользу плоского при любом порядке: пришёл раньше — точечный упрётся в
     * примитив и будет отброшен, пришёл позже — перезапишет собой объект.
     * Отброшенная ветка именно отбрасывается, а не оседает у корня скоупа.
     */
    private buildScope(): ScopeObject {
        const scope = Object.create(null) as ScopeObject;
        for (const name of getAllContextKeyNames()) {
            const segments = name.split(".");
            let cursor = scope;
            let blocked = false;
            for (const segment of segments.slice(0, -1)) {
                const next = cursor[segment];
                if (next === undefined) {
                    // Тоже без прототипа — по той же причине, что и корень.
                    const created = Object.create(null) as ScopeObject;
                    cursor[segment] = created;
                    cursor = created;
                    continue;
                }
                // На пути стоит примитив (плоский ключ или ключ-предок) — вложить
                // в него нечего, ветку бросаем целиком.
                if (typeof next !== "object") {
                    blocked = true;
                    break;
                }
                cursor = next;
            }
            if (blocked) continue;
            cursor[segments[segments.length - 1]] = this.values.get(name) ?? false;
        }
        return scope;
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

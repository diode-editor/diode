import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import { type ContextKeyValue, deserializeWhen, evaluateWhen } from "./contextKeyExpr.ts";
import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

/** Значение ключа в сервисе: всё, что умеет when, кроме «нет значения». */
export type ContextKeySettableValue = Exclude<ContextKeyValue, undefined>;
type ContextValue = ContextKeySettableValue;

export class ContextKeyService implements IDisposable {
    private values = new Map<string, ContextValue>();
    /** Names whose values actually changed since the previous event. */
    private readonly onDidChangeEmitter = new Emitter<ReadonlySet<string>>();
    /**
     * Names changed since the last flush. Non-null means a flush is already
     * queued — several `set` in one tick become one event.
     */
    private pending: Set<string> | null = null;

    public set<K extends ContextKey>(key: K, value: ContextKeyTypes[K]): void {
        this.write(key, value as ContextValue);
    }

    /**
     * Ключ вне типизированного {@link ContextKeyTypes}: свои моды окружения
     * (`mode_<name>`), ключи расширений из `setContext` (`publisher.thing`, в том
     * числе массив или объект под оператор `in`). Регистрировать имя заранее не
     * нужно — вычислитель читает любой ключ, незнакомый просто `undefined`.
     */
    public setRaw(key: string, value: ContextValue): void {
        this.write(key, value);
    }

    public get<K extends ContextKey>(key: K): ContextKeyTypes[K] | undefined {
        return this.values.get(key) as ContextKeyTypes[K] | undefined;
    }

    /**
     * Значение любого ключа по имени — парный {@link setRaw} читатель для тех, кто
     * имя знает только строкой (инспектор: `Diode.getContextKey`).
     */
    public getRaw(key: string): ContextValue | undefined {
        return this.values.get(key);
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
    public readonly onDidChange = this.onDidChangeEmitter.event;

    /**
     * Вычисляет when-выражение над текущими значениями. Грамматика — VS Code
     * (`platform/contextkey/common/contextKeyExpr.ts`): `&& || ! == != < <= > >=`,
     * `=~ /regex/`, `in`, `not in`, значение справа без кавычек — строка
     * (`editorLangId == java`). Разобранное дерево кэшируется по строке.
     * Битая строка ложна; незнакомый ключ — `undefined`.
     *
     * `overlay` — «что если» поверх текущих значений, не меняя их (аналог
     * `createOverlay` VS Code): например, какой бинд действовал бы при фокусе
     * в поле, которое сейчас не в фокусе, — для подписи в его плейсхолдере.
     */
    public evaluate(when: string, overlay?: Readonly<Record<string, ContextValue>>): boolean {
        const expr = deserializeWhen(when);
        if (expr === undefined) return false;
        return evaluateWhen(expr, {
            getValue: (key) =>
                overlay !== undefined && Object.hasOwn(overlay, key) ? overlay[key] : this.values.get(key),
        });
    }

    public dispose(): void {
        this.values.clear();
        this.onDidChangeEmitter.dispose();
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
        this.onDidChangeEmitter.fire(changed);
    }
}

import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../configuration/common/iConfigurationService.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import { type ContextKeyValue, deserializeWhen, evaluateWhen } from "./contextKeyExpr.ts";
import type { ContextKey, ContextKeyTypes } from "./contextKeys.ts";

export const ContextKeyServiceDIToken = token<ContextKeyService>("ContextKeyService");

/** Значение ключа в сервисе: всё, что умеет when, кроме «нет значения». */
export type ContextKeySettableValue = Exclude<ContextKeyValue, undefined>;
type ContextValue = ContextKeySettableValue;

/** Префикс ключей-настроек (`ConfigAwareContextValuesContainer._keyPrefix` эталона). */
const CONFIG_KEY_PREFIX = "config.";

/**
 * When-контекст: значения ключей, их вычисление в when-выражениях и событие
 * смены. Ключи `config.<настройка>` (`config.editor.minimap.enabled`,
 * `config.claudeCode.useTerminal`) читаются из настроек сами — как корневой
 * `ConfigAwareContextValuesContainer` эталона: лениво, с кэшем, который сброс
 * настройки чистит и о котором сообщает {@link onDidChange}.
 */
export class ContextKeyService implements IDisposable {
    private values = new Map<string, ContextValue>();
    /** Прочитанные `config.*`: ключ → значение (`undefined` — настройки нет). */
    private readonly configValues = new Map<string, ContextValue | undefined>();
    private readonly configListener: IDisposable | undefined;
    /** Names whose values actually changed since the previous event. */
    private readonly onDidChangeEmitter = new Emitter<ReadonlySet<string>>();
    /**
     * Names changed since the last flush. Non-null means a flush is already
     * queued — several `set` in one tick become one event.
     */
    private pending: Set<string> | null = null;

    /** Без настроек (тесты, витрины) `config.*` — обычные ключи, как любые другие. */
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
        return this.lookup(key) as ContextKeyTypes[K] | undefined;
    }

    /**
     * Значение любого ключа по имени — парный {@link setRaw} читатель для тех, кто
     * имя знает только строкой (инспектор: `Diode.getContextKey`).
     */
    public getRaw(key: string): ContextValue | undefined {
        return this.lookup(key);
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
            getValue: (key) => (overlay !== undefined && Object.hasOwn(overlay, key) ? overlay[key] : this.lookup(key)),
        });
    }

    public dispose(): void {
        this.configListener?.dispose();
        this.configValues.clear();
        this.values.clear();
        this.onDidChangeEmitter.dispose();
        this.pending = null;
    }

    /**
     * Значение ключа: `config.*` — из настроек (запись в такой ключ им не
     * мешает, как у эталона), остальное — записанное.
     */
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
        // Набор забираем ДО обхода: запись из слушателя планирует следующий
        // микротаск, а не дописывает в тот, который сейчас разбирают. Пустым он
        // не бывает — flush планирует только `markChanged`, уже положивший ключ.
        const changed = this.pending ?? new Set<string>();
        this.pending = null;
        this.onDidChangeEmitter.fire(changed);
    }
}

/**
 * Настройка → значение ключа (`getValue` контейнера эталона): примитив как
 * есть, массив — JSON-строкой (так его видит `=~`/`==`), объект — как есть
 * (под `in`), `null`/нет настройки — «нет значения».
 */
function toContextValue(value: unknown): ContextValue | undefined {
    switch (typeof value) {
        case "boolean":
        case "number":
        case "string":
            return value;
        case "object":
            if (value === null) return undefined;
            return Array.isArray(value) ? JSON.stringify(value) : (value as Readonly<Record<string, unknown>>);
        default:
            return undefined;
    }
}

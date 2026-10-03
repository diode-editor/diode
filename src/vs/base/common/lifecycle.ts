// Примитив жизненного цикла: `IDisposable` и всё, что умеет освобождать.
//
// Наш код, а не дословный перенос: по форме и именам следует
// src/vs/base/common/lifecycle.ts эталона vscode, но берёт только ядро (без
// ссылок со счётчиком, `DisposableSet`, промис-хелперов) и не тянет его шимы.
// Исследование и план — docs/TODO/Lifecycle.md.
//
// ОСОЗНАННЫЕ ОТКЛОНЕНИЯ ОТ ЭТАЛОНА:
// - `DisposableStore` (а значит, и `Disposable`) освобождает в обратном
//   порядке (LIFO): так вёл себя прежний класс из `@tuidom/core`, и классы
//   проекта писались под него. Эталон освобождает в порядке добавления.
// - `register` вместо `_register`, приватный стор без подчёркивания —
//   правило проекта про имена (AGENTS.md).
// - Добавление в уже освобождённый стор молча оставляет объект неосвобождённым
//   (паритет с прежним классом; эталон в этом случае ещё и предупреждает).

/**
 * Объект, который что-то освобождает по вызову `dispose()`: отписка
 * слушателя, снятие провайдера, закрытие ресурса.
 */
export interface IDisposable {
    dispose(): void;
}

// #region Учёт утечек

/**
 * Наблюдатель за временем жизни объектов. По умолчанию не установлен — тогда
 * каждый хук ниже стоит одной проверки на `null`.
 */
export interface IDisposableTracker {
    /** Объект создан. */
    trackDisposable(disposable: IDisposable): void;
    /** У объекта сменился владелец; `null` — объект отдан из-под владельца. */
    setParent(child: IDisposable, parent: IDisposable | null): void;
    /** Объект освобождён. */
    markAsDisposed(disposable: IDisposable): void;
}

let disposableTracker: IDisposableTracker | null = null;

export function setDisposableTracker(tracker: IDisposableTracker | null): void {
    disposableTracker = tracker;
}

export function trackDisposable<T extends IDisposable>(x: T): T {
    disposableTracker?.trackDisposable(x);
    return x;
}

export function markAsDisposed(disposable: IDisposable): void {
    disposableTracker?.markAsDisposed(disposable);
}

function setParentOfDisposable(child: IDisposable, parent: IDisposable | null): void {
    disposableTracker?.setParent(child, parent);
}

// #endregion

/** `true`, если `thing` — объект с методом `dispose()` без аргументов. */
export function isDisposable<E>(thing: E): thing is E & IDisposable {
    if (typeof thing !== "object" || thing === null) return false;
    const candidate = (thing as Partial<IDisposable>).dispose;
    return typeof candidate === "function" && candidate.length === 0;
}

/**
 * Освобождает значение или все значения коллекции. Упавший `dispose()` не
 * мешает освободить остальных: ошибки копятся и бросаются в конце — одна как
 * есть, несколько — `AggregateError`. Массив возвращается пустым (удобно для
 * `this.items = dispose(this.items)`), прочие коллекции — как были.
 */
export function dispose<T extends IDisposable>(disposable: T): T;
export function dispose<T extends IDisposable>(disposable: T | undefined): T | undefined;
export function dispose<T extends IDisposable>(disposables: T[]): T[];
export function dispose<T extends IDisposable>(disposables: readonly T[]): readonly T[];
export function dispose<T extends IDisposable, A extends Iterable<T> = Iterable<T>>(disposables: A): A;
export function dispose<T extends IDisposable>(arg: T | Iterable<T> | undefined): T | Iterable<T> | undefined {
    if (arg === undefined) return undefined;
    if (!(Symbol.iterator in arg)) {
        arg.dispose();
        return arg;
    }
    const errors: unknown[] = [];
    for (const d of arg) {
        try {
            d.dispose();
        } catch (e) {
            errors.push(e);
        }
    }
    if (errors.length > 0) {
        throw errors.length === 1
            ? errors[0]
            : new AggregateError(errors, "Encountered errors while disposing of store");
    }
    return Array.isArray(arg) ? [] : arg;
}

class FunctionDisposable implements IDisposable {
    private disposed = false;

    public constructor(private readonly fn: () => void) {
        trackDisposable(this);
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        markAsDisposed(this);
        this.fn();
    }
}

/** Обёртка над функцией очистки; функция вызывается **не больше одного раза**. */
export function toDisposable(fn: () => void): IDisposable {
    return new FunctionDisposable(fn);
}

/** Одна ручка на несколько: освобождает их все (см. {@link dispose}). */
export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
    const parent = toDisposable(() => dispose(disposables));
    for (const child of disposables) setParentOfDisposable(child, parent);
    return parent;
}

/**
 * Набор освобождаемых объектов — вместо `IDisposable[]` с ручным циклом.
 * Повторное добавление того же объекта ничего не меняет; освобождение — в
 * обратном порядке добавления.
 */
export class DisposableStore implements IDisposable {
    private readonly toDispose = new Set<IDisposable>();
    private disposed = false;

    public constructor() {
        trackDisposable(this);
    }

    /** Освобождает всё содержимое и помечает стор освобождённым. Идемпотентен. */
    public dispose(): void {
        if (this.disposed) return;
        markAsDisposed(this);
        this.disposed = true;
        this.clear();
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    /** Освобождает всё содержимое, но стор остаётся рабочим. */
    public clear(): void {
        const items = [...this.toDispose].reverse();
        this.toDispose.clear();
        dispose(items);
    }

    public add<T extends IDisposable>(o: T): T {
        if ((o as IDisposable) === Disposable.None) return o;
        if ((o as IDisposable) === this) throw new Error("Cannot register a disposable on itself!");
        setParentOfDisposable(o, this);
        if (!this.disposed) this.toDispose.add(o);
        return o;
    }

    /** Убирает объект из стора и освобождает его (даже если в сторе его не было). */
    public delete(o: IDisposable): void {
        if (o === this) throw new Error("Cannot dispose a disposable on itself!");
        this.toDispose.delete(o);
        o.dispose();
    }

    /** Убирает объект из стора, не освобождая: дальше за него отвечает вызывающий. */
    public deleteAndLeak(o: IDisposable): void {
        if (this.toDispose.delete(o)) setParentOfDisposable(o, null);
    }
}

/**
 * База для классов, которые владеют подписками и ресурсами: всё, что прошло
 * через {@link register}, освобождается вместе с объектом (LIFO).
 */
export abstract class Disposable implements IDisposable {
    /** Ручка, которой нечего освобождать. */
    public static readonly None: IDisposable = Object.freeze<IDisposable>({ dispose: () => undefined });

    private readonly store = new DisposableStore();

    public constructor() {
        trackDisposable(this);
        setParentOfDisposable(this.store, this);
    }

    public dispose(): void {
        markAsDisposed(this);
        this.store.dispose();
    }

    protected register<T extends IDisposable>(o: T): T {
        if ((o as IDisposable) === this) throw new Error("Cannot register a disposable on itself!");
        return this.store.add(o);
    }
}

/**
 * Слот под одно сменяемое значение: новое значение освобождает прежнее.
 * Вместо поля `handle?: IDisposable` с ручным `handle?.dispose()`.
 */
export class MutableDisposable<T extends IDisposable> implements IDisposable {
    private current: T | undefined;
    private disposed = false;

    public constructor() {
        trackDisposable(this);
    }

    /** Текущее значение; после `dispose()` — всегда `undefined`. */
    public get value(): T | undefined {
        return this.disposed ? undefined : this.current;
    }

    /** Освобождает прежнее значение и ставит новое; после `dispose()` — ничего не делает. */
    public set value(value: T | undefined) {
        if (this.disposed || value === this.current) return;
        this.current?.dispose();
        if (value) setParentOfDisposable(value, this);
        this.current = value;
    }

    /** Освобождает текущее значение и оставляет слот пустым. */
    public clear(): void {
        this.value = undefined;
    }

    /** Опустошает слот, не освобождая значение, и отдаёт его вызывающему. */
    public clearAndLeak(): T | undefined {
        const old = this.current;
        this.current = undefined;
        if (old) setParentOfDisposable(old, null);
        return old;
    }

    public dispose(): void {
        this.disposed = true;
        markAsDisposed(this);
        this.current?.dispose();
        this.current = undefined;
    }
}

/**
 * Карта, значения которой освобождаются при перезаписи, удалении и вместе с
 * картой. Вместо `Map<K, IDisposable>` с ручным `get(k)?.dispose()`.
 */
export class DisposableMap<K, V extends IDisposable = IDisposable> implements IDisposable {
    private readonly map = new Map<K, V>();

    public constructor() {
        trackDisposable(this);
    }

    /** Освобождает все значения и очищает карту. */
    public dispose(): void {
        markAsDisposed(this);
        this.clearAndDisposeAll();
    }

    /** Освобождает все значения и очищает карту; сама карта остаётся рабочей. */
    public clearAndDisposeAll(): void {
        const values = [...this.map.values()];
        this.map.clear();
        dispose(values);
    }

    public has(key: K): boolean {
        return this.map.has(key);
    }

    public get size(): number {
        return this.map.size;
    }

    public get(key: K): V | undefined {
        return this.map.get(key);
    }

    /** Кладёт значение; прежнее под тем же ключом освобождается, если не попросили иначе. */
    public set(key: K, value: V, skipDisposeOnOverwrite = false): void {
        if (!skipDisposeOnOverwrite) this.map.get(key)?.dispose();
        this.map.set(key, value);
        setParentOfDisposable(value, this);
    }

    /** Удаляет значение и освобождает его. */
    public deleteAndDispose(key: K): void {
        const value = this.map.get(key);
        this.map.delete(key);
        value?.dispose();
    }

    /** Удаляет значение, не освобождая, и отдаёт его вызывающему. */
    public deleteAndLeak(key: K): V | undefined {
        const value = this.map.get(key);
        if (value) setParentOfDisposable(value, null);
        this.map.delete(key);
        return value;
    }

    public keys(): MapIterator<K> {
        return this.map.keys();
    }

    public values(): MapIterator<V> {
        return this.map.values();
    }

    public [Symbol.iterator](): MapIterator<[K, V]> {
        return this.map[Symbol.iterator]();
    }
}

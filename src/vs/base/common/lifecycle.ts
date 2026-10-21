// The core of upstream's src/vs/base/common/lifecycle.ts; deviations from it
// (docs/arch/Common.md#жизненный-цикл-lifecyclets):
// - `DisposableStore` disposes in reverse order (LIFO): project classes were
//   written against the former `@tuidom/core` class that worked this way;
// - adding to a disposed store disposes the object right away instead of letting
//   it leak with a warning: async work finishes after its owner is gone.

export interface IDisposable {
    dispose(): void;
}

// #region Leak tracking

export interface IDisposableTracker {
    trackDisposable(disposable: IDisposable): void;
    /** `null` means the object was released from its owner. */
    setParent(child: IDisposable, parent: IDisposable | null): void;
    markAsDisposed(disposable: IDisposable): void;
    markAsSingleton(disposable: IDisposable): void;
}

interface DisposableInfo {
    readonly value: IDisposable;
    /** Creation site; `null` means the object got tracked only as someone's child. */
    source: Error | null;
    parent: IDisposable | null;
    isSingleton: boolean;
}

/**
 * A leak is a live object without a live owner whose root isn't a singleton; reported
 * per root. Enabled by the `ensureNoDisposablesAreLeakedInTestSuite` helper.
 */
export class DisposableTracker implements IDisposableTracker {
    private readonly living = new Map<IDisposable, DisposableInfo>();

    private info(d: IDisposable): DisposableInfo {
        let info = this.living.get(d);
        if (!info) {
            info = { value: d, source: null, parent: null, isSingleton: false };
            this.living.set(d, info);
        }
        return info;
    }

    public trackDisposable(d: IDisposable): void {
        this.info(d).source ??= new Error();
    }

    public setParent(child: IDisposable, parent: IDisposable | null): void {
        this.info(child).parent = parent;
    }

    public markAsDisposed(d: IDisposable): void {
        this.living.delete(d);
    }

    public markAsSingleton(d: IDisposable): void {
        this.info(d).isSingleton = true;
    }

    private isUnderSingleton(info: DisposableInfo): boolean {
        const seen = new Set<DisposableInfo>();
        for (let cur: DisposableInfo | undefined = info; cur && !seen.has(cur); ) {
            if (cur.isSingleton) return true;
            seen.add(cur);
            cur = cur.parent ? this.living.get(cur.parent) : undefined;
        }
        return false;
    }

    public computeLeakingDisposables(maxReported = 10): { leaks: IDisposable[]; details: string } | undefined {
        const leaking = [...this.living.values()].filter(
            (i): i is DisposableInfo & { source: Error } => i.source !== null && !this.isUnderSingleton(i),
        );
        if (leaking.length === 0) return undefined;
        const leakingSet = new Set(leaking.map((i) => i.value));
        const roots = leaking.filter((i) => !(i.parent && leakingSet.has(i.parent)));
        if (roots.length === 0) throw new Error("There are cyclic disposable chains!");

        let details = "";
        roots.slice(0, maxReported).forEach((leak, n) => {
            details += `\n\n==== Leaking disposable ${String(n + 1)}/${String(roots.length)}: ${leak.value.constructor.name} ====\n${creationStack(leak.source)}\n`;
        });
        if (roots.length > maxReported) {
            details += `\n... and ${String(roots.length - maxReported)} more leaking disposables\n`;
        }
        return { leaks: roots.map((i) => i.value), details };
    }
}

function creationStack(source: Error): string {
    const lines = String(source.stack).split("\n").slice(1);
    const first = lines.findIndex((l) => !/\b(trackDisposable|DisposableTracker)\b/.test(l));
    return lines.slice(first).join("\n");
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

export function markAsSingleton<T extends IDisposable>(singleton: T): T {
    disposableTracker?.markAsSingleton(singleton);
    return singleton;
}

function setParentOfDisposable(child: IDisposable, parent: IDisposable | null): void {
    disposableTracker?.setParent(child, parent);
}

// #endregion

export function isDisposable<E>(thing: E): thing is E & IDisposable {
    if (typeof thing !== "object" || thing === null) return false;
    const candidate = (thing as Partial<IDisposable>).dispose;
    return typeof candidate === "function" && candidate.length === 0;
}

/** A failing `dispose()` doesn't stop the rest from being disposed: errors are thrown at the end. */
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

/** `fn` is called at most once. */
export function toDisposable(fn: () => void): IDisposable {
    return new FunctionDisposable(fn);
}

export function combinedDisposable(...disposables: IDisposable[]): IDisposable {
    const parent = toDisposable(() => dispose(disposables));
    for (const child of disposables) setParentOfDisposable(child, parent);
    return parent;
}

export class DisposableStore implements IDisposable {
    private readonly toDispose = new Set<IDisposable>();
    private disposed = false;

    public constructor() {
        trackDisposable(this);
    }

    public dispose(): void {
        if (this.disposed) return;
        markAsDisposed(this);
        this.disposed = true;
        this.clear();
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    public clear(): void {
        const items = [...this.toDispose].reverse();
        this.toDispose.clear();
        dispose(items);
    }

    public add<T extends IDisposable>(o: T): T {
        if ((o as IDisposable) === Disposable.None) return o;
        if ((o as IDisposable) === this) throw new Error("Cannot register a disposable on itself!");
        setParentOfDisposable(o, this);
        if (this.disposed) o.dispose();
        else this.toDispose.add(o);
        return o;
    }

    public delete(o: IDisposable): void {
        if (o === this) throw new Error("Cannot dispose a disposable on itself!");
        this.toDispose.delete(o);
        o.dispose();
    }

    public deleteAndLeak(o: IDisposable): void {
        if (this.toDispose.delete(o)) setParentOfDisposable(o, null);
    }
}

export abstract class Disposable implements IDisposable {
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

    /** The upstream name for vendored code (`model/pieceTreeTextBuffer/`); our code calls `register`. */
    protected _register<T extends IDisposable>(o: T): T {
        return this.register(o);
    }
}

export class MutableDisposable<T extends IDisposable> implements IDisposable {
    private current: T | undefined;
    private disposed = false;

    public constructor() {
        trackDisposable(this);
    }

    public get value(): T | undefined {
        return this.disposed ? undefined : this.current;
    }

    public set value(value: T | undefined) {
        if (this.disposed || value === this.current) return;
        this.current?.dispose();
        if (value) setParentOfDisposable(value, this);
        this.current = value;
    }

    public clear(): void {
        this.value = undefined;
    }

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

export class DisposableMap<K, V extends IDisposable = IDisposable> implements IDisposable {
    private readonly map = new Map<K, V>();

    public constructor() {
        trackDisposable(this);
    }

    public dispose(): void {
        markAsDisposed(this);
        this.clearAndDisposeAll();
    }

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

    public set(key: K, value: V, skipDisposeOnOverwrite = false): void {
        if (!skipDisposeOnOverwrite) this.map.get(key)?.dispose();
        this.map.set(key, value);
        setParentOfDisposable(value, this);
    }

    public deleteAndDispose(key: K): void {
        const value = this.map.get(key);
        this.map.delete(key);
        value?.dispose();
    }

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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    combinedDisposable,
    Disposable,
    DisposableMap,
    DisposableStore,
    DisposableTracker,
    dispose,
    type IDisposable,
    type IDisposableTracker,
    isDisposable,
    markAsDisposed,
    markAsSingleton,
    MutableDisposable,
    setDisposableTracker,
    toDisposable,
    trackDisposable,
} from "./lifecycle.ts";

/** Ручка, которая пишет своё имя в общий журнал при освобождении. */
function logged(log: string[], name: string): IDisposable {
    return { dispose: () => log.push(name) };
}

function throwing(error: unknown): IDisposable {
    return {
        dispose: () => {
            throw error;
        },
    };
}

class Owner extends Disposable {
    public add<T extends IDisposable>(o: T): T {
        return this.register(o);
    }
}

describe("isDisposable", () => {
    it("узнаёт объект с dispose() без аргументов", () => {
        expect(isDisposable({ dispose: () => undefined })).toBe(true);
        expect(isDisposable(toDisposable(() => undefined))).toBe(true);
    });

    it("отвергает всё остальное", () => {
        expect(isDisposable(null)).toBe(false);
        expect(isDisposable(undefined)).toBe(false);
        expect(isDisposable("dispose")).toBe(false);
        expect(isDisposable(() => undefined)).toBe(false);
        expect(isDisposable({})).toBe(false);
        expect(isDisposable({ dispose: 1 })).toBe(false);
        expect(isDisposable({ dispose: (_force: boolean) => undefined })).toBe(false);
    });
});

describe("dispose", () => {
    it("одиночное значение освобождает и возвращает как есть", () => {
        const log: string[] = [];
        const d = logged(log, "a");
        expect(dispose(d)).toBe(d);
        expect(log).toEqual(["a"]);
        expect(dispose(undefined)).toBeUndefined();
    });

    it("массив освобождает по порядку и возвращает новый пустой массив", () => {
        const log: string[] = [];
        const items = [logged(log, "a"), logged(log, "b")];
        const result = dispose(items);
        expect(log).toEqual(["a", "b"]);
        expect(result).toEqual([]);
        expect(result).not.toBe(items);
    });

    it("прочую коллекцию возвращает ту же", () => {
        const log: string[] = [];
        const set = new Set([logged(log, "a"), logged(log, "b")]);
        expect(dispose(set)).toBe(set);
        expect(log).toEqual(["a", "b"]);
    });

    it("одна ошибка не мешает освободить остальных и бросается как есть", () => {
        const log: string[] = [];
        const boom = new Error("boom");
        expect(() => dispose([logged(log, "a"), throwing(boom), logged(log, "b")])).toThrow(boom);
        expect(log).toEqual(["a", "b"]);
    });

    it("несколько ошибок собираются в AggregateError", () => {
        const log: string[] = [];
        const first = new Error("first");
        const second = new Error("second");
        let caught: unknown;
        try {
            dispose([throwing(first), logged(log, "a"), throwing(second)]);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(AggregateError);
        expect((caught as AggregateError).errors).toEqual([first, second]);
        expect((caught as AggregateError).message).toBe("Encountered errors while disposing of store");
        expect(log).toEqual(["a"]);
    });
});

describe("toDisposable", () => {
    it("зовёт функцию очистки ровно один раз", () => {
        const fn = vi.fn();
        const d = toDisposable(fn);
        expect(fn).not.toHaveBeenCalled();
        d.dispose();
        d.dispose();
        expect(fn).toHaveBeenCalledOnce();
    });
});

describe("combinedDisposable", () => {
    it("освобождает все части один раз", () => {
        const log: string[] = [];
        const d = combinedDisposable(logged(log, "a"), logged(log, "b"));
        expect(log).toEqual([]);
        d.dispose();
        d.dispose();
        expect(log).toEqual(["a", "b"]);
    });
});

describe("DisposableStore", () => {
    it("освобождает в обратном порядке добавления и помечает себя освобождённым", () => {
        const log: string[] = [];
        const store = new DisposableStore();
        const a = logged(log, "a");
        expect(store.add(a)).toBe(a);
        store.add(logged(log, "b"));
        store.add(a);
        expect(store.isDisposed).toBe(false);

        store.dispose();
        expect(log).toEqual(["b", "a"]);
        expect(store.isDisposed).toBe(true);

        store.dispose();
        expect(log).toEqual(["b", "a"]);
    });

    it("clear освобождает содержимое, но стор остаётся рабочим", () => {
        const log: string[] = [];
        const store = new DisposableStore();
        store.add(logged(log, "a"));
        store.clear();
        expect(log).toEqual(["a"]);
        expect(store.isDisposed).toBe(false);

        store.clear();
        expect(log).toEqual(["a"]);

        store.add(logged(log, "b"));
        store.dispose();
        expect(log).toEqual(["a", "b"]);
    });

    it("упавший элемент не мешает освободить остальных, и повторно они не освобождаются", () => {
        const log: string[] = [];
        const boom = new Error("boom");
        const store = new DisposableStore();
        store.add(logged(log, "a"));
        store.add(throwing(boom));
        store.add(logged(log, "b"));
        expect(() => {
            store.clear();
        }).toThrow(boom);
        expect(log).toEqual(["b", "a"]);
        store.dispose();
        expect(log).toEqual(["b", "a"]);
    });

    it("добавленное после dispose освобождается сразу и один раз", () => {
        const log: string[] = [];
        const store = new DisposableStore();
        store.dispose();
        const late = logged(log, "late");
        expect(store.add(late)).toBe(late);
        expect(log).toEqual(["late"]);
        store.dispose();
        store.clear();
        expect(log).toEqual(["late"]);
    });

    it("Disposable: зарегистрированное после dispose освобождается сразу", () => {
        const log: string[] = [];
        const owner = new Owner();
        owner.dispose();
        owner.add(logged(log, "late"));
        expect(log).toEqual(["late"]);
    });

    it("Disposable.None не хранит, себя добавить не даёт", () => {
        const store = new DisposableStore();
        expect(store.add(Disposable.None)).toBe(Disposable.None);
        expect(() => store.add(store)).toThrow("Cannot register a disposable on itself!");
        expect(() => {
            store.delete(store);
        }).toThrow("Cannot dispose a disposable on itself!");
    });

    it("delete убирает и освобождает, даже если объекта в сторе не было", () => {
        const log: string[] = [];
        const store = new DisposableStore();
        const a = logged(log, "a");
        store.add(a);
        store.delete(a);
        expect(log).toEqual(["a"]);
        store.dispose();
        expect(log).toEqual(["a"]);

        store.delete(logged(log, "stranger"));
        expect(log).toEqual(["a", "stranger"]);
    });

    it("deleteAndLeak убирает, не освобождая", () => {
        const log: string[] = [];
        const store = new DisposableStore();
        const a = logged(log, "a");
        store.add(Disposable.None);
        store.add(a);
        store.deleteAndLeak(a);
        store.dispose();
        expect(log).toEqual([]);
    });
});

describe("Disposable", () => {
    it("освобождает зарегистрированное в обратном порядке, повторный dispose — no-op", () => {
        const log: string[] = [];
        const owner = new Owner();
        const a = logged(log, "a");
        expect(owner.add(a)).toBe(a);
        owner.add(logged(log, "b"));
        owner.dispose();
        expect(log).toEqual(["b", "a"]);
        owner.dispose();
        expect(log).toEqual(["b", "a"]);
    });

    it("себя зарегистрировать не даёт", () => {
        const owner = new Owner();
        expect(() => owner.add(owner)).toThrow("Cannot register a disposable on itself!");
    });

    it("None — замороженная пустышка", () => {
        expect(Object.isFrozen(Disposable.None)).toBe(true);
        expect(() => {
            Disposable.None.dispose();
        }).not.toThrow();
    });
});

describe("MutableDisposable", () => {
    it("новое значение освобождает прежнее, то же самое — нет", () => {
        const log: string[] = [];
        const slot = new MutableDisposable<IDisposable>();
        expect(slot.value).toBeUndefined();
        const a = logged(log, "a");
        slot.value = a;
        slot.value = a;
        expect(log).toEqual([]);
        expect(slot.value).toBe(a);

        const b = logged(log, "b");
        slot.value = b;
        expect(log).toEqual(["a"]);
        expect(slot.value).toBe(b);
    });

    it("clear освобождает и опустошает слот", () => {
        const log: string[] = [];
        const slot = new MutableDisposable<IDisposable>();
        slot.value = logged(log, "a");
        slot.clear();
        expect(log).toEqual(["a"]);
        expect(slot.value).toBeUndefined();
    });

    it("clearAndLeak отдаёт значение, не освобождая", () => {
        const log: string[] = [];
        const slot = new MutableDisposable<IDisposable>();
        expect(slot.clearAndLeak()).toBeUndefined();
        const a = logged(log, "a");
        slot.value = a;
        expect(slot.clearAndLeak()).toBe(a);
        expect(slot.value).toBeUndefined();
        slot.dispose();
        expect(log).toEqual([]);
    });

    it("после dispose значение освобождено, новые не принимаются", () => {
        const log: string[] = [];
        const slot = new MutableDisposable<IDisposable>();
        slot.value = logged(log, "a");
        slot.dispose();
        expect(log).toEqual(["a"]);
        expect(slot.value).toBeUndefined();

        slot.value = logged(log, "late");
        expect(slot.value).toBeUndefined();
        slot.dispose();
        expect(log).toEqual(["a"]);
    });
});

describe("DisposableMap", () => {
    it("перезапись освобождает прежнее значение, если не попросили иначе", () => {
        const log: string[] = [];
        const map = new DisposableMap<string>();
        const a = logged(log, "a");
        map.set("k", a);
        expect(map.get("k")).toBe(a);
        expect(map.has("k")).toBe(true);
        expect(map.size).toBe(1);

        map.set("k", logged(log, "b"));
        expect(log).toEqual(["a"]);

        map.set("k", logged(log, "c"), true);
        expect(log).toEqual(["a"]);
        expect(map.size).toBe(1);
    });

    it("deleteAndDispose удаляет и освобождает; deleteAndLeak — только удаляет", () => {
        const log: string[] = [];
        const map = new DisposableMap<string>();
        map.set("a", logged(log, "a"));
        const b = logged(log, "b");
        map.set("b", b);

        map.deleteAndDispose("a");
        expect(log).toEqual(["a"]);
        expect(map.has("a")).toBe(false);
        map.deleteAndDispose("missing");

        expect(map.deleteAndLeak("b")).toBe(b);
        expect(map.has("b")).toBe(false);
        expect(map.deleteAndLeak("missing")).toBeUndefined();
        map.dispose();
        expect(log).toEqual(["a"]);
    });

    it("перечисляется как Map", () => {
        const map = new DisposableMap<string>();
        const a = toDisposable(() => undefined);
        const b = toDisposable(() => undefined);
        map.set("a", a);
        map.set("b", b);
        expect([...map.keys()]).toEqual(["a", "b"]);
        expect([...map.values()]).toEqual([a, b]);
        expect([...map]).toEqual([
            ["a", a],
            ["b", b],
        ]);
    });

    it("clearAndDisposeAll и dispose освобождают всё", () => {
        const log: string[] = [];
        const map = new DisposableMap<string>();
        map.clearAndDisposeAll();
        map.set("a", logged(log, "a"));
        map.set("b", logged(log, "b"));
        map.clearAndDisposeAll();
        expect(log).toEqual(["a", "b"]);
        expect(map.size).toBe(0);

        map.set("c", logged(log, "c"));
        map.dispose();
        expect(log).toEqual(["a", "b", "c"]);
        expect(map.size).toBe(0);
    });
});

describe("хуки учёта утечек", () => {
    function recordingTracker(): { tracker: IDisposableTracker; events: string[]; names: Map<IDisposable, string> } {
        const names = new Map<IDisposable, string>();
        const events: string[] = [];
        const name = (d: IDisposable | null): string => (d === null ? "null" : (names.get(d) ?? "?"));
        return {
            names,
            events,
            tracker: {
                trackDisposable: (d) => events.push(`track ${name(d)}`),
                setParent: (child, parent) => events.push(`parent ${name(child)} ← ${name(parent)}`),
                markAsDisposed: (d) => events.push(`disposed ${name(d)}`),
                markAsSingleton: (d) => events.push(`singleton ${name(d)}`),
            },
        };
    }

    afterEach(() => {
        setDisposableTracker(null);
    });

    it("без трекера хуки — no-op", () => {
        const d = toDisposable(() => undefined);
        expect(trackDisposable(d)).toBe(d);
        expect(markAsSingleton(d)).toBe(d);
        markAsDisposed(d);
    });

    it("markAsSingleton доходит до трекера", () => {
        const { tracker, events, names } = recordingTracker();
        const d: IDisposable = { dispose: () => undefined };
        names.set(d, "d");
        setDisposableTracker(tracker);
        expect(markAsSingleton(d)).toBe(d);
        expect(events).toEqual(["singleton d"]);
    });

    it("trackDisposable и markAsDisposed доходят до трекера", () => {
        const { tracker, events, names } = recordingTracker();
        const d: IDisposable = { dispose: () => undefined };
        names.set(d, "d");
        setDisposableTracker(tracker);
        expect(trackDisposable(d)).toBe(d);
        markAsDisposed(d);
        expect(events).toEqual(["track d", "disposed d"]);
    });

    it("toDisposable и combinedDisposable сообщают о создании, родстве и освобождении", () => {
        const { tracker, events, names } = recordingTracker();
        setDisposableTracker(tracker);
        const a = toDisposable(() => undefined);
        names.set(a, "a");
        const parent = combinedDisposable(a);
        names.set(parent, "parent");
        parent.dispose();
        expect(events).toEqual(["track ?", "track ?", "parent a ← ?", "disposed parent", "disposed a"]);
    });

    it("стор и Disposable сообщают о родстве и освобождении", () => {
        const { tracker, events, names } = recordingTracker();
        const a: IDisposable = { dispose: () => undefined };
        names.set(a, "a");
        setDisposableTracker(tracker);
        const store = new DisposableStore();
        names.set(store, "store");
        store.add(Disposable.None);
        store.add(a);
        store.deleteAndLeak(a);
        store.deleteAndLeak(a);
        store.dispose();
        store.dispose();
        expect(events).toEqual(["track ?", "parent a ← store", "parent a ← null", "disposed store"]);

        events.length = 0;
        const owner = new Owner();
        names.set(owner, "owner");
        owner.dispose();
        expect(events).toEqual(["track ?", "track ?", "parent ? ← ?", "disposed owner", "disposed ?"]);
    });

    it("слот и карта сообщают о родстве и освобождении", () => {
        const { tracker, events, names } = recordingTracker();
        const a: IDisposable = { dispose: () => undefined };
        names.set(a, "a");
        setDisposableTracker(tracker);

        const slot = new MutableDisposable<IDisposable>();
        names.set(slot, "slot");
        slot.clearAndLeak();
        slot.value = a;
        slot.value = undefined;
        slot.value = a;
        slot.clearAndLeak();
        slot.dispose();
        expect(events).toEqual(["track ?", "parent a ← slot", "parent a ← slot", "parent a ← null", "disposed slot"]);

        events.length = 0;
        const map = new DisposableMap<string>();
        names.set(map, "map");
        map.set("k", a);
        map.deleteAndLeak("k");
        map.deleteAndLeak("k");
        map.dispose();
        expect(events).toEqual(["track ?", "parent a ← map", "parent a ← null", "disposed map"]);
    });
});

describe("DisposableTracker", () => {
    afterEach(() => {
        setDisposableTracker(null);
    });

    function underTracker<T>(body: () => T): { tracker: DisposableTracker; result: T } {
        const tracker = new DisposableTracker();
        setDisposableTracker(tracker);
        try {
            return { tracker, result: body() };
        } finally {
            setDisposableTracker(null);
        }
    }

    it("всё освобождённое — утечек нет", () => {
        const { tracker } = underTracker(() => {
            const store = new DisposableStore();
            store.add(toDisposable(() => undefined));
            const owner = new Owner();
            owner.add(new MutableDisposable());
            store.dispose();
            owner.dispose();
        });
        expect(tracker.computeLeakingDisposables()).toBeUndefined();
    });

    it("отчёт — по корням: дети утёкшего владельца не считаются", () => {
        const { tracker, result: store } = underTracker(() => {
            const store = new DisposableStore();
            store.add(toDisposable(() => undefined));
            store.add(new MutableDisposable());
            return store;
        });
        const report = tracker.computeLeakingDisposables();
        expect(report?.leaks).toEqual([store]);
        expect(report?.details).toContain("Leaking disposable 1/1: DisposableStore");
        // Стек начинается с места создания, а не с кадров учёта.
        expect(report?.details).not.toMatch(/^\s*at .*trackDisposable/m);
        expect(report?.details).toContain("lifecycle.test.ts");
        expect(report?.details.match(/\n\s+at /g)?.length).toBeGreaterThan(1);
    });

    it("объект, созданный до трекера, в учёт не попадает, даже став чьим-то ребёнком", () => {
        const early = toDisposable(() => undefined);
        const { tracker } = underTracker(() => {
            new MutableDisposable<IDisposable>().value = early;
        });
        expect(tracker.computeLeakingDisposables()?.leaks).toHaveLength(1);
        expect(tracker.computeLeakingDisposables()?.leaks).not.toContain(early);
    });

    it("объект без места создания, отданный из-под владельца, утечкой не считается", () => {
        const early = toDisposable(() => undefined);
        const { tracker } = underTracker(() => {
            const store = new DisposableStore();
            store.add(early);
            store.deleteAndLeak(early);
            store.dispose();
        });
        expect(tracker.computeLeakingDisposables()).toBeUndefined();
    });

    it("ребёнок владельца, созданного до трекера, — сам себе корень", () => {
        const early = new DisposableStore();
        const { tracker, result: child } = underTracker(() => early.add(toDisposable(() => undefined)));
        expect(tracker.computeLeakingDisposables()?.leaks).toEqual([child]);
        early.dispose();
    });

    it("синглтон и всё под ним утечкой не считаются", () => {
        const { tracker } = underTracker(() => {
            const registry = markAsSingleton(new DisposableStore());
            const nested = registry.add(new DisposableStore());
            nested.add(toDisposable(() => undefined));
        });
        expect(tracker.computeLeakingDisposables()).toBeUndefined();
    });

    it("отданный из-под владельца объект снова свой корень", () => {
        const { tracker, result: leaked } = underTracker(() => {
            const store = new DisposableStore();
            const child = store.add(toDisposable(() => undefined));
            store.deleteAndLeak(child);
            store.dispose();
            return child;
        });
        expect(tracker.computeLeakingDisposables()?.leaks).toEqual([leaked]);
    });

    it("режет отчёт по maxReported и называет остаток", () => {
        const { tracker } = underTracker(() => {
            for (let i = 0; i < 3; i++) toDisposable(() => undefined);
        });
        const report = tracker.computeLeakingDisposables(2);
        expect(report?.leaks).toHaveLength(3);
        expect(report?.details).toContain("Leaking disposable 2/3: FunctionDisposable");
        expect(report?.details).not.toContain("Leaking disposable 3/3");
        expect(report?.details).toContain("... and 1 more leaking disposables");
        expect(tracker.computeLeakingDisposables(3)?.details).not.toContain("more leaking");
    });

    it("цикл владельцев без корня — ошибка", () => {
        const tracker = new DisposableTracker();
        const a: IDisposable = { dispose: () => undefined };
        const b: IDisposable = { dispose: () => undefined };
        tracker.trackDisposable(a);
        tracker.trackDisposable(b);
        tracker.setParent(a, b);
        tracker.setParent(b, a);
        expect(() => tracker.computeLeakingDisposables()).toThrow("There are cyclic disposable chains!");
    });

    it("повторный trackDisposable не переписывает место создания", () => {
        const tracker = new DisposableTracker();
        const d: IDisposable = { dispose: () => undefined };
        tracker.trackDisposable(d);
        const first = tracker.computeLeakingDisposables()?.details;
        (function elsewhere(): void {
            tracker.trackDisposable(d);
        })();
        expect(tracker.computeLeakingDisposables()?.details).toBe(first);
    });
});

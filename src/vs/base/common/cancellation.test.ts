import { describe, expect, it, vi } from "vitest";

import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../TestUtils/disposableLeaks.ts";

import type { ICancellationListener, ICancellationToken } from "./cancellation.ts";
import { CancellationTokenNone, CancellationTokenSource, LatestRequest } from "./cancellation.ts";

ensureNoDisposablesAreLeakedInTestSuite();

/** Родитель-шпион: видно, подписан ли на него кто-то прямо сейчас. */
function spyParent(): { token: ICancellationToken; fire: () => void; readonly subscribers: number } {
    const listeners = new Set<ICancellationListener>();
    return {
        token: {
            isCancellationRequested: false,
            onCancellationRequested: (listener) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
        },
        fire: () => {
            for (const listener of [...listeners]) listener();
        },
        get subscribers() {
            return listeners.size;
        },
    };
}

describe("CancellationTokenSource", () => {
    it("cancel взводит флаг и зовёт подписчиков ровно один раз", () => {
        const source = new CancellationTokenSource();
        const first = vi.fn();
        const second = vi.fn();
        source.token.onCancellationRequested(first);
        source.token.onCancellationRequested(second);

        expect(source.token.isCancellationRequested).toBe(false);
        expect(first).not.toHaveBeenCalled();

        source.cancel();
        expect(source.token.isCancellationRequested).toBe(true);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();

        // Повторная отмена идемпотентна: слушателей второй раз не дёргает.
        source.cancel();
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it("подписка на УЖЕ отменённый токен зовёт слушателя сразу", () => {
        const source = new CancellationTokenSource();
        source.cancel();

        const late = vi.fn();
        const subscription = source.token.onCancellationRequested(late);
        expect(late).toHaveBeenCalledOnce();

        // Отписываться нечего и не от чего — dispose безвреден.
        subscription.dispose();
        source.cancel();
        expect(late).toHaveBeenCalledOnce();
    });

    it("dispose подписки снимает слушателя, dispose источника — всех сразу", () => {
        const source = new CancellationTokenSource();
        const dropped = vi.fn();
        const kept = vi.fn();
        const subscription = source.token.onCancellationRequested(dropped);
        source.token.onCancellationRequested(kept);

        subscription.dispose();
        // Повторный dispose не выбрасывает чужого слушателя.
        subscription.dispose();
        source.cancel();

        expect(dropped).not.toHaveBeenCalled();
        expect(kept).toHaveBeenCalledOnce();

        const other = new CancellationTokenSource();
        const listener = vi.fn();
        other.token.onCancellationRequested(listener);
        other.dispose();
        other.cancel();
        // dispose НЕ отменяет — он только снимает слушателей.
        expect(listener).not.toHaveBeenCalled();
        expect(other.token.isCancellationRequested).toBe(true);
    });

    it("слушатель вправе отписать соседа из колбэка — обход идёт по снапшоту", () => {
        const source = new CancellationTokenSource();
        const neighbour = vi.fn();
        let neighbourSubscription = { dispose: (): void => undefined };
        source.token.onCancellationRequested(() => {
            neighbourSubscription.dispose();
        });
        neighbourSubscription = source.token.onCancellationRequested(neighbour);

        source.cancel();

        expect(neighbour).toHaveBeenCalledOnce();
    });
});

describe("CancellationTokenSource(parent)", () => {
    it("отмена родителя отменяет источник и зовёт его слушателей", () => {
        const parent = new CancellationTokenSource();
        const child = new CancellationTokenSource(parent.token);
        const listener = vi.fn();
        child.token.onCancellationRequested(listener);

        parent.cancel();

        expect(child.token.isCancellationRequested).toBe(true);
        expect(listener).toHaveBeenCalledOnce();
    });

    it("уже отменённый родитель отменяет источник сразу", () => {
        const parent = new CancellationTokenSource();
        parent.cancel();

        expect(new CancellationTokenSource(parent.token).token.isCancellationRequested).toBe(true);
    });

    it("отмена источника родителя не трогает", () => {
        const parent = new CancellationTokenSource();
        const child = new CancellationTokenSource(parent.token);

        child.cancel();

        expect(parent.token.isCancellationRequested).toBe(false);
    });

    it("dispose снимает подписку на родителя", () => {
        const parent = spyParent();
        const child = new CancellationTokenSource(parent.token);
        expect(parent.subscribers).toBe(1);

        child.dispose();

        expect(parent.subscribers).toBe(0);
        parent.fire();
        expect(child.token.isCancellationRequested).toBe(false);
    });
});

describe("LatestRequest", () => {
    it("start перебивает прежний билет: тот устаревает, новый — нет", () => {
        const latest = new LatestRequest();
        const first = latest.start();
        expect(first.isStale()).toBe(false);
        expect(first.token.isCancellationRequested).toBe(false);

        const second = latest.start();

        expect(first.isStale()).toBe(true);
        expect(first.token.isCancellationRequested).toBe(true);
        expect(second.isStale()).toBe(false);
    });

    it("cancel устаревает текущий билет, следующий start снова свежий", () => {
        const latest = new LatestRequest();
        const ticket = latest.start();

        latest.cancel();
        expect(ticket.isStale()).toBe(true);
        // Повторная отмена без текущего запроса безвредна.
        latest.cancel();

        expect(latest.start().isStale()).toBe(false);
    });

    it("pending: горит от start до done или отмены", () => {
        const latest = new LatestRequest();
        expect(latest.pending).toBe(false);

        const ticket = latest.start();
        expect(latest.pending).toBe(true);
        ticket.done();
        expect(latest.pending).toBe(false);
        // Отработавший билет отмена владельца не трогает.
        latest.cancel();
        expect(ticket.isStale()).toBe(false);

        latest.start();
        latest.cancel();
        expect(latest.pending).toBe(false);
    });

    it("done перебитого билета не гасит pending нового", () => {
        const latest = new LatestRequest();
        const first = latest.start();
        const second = latest.start();

        first.done();

        expect(latest.pending).toBe(true);
        latest.cancel();
        expect(second.isStale()).toBe(true);
    });

    it("отмена родителя устаревает билет", () => {
        const latest = new LatestRequest();
        const parent = new CancellationTokenSource();
        const ticket = latest.start(parent.token);

        parent.cancel();

        expect(ticket.isStale()).toBe(true);
    });

    it("подписку на родителя снимают и done, и перебивающий start", () => {
        const latest = new LatestRequest();
        const parent = spyParent();

        latest.start(parent.token).done();
        expect(parent.subscribers).toBe(0);

        latest.start(parent.token);
        expect(parent.subscribers).toBe(1);
        latest.start();
        expect(parent.subscribers).toBe(0);
    });

    it("после dispose текущий билет устарел, а новые выдаются уже отменёнными", () => {
        const latest = new LatestRequest();
        const ticket = latest.start();

        latest.dispose();

        expect(ticket.isStale()).toBe(true);
        const late = latest.start();
        expect(late.isStale()).toBe(true);
        expect(late.token.isCancellationRequested).toBe(true);
    });
});

describe("CancellationTokenNone", () => {
    it("не отменяется и выдаёт подписку-пустышку", () => {
        const listener = vi.fn();
        const subscription = CancellationTokenNone.onCancellationRequested(listener);

        expect(CancellationTokenNone.isCancellationRequested).toBe(false);
        expect(listener).not.toHaveBeenCalled();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });
});

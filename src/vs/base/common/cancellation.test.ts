import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone, CancellationTokenSource } from "./cancellation.ts";

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

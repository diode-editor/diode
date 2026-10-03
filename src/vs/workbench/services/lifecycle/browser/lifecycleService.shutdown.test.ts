import { afterEach, describe, expect, it, vi } from "vitest";

import { DialogService } from "../../dialogs/browser/dialogService.ts";

import { LifecycleService, SHUTDOWN_JOIN_TIMEOUT_MS } from "./lifecycleService.ts";

/** Промис, который резолвит тест, — «участник ещё прощается». */
function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("LifecycleService.shutdown — единое прощание", () => {
    it("сперва асинхронная фаза, затем синхронная в обратном порядке подписки, последним — then", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const log: string[] = [];
        lifecycle.onShutdownSync(() => log.push("state"));
        lifecycle.onShutdownSync(() => log.push("terminal"));
        lifecycle.onWillShutdown((event) => {
            log.push(`will:${event.reason}`);
        });

        await lifecycle.shutdown("reload", () => log.push("then"));

        expect(log).toEqual(["will:reload", "terminal", "state", "then"]);
    });

    it("синхронная фаза ждёт присоединённые промисы", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const subprocess = deferred();
        const then = vi.fn();
        const sync = vi.fn();
        lifecycle.onWillShutdown((event) => {
            event.join(subprocess.promise);
        });
        lifecycle.onShutdownSync(sync);

        const done = lifecycle.shutdown("quit", then);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(sync).not.toHaveBeenCalled();
        expect(then).not.toHaveBeenCalled();

        subprocess.resolve();
        await done;
        expect(sync).toHaveBeenCalledOnce();
        expect(then).toHaveBeenCalledOnce();
    });

    it("зависший участник не держит выход дольше общего тайм-аута", async () => {
        vi.useFakeTimers();
        const lifecycle = new LifecycleService(new DialogService());
        const then = vi.fn();
        lifecycle.onWillShutdown((event) => {
            event.join(new Promise(() => undefined));
        });

        void lifecycle.shutdown("quit", then);
        await vi.advanceTimersByTimeAsync(SHUTDOWN_JOIN_TIMEOUT_MS - 1);
        expect(then).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(then).toHaveBeenCalledOnce();
    });

    it("тайм-аут настраивается конструктором", async () => {
        vi.useFakeTimers();
        const lifecycle = new LifecycleService(new DialogService(), 10);
        const then = vi.fn();
        lifecycle.onWillShutdown((event) => {
            event.join(new Promise(() => undefined));
        });

        void lifecycle.shutdown("quit", then);
        await vi.advanceTimersByTimeAsync(10);
        expect(then).toHaveBeenCalledOnce();
    });

    it("уложившиеся участники не ждут тайм-аута: его таймер снимается", async () => {
        vi.useFakeTimers();
        const lifecycle = new LifecycleService(new DialogService());
        lifecycle.onWillShutdown((event) => {
            event.join(Promise.resolve());
        });

        await lifecycle.shutdown("quit", () => undefined);

        // Висящий таймер держал бы event loop процесса после выхода.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("отказ присоединённого промиса и сбой участника не останавливают остальных", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const sync = vi.fn();
        const then = vi.fn();
        lifecycle.onWillShutdown(() => {
            throw new Error("не смог начать");
        });
        lifecycle.onWillShutdown((event) => {
            event.join(Promise.reject(new Error("упал по дороге")));
        });
        lifecycle.onShutdownSync(sync);
        lifecycle.onShutdownSync(() => {
            throw new Error("синхронный сбой");
        });

        await lifecycle.shutdown("inspector", then);

        expect(sync).toHaveBeenCalledOnce();
        expect(then).toHaveBeenCalledOnce();
    });

    it("повторный вызов присоединяется к первому прощанию, не повторяя его", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const will = vi.fn();
        const sync = vi.fn();
        const first = vi.fn();
        const second = vi.fn();
        lifecycle.onWillShutdown(will);
        lifecycle.onShutdownSync(sync);

        const a = lifecycle.shutdown("quit", first);
        const b = lifecycle.shutdown("reload", second);
        await Promise.all([a, b]);

        expect(b).toBe(a);
        expect(will).toHaveBeenCalledOnce();
        expect(sync).toHaveBeenCalledOnce();
        expect(first).toHaveBeenCalledOnce();
        expect(second).not.toHaveBeenCalled();
    });

    it("снятая подписка в прощании не участвует", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const will = vi.fn();
        const sync = vi.fn();
        lifecycle.onWillShutdown(will).dispose();
        lifecycle.onShutdownSync(sync).dispose();

        await lifecycle.shutdown("quit", () => undefined);

        expect(will).not.toHaveBeenCalled();
        expect(sync).not.toHaveBeenCalled();
    });

    it("requestShutdown дожидается промиса, который вернул onProceed", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const subprocess = deferred();
        let settled = false;

        const request = lifecycle
            .requestShutdown(() => subprocess.promise)
            .then(() => {
                settled = true;
            });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);

        subprocess.resolve();
        await request;
        expect(settled).toBe(true);
    });
});

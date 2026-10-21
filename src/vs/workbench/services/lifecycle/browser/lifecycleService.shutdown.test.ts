import { afterEach, describe, expect, it, vi } from "vitest";

import { DialogService } from "../../dialogs/browser/dialogService.ts";

import { LifecycleService, SHUTDOWN_JOIN_TIMEOUT_MS } from "./lifecycleService.ts";

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

describe("LifecycleService.shutdown: a single farewell", () => {
    it("first the async phase, then the sync one in reverse subscription order, `then` last", async () => {
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

    it("the sync phase waits for joined promises", async () => {
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

    it("a hung participant does not hold the exit longer than the overall timeout", async () => {
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

    it("the timeout is configurable via the constructor", async () => {
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

    it("participants that finish in time do not wait for the timeout: its timer is cleared", async () => {
        vi.useFakeTimers();
        const lifecycle = new LifecycleService(new DialogService());
        lifecycle.onWillShutdown((event) => {
            event.join(Promise.resolve());
        });

        await lifecycle.shutdown("quit", () => undefined);

        // A dangling timer would keep the process event loop alive after exit.
        expect(vi.getTimerCount()).toBe(0);
    });

    it("a rejected joined promise and a failing participant do not stop the others", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const sync = vi.fn();
        const then = vi.fn();
        lifecycle.onWillShutdown(() => {
            throw new Error("could not start");
        });
        lifecycle.onWillShutdown((event) => {
            event.join(Promise.reject(new Error("failed on the way")));
        });
        lifecycle.onShutdownSync(sync);
        lifecycle.onShutdownSync(() => {
            throw new Error("sync failure");
        });

        await lifecycle.shutdown("inspector", then);

        expect(sync).toHaveBeenCalledOnce();
        expect(then).toHaveBeenCalledOnce();
    });

    it("a repeated call joins the first farewell without repeating it", async () => {
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

    it("a removed subscription does not take part in the farewell", async () => {
        const lifecycle = new LifecycleService(new DialogService());
        const will = vi.fn();
        const sync = vi.fn();
        lifecycle.onWillShutdown(will).dispose();
        lifecycle.onShutdownSync(sync).dispose();

        await lifecycle.shutdown("quit", () => undefined);

        expect(will).not.toHaveBeenCalled();
        expect(sync).not.toHaveBeenCalled();
    });

    it("requestShutdown waits for the promise returned by onProceed", async () => {
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

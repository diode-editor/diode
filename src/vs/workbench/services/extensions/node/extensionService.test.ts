import { afterEach, describe, expect, it, vi } from "vitest";

import { enablePerformanceMarks, getMarks, resetPerformanceMarks } from "../../../../base/common/performance.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import type { IExtensionRegistrationEnv } from "./extensionRegistration.ts";
import type { IExtensionActivationHost } from "./extensionService.ts";
import { ExtensionService } from "./extensionService.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

function ext(id: string, main: string | undefined, isBuiltin = false): IExtension {
    return {
        id,
        isBuiltin,
        location: isBuiltin ? `extensions/${id}/` : `UserExtensions/${id}-1.0.0/`,
        manifest: { name: id, publisher: "acme", version: "1.0.0", engines: { vscode: "*" }, main },
    };
}

const ENV: IExtensionRegistrationEnv = {
    userPrefix: "UserExtensions/",
    userExtensionsDir: "/ext",
    readBuiltinSource: (virtualPath) =>
        virtualPath.includes("broken") ? Promise.reject(new Error("no such asset")) : Promise.resolve("// src"),
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

class FakeHost implements IExtensionActivationHost {
    public readonly log: string[] = [];
    public readonly held = new Map<string, Promise<void>>();
    public failOn: string | undefined;

    public registerExtension(reg: IExtensionRegistration): unknown {
        this.log.push(`register:${reg.id}`);
        return undefined;
    }

    public registerDeclarativeExtension(id: string): void {
        this.log.push(`declarative:${id}`);
    }

    public activateByEvent(event: string): Promise<void> {
        this.log.push(event);
        if (event === this.failOn) return Promise.reject(new Error("subprocess failed to start"));
        return this.held.get(event) ?? Promise.resolve();
    }

    public activateByWorkspaceContains(): Promise<void> {
        this.log.push("workspaceContains");
        if (this.failOn === "workspaceContains") return Promise.reject(new Error("scan failed"));
        return Promise.resolve();
    }

    public restartForWorkspaceChange(): Promise<void> {
        this.log.push("restart");
        return Promise.resolve();
    }
}

function recordingLogger(): ILogger & { errors: string[] } {
    const errors: string[] = [];
    const noop = (): void => undefined;
    return {
        errors,
        error: (message: string) => {
            errors.push(message);
        },
        warn: noop,
        info: noop,
        debug: noop,
        trace: noop,
        isEnabled: () => true,
    } as unknown as ILogger & { errors: string[] };
}

afterEach(() => {
    resetPerformanceMarks();
});

describe("ExtensionService", () => {
    it("registers the set in order, extensions without main as declarative (for extensionDependencies); * and workspaceContains in parallel, onStartupFinished after them", async () => {
        const host = new FakeHost();
        const logger = recordingLogger();
        const service = new ExtensionService(
            host,
            [ext("a", "a.js"), ext("decl", undefined), ext("git", "out/e.cjs", true)],
            ENV,
            logger,
        );

        await service.start();

        expect(host.log).toEqual([
            "register:a",
            "declarative:decl",
            "register:git",
            "*",
            "workspaceContains",
            "onStartupFinished",
        ]);
        expect(logger.errors).toEqual([]);
    });

    it("an event before registration is not lost: it replays right after *, and the waiter resolves at the barrier", async () => {
        const host = new FakeHost();
        const service = new ExtensionService(host, [ext("a", "a.js")], ENV, recordingLogger());
        let resolved = false;

        const early = service.activateByEvent("onLanguage:python").then(() => {
            resolved = true;
        });
        void service.activateByEvent("onLanguage:python");
        void service.activateByEvent("onLanguage:json");
        await Promise.resolve();
        expect(host.log).toEqual([]);
        expect(resolved).toBe(false);

        await service.start();
        await early;

        expect(host.log).toEqual([
            "register:a",
            "*",
            "workspaceContains",
            "onLanguage:python",
            "onLanguage:json",
            "onStartupFinished",
        ]);
    });

    it("the barrier opens before onStartupFinished: events during it go to the host immediately", async () => {
        const host = new FakeHost();
        const startupFinished = deferred();
        host.held.set("onStartupFinished", startupFinished.promise);
        const service = new ExtensionService(host, [], ENV, recordingLogger());
        let barrier = false;
        void service.whenInstalledExtensionsRegistered().then(() => {
            barrier = true;
        });

        const started = service.start();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(barrier).toBe(true);
        expect(host.log.at(-1)).toBe("onStartupFinished");

        await service.activateByEvent("onLanguage:go");
        await service.restartForWorkspaceChange();
        expect(host.log.slice(-2)).toEqual(["onLanguage:go", "restart"]);

        startupFinished.resolve();
        await started;
    });

    it("a workspace change before the barrier waits for startup instead of restarting the host itself", async () => {
        const host = new FakeHost();
        const service = new ExtensionService(host, [], ENV, recordingLogger());

        const early = service.restartForWorkspaceChange();
        await Promise.resolve();
        expect(host.log).toEqual([]);

        await service.start();
        await early;
        expect(host.log).not.toContain("restart");
        expect(host.log.filter((e) => e === "workspaceContains")).toHaveLength(1);
    });

    it("one registration failure is logged with the id, the rest still register", async () => {
        const host = new FakeHost();
        const logger = recordingLogger();
        const service = new ExtensionService(
            host,
            [ext("u", "u.js"), ext("broken", "out/e.cjs", true), ext("ok", "out/e.cjs", true)],
            ENV,
            logger,
        );

        await service.start();

        expect(host.log.slice(0, 2)).toEqual(["register:u", "register:ok"]);
        expect(logger.errors).toEqual(["broken: failed to register (builtin)"]);
    });

    it("a user extension registration failure is logged without the builtin mark", async () => {
        const host = new FakeHost();
        host.registerExtension = (): unknown => {
            throw new Error("already registered");
        };
        const logger = recordingLogger();
        const service = new ExtensionService(host, [ext("u", "u.js")], ENV, logger);

        await service.start();

        expect(logger.errors).toEqual(["u: failed to register"]);
    });

    it("a host failure on an event is logged with the event, the other startup events still go, the barrier opens", async () => {
        const host = new FakeHost();
        host.failOn = "*";
        const logger = recordingLogger();
        const service = new ExtensionService(host, [], ENV, logger);
        const early = service.activateByEvent("onLanguage:ts");

        await service.start();
        await early;

        expect(logger.errors).toEqual(["extension host activation failed (*)"]);
        expect(host.log).toEqual(["*", "workspaceContains", "onLanguage:ts", "onStartupFinished"]);
        await service.activateByEvent("onLanguage:rust");
        expect(host.log.at(-1)).toBe("onLanguage:rust");
    });

    it.each(["workspaceContains", "onStartupFinished"])(
        "a host failure on %s is logged with that event, and startup runs to the end",
        async (event) => {
            const host = new FakeHost();
            host.failOn = event;
            const logger = recordingLogger();
            const service = new ExtensionService(host, [], ENV, logger);

            await service.start();

            expect(logger.errors).toEqual([`extension host activation failed (${event})`]);
            expect(host.log).toEqual(["*", "workspaceContains", "onStartupFinished"]);
        },
    );

    it("a hung * does not hold onStartupFinished past the timeout", async () => {
        const host = new FakeHost();
        const eager = deferred();
        host.held.set("*", eager.promise);
        const service = new ExtensionService(host, [], ENV, recordingLogger(), 20);

        const started = service.start();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(host.log).not.toContain("onStartupFinished");
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(host.log).toContain("onStartupFinished");

        let done = false;
        void started.then(() => {
            done = true;
        });
        await Promise.resolve();
        expect(done).toBe(false);
        eager.resolve();
        await started;
    });

    it("an eager activation that finishes in time does not wait for the timeout: its timer is cleared", async () => {
        vi.useFakeTimers();
        try {
            const service = new ExtensionService(new FakeHost(), [], ENV, recordingLogger());

            await service.start();

            // A dangling 10-second timer would keep the process event loop alive.
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("sets the registration and activation marks the bench reads", async () => {
        enablePerformanceMarks();
        const service = new ExtensionService(new FakeHost(), [], ENV, recordingLogger());

        await service.start();

        expect(getMarks().map((m) => m.name)).toEqual(["main:extensions-registered", "exthost:activated"]);
    });

    it("returns the set and an extension by id", () => {
        const a = ext("a", "a.js");
        const service = new ExtensionService(new FakeHost(), [a], ENV, recordingLogger());

        expect(service.extensions).toEqual([a]);
        expect(service.getExtension("a")).toBe(a);
        expect(service.getExtension("missing")).toBeUndefined();
    });
});

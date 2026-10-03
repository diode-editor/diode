import { afterEach, describe, expect, it } from "vitest";

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
    configInjection: () => ({}),
};

/** Промис, который резолвит тест, — «активация ещё идёт». */
function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/** Host, который записывает регистрации и события; отдельные события можно придержать. */
class FakeHost implements IExtensionActivationHost {
    public readonly log: string[] = [];
    public readonly held = new Map<string, Promise<void>>();
    public failOn: string | undefined;

    public registerExtension(reg: IExtensionRegistration): unknown {
        this.log.push(`register:${reg.id}`);
        return undefined;
    }

    public activateByEvent(event: string): Promise<void> {
        this.log.push(event);
        if (event === this.failOn) return Promise.reject(new Error("subprocess failed to start"));
        return this.held.get(event) ?? Promise.resolve();
    }

    public activateByWorkspaceContains(): Promise<void> {
        this.log.push("workspaceContains");
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
    it("регистрирует набор по порядку, пропуская расширения без main, и стартует *, onStartupFinished, workspaceContains", async () => {
        const host = new FakeHost();
        const logger = recordingLogger();
        const service = new ExtensionService(
            host,
            [ext("a", "a.js"), ext("decl", undefined), ext("git", "out/e.cjs", true)],
            ENV,
            logger,
        );

        await service.start();

        expect(host.log).toEqual(["register:a", "register:git", "*", "onStartupFinished", "workspaceContains"]);
        // Декларативное пропущено молча, а не «упало при регистрации».
        expect(logger.errors).toEqual([]);
    });

    it("событие до регистрации не теряется: проигрывается сразу за *, а ждущий резолвится на барьере", async () => {
        const host = new FakeHost();
        const service = new ExtensionService(host, [ext("a", "a.js")], ENV, recordingLogger());
        let resolved = false;

        const early = service.activateByEvent("onLanguage:python").then(() => {
            resolved = true;
        });
        // Повтор того же события до барьера — один проигрыш.
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
            "onLanguage:python",
            "onLanguage:json",
            "onStartupFinished",
            "workspaceContains",
        ]);
    });

    it("барьер открывается до onStartupFinished: события во время него идут в host сразу", async () => {
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
        await service.activateByWorkspaceContains();
        expect(host.log.slice(-2)).toEqual(["onLanguage:go", "workspaceContains"]);

        startupFinished.resolve();
        await started;
    });

    it("проход workspaceContains до барьера ждёт старт, а не идёт в host сам", async () => {
        const host = new FakeHost();
        const service = new ExtensionService(host, [], ENV, recordingLogger());

        const early = service.activateByWorkspaceContains();
        await Promise.resolve();
        expect(host.log).toEqual([]);

        await service.start();
        await early;
        // Один проход — стартовый.
        expect(host.log.filter((e) => e === "workspaceContains")).toHaveLength(1);
    });

    it("сбой регистрации одного — в лог с id, остальные регистрируются", async () => {
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

    it("сбой регистрации пользовательского — в лог без пометки builtin", async () => {
        const host = new FakeHost();
        host.registerExtension = (): unknown => {
            throw new Error("already registered");
        };
        const logger = recordingLogger();
        const service = new ExtensionService(host, [ext("u", "u.js")], ENV, logger);

        await service.start();

        expect(logger.errors).toEqual(["u: failed to register"]);
    });

    it("сбой host'а — в лог; барьер всё равно открывается, ждущие не виснут, дальше события идут в host", async () => {
        const host = new FakeHost();
        host.failOn = "*";
        const logger = recordingLogger();
        const service = new ExtensionService(host, [], ENV, logger);
        const early = service.activateByEvent("onLanguage:ts");

        await service.start();
        await early;

        expect(logger.errors).toEqual(["extension host activation failed"]);
        expect(host.log).toEqual(["*"]);
        await service.activateByEvent("onLanguage:rust");
        expect(host.log).toEqual(["*", "onLanguage:rust"]);
    });

    it("ставит вехи регистрации и активации, которые читает бенч", async () => {
        enablePerformanceMarks();
        const service = new ExtensionService(new FakeHost(), [], ENV, recordingLogger());

        await service.start();

        expect(getMarks().map((m) => m.name)).toEqual(["main:extensions-registered", "exthost:activated"]);
    });

    it("отдаёт набор и расширение по id", () => {
        const a = ext("a", "a.js");
        const service = new ExtensionService(new FakeHost(), [a], ENV, recordingLogger());

        expect(service.extensions).toEqual([a]);
        expect(service.getExtension("a")).toBe(a);
        expect(service.getExtension("missing")).toBeUndefined();
    });
});

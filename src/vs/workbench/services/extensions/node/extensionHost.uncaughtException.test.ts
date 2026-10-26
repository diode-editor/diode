import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createLoggerSpy, type LoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

import { reportUncaughtException } from "./extensionHostSubprocess.ts";

const DEATH_WARNING = "extension host subprocess died — resetting host state";

const harnesses: IExtensionHarness[] = [];

afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.dispose();
    vi.restoreAllMocks();
});

function lines(logger: LoggerSpy, level: "info" | "warn" | "error"): string[] {
    return vi.mocked(logger[level]).mock.calls.map((call: unknown[]) => String(call[0]));
}

describe("uncaught exception in extension code — through the subprocess", () => {
    it("is logged to stderr with the stack, the subprocess and the other extensions live on", async () => {
        const logger = createLoggerSpy();
        const stderrLogger = createLoggerSpy();
        const harness = await createExtensionTestHarness({
            extensions: [
                extensionFixture("test.thrower", "throwsFromTimer.cjs"),
                extensionFixture("test.bystander", "noopExtension.cjs"),
            ],
            logger,
            stderrLogger,
        });
        harnesses.push(harness);

        // Under Stryker instrumentation the subprocess takes longer than the default one-second poll.
        await expect
            .poll(() => lines(stderrLogger, "warn"), { timeout: 10_000 })
            .toContain("[ext-host] uncaught exception in extension code: Error: boom");
        // Room for the host to notice an exit, were there one.
        await settle(200);

        // stderr arrives line by line: the stack frames follow, pointing at the culprit.
        expect(lines(stderrLogger, "warn").some((line) => line.includes("throwsFromTimer.cjs"))).toBe(true);
        expect(await harness.commandRegistry.execute("test.alive")).toBe("alive");
        expect(lines(logger, "warn")).not.toContain(DEATH_WARNING);
        expect(lines(logger, "info").filter((line) => line.startsWith("activated extension"))).toEqual([
            expect.stringMatching(/^activated extension "test\.thrower"/),
            expect.stringMatching(/^activated extension "test\.bystander"/),
        ]);
    }, 20_000);

    it("a throw inside activate() keeps its own path and is not reported as uncaught", async () => {
        const logger = createLoggerSpy();
        const stderrLogger = createLoggerSpy();
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.broken", "throwsOnActivate.cjs")],
            logger,
            stderrLogger,
        });
        harnesses.push(harness);

        await expect
            .poll(() => harness.host.hasExtension("test.broken") || lines(logger, "error").length > 0, {
                timeout: 10_000,
            })
            .toBe(true);

        expect(harness.host.hasExtension("test.broken")).toBe(false);
        expect(lines(stderrLogger, "warn").filter((line) => line.includes("uncaught exception"))).toEqual([]);
    }, 20_000);
});

describe("reportUncaughtException", () => {
    it("writes the stack with the [ext-host] prefix", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const error = new TypeError("Class constructor ThemeColor cannot be invoked without 'new'");

        reportUncaughtException(error);

        expect(spy).toHaveBeenCalledExactlyOnceWith(`[ext-host] uncaught exception in extension code: ${error.stack}`);
    });

    it("a non-Error value is written as a string", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        reportUncaughtException("plain");

        expect(spy).toHaveBeenCalledExactlyOnceWith("[ext-host] uncaught exception in extension code: plain");
    });

    it("EPIPE on a write is dropped: there is nowhere to write it", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        reportUncaughtException(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }));

        expect(spy).not.toHaveBeenCalled();
    });
});

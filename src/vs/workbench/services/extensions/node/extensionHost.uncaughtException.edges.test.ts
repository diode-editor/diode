import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createLoggerSpy, type LoggerSpy } from "../../../../../TestUtils/themeExtensionFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

const DEATH_WARNING = "extension host subprocess died — resetting host state";
const PREFIX = "[ext-host] uncaught exception in extension code: ";

const harnesses: IExtensionHarness[] = [];

afterEach(async () => {
    for (const harness of harnesses.splice(0)) await harness.dispose();
    vi.restoreAllMocks();
});

function lines(logger: LoggerSpy, level: "info" | "warn" | "error"): string[] {
    return vi.mocked(logger[level]).mock.calls.map((call: unknown[]) => String(call[0]));
}

async function startWith(
    fixture: string,
): Promise<{ logger: LoggerSpy; stderrLogger: LoggerSpy; harness: IExtensionHarness }> {
    const logger = createLoggerSpy();
    const stderrLogger = createLoggerSpy();
    const harness = await createExtensionTestHarness({
        extensions: [extensionFixture("test.thrower", fixture)],
        logger,
        stderrLogger,
    });
    harnesses.push(harness);
    return { logger, stderrLogger, harness };
}

describe("uncaught exception in extension code — awkward thrown values (#861)", () => {
    it("plain values, ticks, immediates and a burst of 50 throws are all logged, the subprocess lives on", async () => {
        const { logger, stderrLogger, harness } = await startWith("throwsOddValues.cjs");

        await expect.poll(() => lines(stderrLogger, "warn"), { timeout: 10_000 }).toContain(`${PREFIX}Error: burst-50`);
        // Room for the host to notice an exit, were there one.
        await settle(200);

        const stderr = lines(stderrLogger, "warn");
        const uncaught = stderr.filter((line) => line.startsWith(PREFIX));
        expect(lines(logger, "warn")).not.toContain(DEATH_WARNING);
        expect(await harness.commandRegistry.execute("test.alive")).toBe("alive");
        expect(uncaught).toEqual(
            expect.arrayContaining([
                `${PREFIX}plain-string`,
                `${PREFIX}42`,
                `${PREFIX}undefined`,
                `${PREFIX}null`,
                `${PREFIX}Error: from-immediate`,
                `${PREFIX}Error: from-next-tick`,
                `${PREFIX}Error: юникод 🚀`,
                // EPIPE is dropped only on a write; a read EPIPE is an ordinary error.
                `${PREFIX}Error: read EPIPE`,
            ]),
        );
        expect(stderr).toContain("second line");
        expect(
            uncaught.filter((line) =>
                /^\[ext-host\] uncaught exception in extension code: Error: burst-\d+$/.test(line),
            ),
        ).toHaveLength(50);
    }, 20_000);

    it("a thrown object without a prototype does not take the subprocess down", async () => {
        const { logger, stderrLogger, harness } = await startWith("throwsNullPrototype.cjs");

        await expect
            .poll(
                () =>
                    lines(stderrLogger, "warn").some((line) => line.startsWith(PREFIX)) ||
                    lines(logger, "warn").includes(DEATH_WARNING),
                { timeout: 10_000 },
            )
            .toBe(true);
        // Room for the host to notice an exit, were there one.
        await settle(500);

        expect(lines(logger, "warn")).not.toContain(DEATH_WARNING);
        expect(await harness.commandRegistry.execute("test.alive")).toBe("alive");
    }, 20_000);

    it("an Error whose stack getter throws does not take the subprocess down", async () => {
        const { logger, stderrLogger, harness } = await startWith("throwsBadStack.cjs");

        await expect
            .poll(
                () =>
                    lines(stderrLogger, "warn").some((line) => line.startsWith(PREFIX)) ||
                    lines(logger, "warn").includes(DEATH_WARNING),
                { timeout: 10_000 },
            )
            .toBe(true);
        // Room for the host to notice an exit, were there one.
        await settle(500);

        expect(lines(logger, "warn")).not.toContain(DEATH_WARNING);
        expect(await harness.commandRegistry.execute("test.alive")).toBe("alive");
    }, 20_000);
});

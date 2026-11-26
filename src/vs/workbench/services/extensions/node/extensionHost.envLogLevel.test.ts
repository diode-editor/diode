import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";
import { LogService } from "../../../../platform/log/common/logService.ts";
import { LogLevel as ApiLogLevel } from "../../../api/common/vscodeTypes.ts";

import { fallbackExtensionHostEnvironment } from "./customers/envCustomer.ts";

interface LogLevelState {
    readonly atActivate: ApiLogLevel;
    readonly current: ApiLogLevel;
    readonly events: readonly { level: ApiLogLevel; getter: ApiLogLevel }[];
}

/** The window level comes from a real LogService, as in production: `--log` rules land there before the host starts. */
async function start(logService: LogService) {
    const harness = await createExtensionTestHarness({
        extensions: [extensionFixture("test.logLevel", "envLogLevel.cjs")],
        environment: {
            ...fallbackExtensionHostEnvironment(),
            logLevel: () => logService.getWindowLevel(),
            onDidChangeLogLevel: logService.onDidChangeWindowLevel,
        },
    });
    const state = async (): Promise<LogLevelState> =>
        (await harness.commandRegistry.execute("test.logLevel.state")) as LogLevelState;
    return { harness, state };
}

describe("ExtensionHost — env.logLevel (subprocess)", () => {
    it("without arguments the extension sees upstream's Info, though our own channels log at Trace", async () => {
        const logService = new LogService();
        const { harness, state } = await start(logService);
        try {
            expect(await state()).toEqual({ atActivate: ApiLogLevel.Info, current: ApiLogLevel.Info, events: [] });
            expect(logService.getLevel("extensions.host")).toBe(LogLevel.Trace);
        } finally {
            await harness.dispose();
        }
    }, 20_000);

    it("`--log debug` is seen already in activate(); `--log <channel>:<level>` is not", async () => {
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Debug);
        logService.setLevel("extensions.host", LogLevel.Error);
        const { harness, state } = await start(logService);
        try {
            expect(await state()).toMatchObject({ atActivate: ApiLogLevel.Debug, events: [] });
        } finally {
            await harness.dispose();
        }
    }, 20_000);

    it("a window level change fires once with the getter already updated; the same level again — silence", async () => {
        const logService = new LogService();
        const { harness, state } = await start(logService);
        try {
            logService.setLevel("*", LogLevel.Trace);
            logService.setLevel("*", LogLevel.Trace);
            logService.setLevel("extensions", LogLevel.Error);
            logService.setLevel("*", LogLevel.Off);
            await vi.waitFor(async () => {
                expect((await state()).events).toHaveLength(2);
            });
            expect(await state()).toEqual({
                atActivate: ApiLogLevel.Info,
                current: ApiLogLevel.Off,
                events: [
                    { level: ApiLogLevel.Trace, getter: ApiLogLevel.Trace },
                    { level: ApiLogLevel.Off, getter: ApiLogLevel.Off },
                ],
            });
        } finally {
            await harness.dispose();
        }
    }, 20_000);
});

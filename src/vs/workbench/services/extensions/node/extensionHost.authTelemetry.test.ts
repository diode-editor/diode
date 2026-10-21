import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IOutputSink } from "../../../../workbench/api/common/iExtensionWindowSinks.ts";

/**
 * Форма `hashicorp.terraform`: `env.createTelemetryLogger` и сессия входа
 * запрашиваются ещё до старта языкового сервера — без них терялось всё расширение.
 */
describe("ExtensionHost — расширение с телеметрией и провайдером входа активируется целиком", () => {
    it("activate() доходит до команды; сессий нет, вход отклоняется с причиной, телеметрия не уходит", async () => {
        const output: { channel: string; level: string; value: string }[] = [];
        const outputSink: IOutputSink = {
            append: (channel, _label, level, value) => {
                output.push({ channel, level, value });
            },
            show: () => undefined,
        };
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.authTelemetry", "authTelemetryExtension.cjs")],
            outputSink,
        });
        try {
            await settle();
            expect(harness.host.hasExtension("test.authTelemetry")).toBe(true);
            expect(await harness.commandRegistry.execute("test.authTelemetry")).toEqual({
                session: "none",
                usageEnabled: false,
                sent: [],
                login: 'вход через "test.cloud" в TUI пока не поддержан',
            });
            expect(output).toEqual([
                {
                    channel: "extensions",
                    level: "warn",
                    value: expect.stringMatching(
                        /^вход через "Test Cloud" \(test\.cloud\) в TUI пока не поддержан/,
                    ) as unknown as string,
                },
            ]);
        } finally {
            await harness.dispose();
        }
    });
});

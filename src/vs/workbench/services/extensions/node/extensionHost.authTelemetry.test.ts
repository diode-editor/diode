import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import type { IOutputSink } from "../../../../workbench/api/common/iExtensionWindowSinks.ts";

/**
 * The `hashicorp.terraform` shape: `env.createTelemetryLogger` and the sign-in session
 * are requested before the language server starts; without them the whole extension was lost.
 */
describe("ExtensionHost — an extension with telemetry and an auth provider activates fully", () => {
    it("activate() reaches the command; no sessions, sign-in is rejected with a reason, no telemetry is sent", async () => {
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
                login: 'sign-in with "test.cloud" is not supported in TUI yet',
            });
            expect(output).toEqual([
                {
                    channel: "extensions",
                    level: "warn",
                    value: expect.stringMatching(
                        /^sign-in with "Test Cloud" \(test\.cloud\) is not supported in TUI yet/,
                    ) as unknown as string,
                },
            ]);
        } finally {
            await harness.dispose();
        }
    });
});

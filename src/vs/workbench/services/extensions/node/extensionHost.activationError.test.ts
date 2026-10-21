import { describe, expect, it } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import type { ILogSink } from "../../../../platform/log/common/iLogService.ts";
import { LogService } from "../../../../platform/log/common/logService.ts";
import { RingBufferSink } from "../../../../platform/log/common/ringBufferSink.ts";
import { formatOutputLine } from "../../../services/output/common/outputService.ts";

/**
 * Lesson from golang.go: without `go` on PATH it rejects `activate()` with a bare `undefined`,
 * and the log ended up with `{"name":"Error","message":"undefined"}`.
 */
async function activationFailureLine(activateBody: string): Promise<string> {
    const logService = new LogService();
    const history = new RingBufferSink();
    logService.addSink(history as ILogSink);
    const harness = await createExtensionTestHarness({
        logger: logService.createLogger("extensions.host"),
        extensions: [
            {
                id: "test.failing",
                manifest: { name: "failing", publisher: "test", version: "0.0.1" },
                source: `exports.activate = async function activate() { ${activateBody} };`,
                filename: "/diode/builtin/test.failing/out/extension.cjs",
            },
        ],
    });
    try {
        const line = history
            .getEntries("extensions.host")
            .map(formatOutputLine)
            .find((text) => text.includes("failed to activate extension"));
        expect(line).toBeDefined();
        return line ?? "";
    } finally {
        await harness.dispose();
    }
}

describe("ExtensionHost — activation rejection log", () => {
    it("a rejection with a non-Error value prints the value itself", async () => {
        const line = await activationFailureLine("return Promise.reject(undefined);");
        expect(line).toContain(
            'failed to activate extension "test.failing" activate() rejected with a non-Error value: undefined',
        );
        expect(line).not.toContain("$isError");
        expect(line).not.toContain('"name"');
    });

    it("a string rejection prints as text too", async () => {
        const line = await activationFailureLine('throw "no go binary";');
        expect(line).toContain("activate() rejected with a non-Error value: no go binary");
    });

    it("a rejection with a real Error prints its message, not JSON", async () => {
        const line = await activationFailureLine('throw new Error("boom");');
        expect(line).toMatch(/failed to activate extension "test\.failing" boom$/);
    });
});

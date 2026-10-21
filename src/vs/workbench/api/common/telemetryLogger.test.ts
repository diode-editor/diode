import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { createTelemetryLogger } from "./telemetryLogger.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

function makeSender(overrides: Partial<vscode.TelemetrySender> = {}) {
    return {
        sendEventData: vi.fn<vscode.TelemetrySender["sendEventData"]>(),
        sendErrorData: vi.fn<vscode.TelemetrySender["sendErrorData"]>(),
        flush: vi.fn<NonNullable<vscode.TelemetrySender["flush"]>>(),
        ...overrides,
    };
}

describe("env.createTelemetryLogger — telemetry is permanently off", () => {
    it("is available on `vscode.env`, the @vscode/extension-telemetry reporter builds it in its constructor", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        const logger = namespace.env.createTelemetryLogger(makeSender());
        expect(logger.isUsageEnabled).toBe(false);
    });

    it("usage/errors flags are false, like `env.isTelemetryEnabled`", () => {
        const logger = createTelemetryLogger(makeSender());
        expect(logger.isUsageEnabled).toBe(false);
        expect(logger.isErrorsEnabled).toBe(false);
    });

    it("logUsage/logError do not reach the sender", () => {
        const sender = makeSender();
        const logger = createTelemetryLogger(sender);

        logger.logUsage("activated", { a: 1 });
        logger.logError("failed", { b: 2 });
        logger.logError(new Error("boom"));

        expect(sender.sendEventData).not.toHaveBeenCalled();
        expect(sender.sendErrorData).not.toHaveBeenCalled();
    });

    it("onDidChangeEnableStates is a valid event, subscribing and unsubscribing do not throw", () => {
        const logger = createTelemetryLogger(makeSender());
        const listener = vi.fn();
        const sub = logger.onDidChangeEnableStates(listener);
        sub.dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("dispose flushes the sender buffer exactly once", () => {
        const sender = makeSender();
        const logger = createTelemetryLogger(sender);

        logger.dispose();
        logger.dispose();

        expect(sender.flush).toHaveBeenCalledTimes(1);
    });

    it("dispose does not throw when the sender has no `flush`", () => {
        const { flush: _flush, ...withoutFlush } = makeSender();
        const logger = createTelemetryLogger(withoutFlush);
        expect(() => {
            logger.dispose();
        }).not.toThrow();
    });

    it("a `flush` rejection does not become an unhandled rejection", async () => {
        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            const logger = createTelemetryLogger(makeSender({ flush: () => Promise.reject(new Error("offline")) }));
            logger.dispose();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });

    it("the API object is frozen, as upstream", () => {
        expect(Object.isFrozen(createTelemetryLogger(makeSender()))).toBe(true);
    });

    describe("sender validation — upstream messages", () => {
        it.each([
            ["not an object", "sender" as unknown, "TelemetrySender argument is invalid"],
            // `typeof null === "object"` — null passes the first check.
            ["null", null as unknown, "TelemetrySender.sendEventData must be a function"],
            [
                "without sendEventData",
                { sendErrorData: () => undefined } as unknown,
                "TelemetrySender.sendEventData must be a function",
            ],
            [
                "without sendErrorData",
                { sendEventData: () => undefined } as unknown,
                "TelemetrySender.sendErrorData must be a function",
            ],
            [
                "flush is not a function",
                { sendEventData: () => undefined, sendErrorData: () => undefined, flush: 1 } as unknown,
                "TelemetrySender.flush must be a function or undefined",
            ],
        ])("%s → TypeError", (_case, sender, message) => {
            expect(() => createTelemetryLogger(sender as vscode.TelemetrySender)).toThrow(new TypeError(message));
        });
    });
});

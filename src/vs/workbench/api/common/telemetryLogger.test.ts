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

describe("env.createTelemetryLogger — телеметрия выключена навсегда", () => {
    it("доступен в `vscode.env` — репортер @vscode/extension-telemetry строит его в конструкторе", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        const logger = namespace.env.createTelemetryLogger(makeSender());
        expect(logger.isUsageEnabled).toBe(false);
    });

    it("флаги usage/errors — false, как `env.isTelemetryEnabled`", () => {
        const logger = createTelemetryLogger(makeSender());
        expect(logger.isUsageEnabled).toBe(false);
        expect(logger.isErrorsEnabled).toBe(false);
    });

    it("logUsage/logError не доходят до отправителя", () => {
        const sender = makeSender();
        const logger = createTelemetryLogger(sender);

        logger.logUsage("activated", { a: 1 });
        logger.logError("failed", { b: 2 });
        logger.logError(new Error("boom"));

        expect(sender.sendEventData).not.toHaveBeenCalled();
        expect(sender.sendErrorData).not.toHaveBeenCalled();
    });

    it("onDidChangeEnableStates — валидное событие, подписка и отписка не падают", () => {
        const logger = createTelemetryLogger(makeSender());
        const listener = vi.fn();
        const sub = logger.onDidChangeEnableStates(listener);
        sub.dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("dispose сбрасывает буфер отправителя ровно один раз", () => {
        const sender = makeSender();
        const logger = createTelemetryLogger(sender);

        logger.dispose();
        logger.dispose();

        expect(sender.flush).toHaveBeenCalledTimes(1);
    });

    it("dispose без `flush` у отправителя не падает", () => {
        const { flush: _flush, ...withoutFlush } = makeSender();
        const logger = createTelemetryLogger(withoutFlush);
        expect(() => {
            logger.dispose();
        }).not.toThrow();
    });

    it("отказ `flush` не уходит в unhandled rejection", async () => {
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

    it("API-объект заморожен, как в эталоне", () => {
        expect(Object.isFrozen(createTelemetryLogger(makeSender()))).toBe(true);
    });

    describe("проверка отправителя — тексты эталона", () => {
        it.each([
            ["не объект", "sender" as unknown, "TelemetrySender argument is invalid"],
            // `typeof null === "object"` — первую проверку null проходит.
            ["null", null as unknown, "TelemetrySender.sendEventData must be a function"],
            [
                "без sendEventData",
                { sendErrorData: () => undefined } as unknown,
                "TelemetrySender.sendEventData must be a function",
            ],
            [
                "без sendErrorData",
                { sendEventData: () => undefined } as unknown,
                "TelemetrySender.sendErrorData must be a function",
            ],
            [
                "flush — не функция",
                { sendEventData: () => undefined, sendErrorData: () => undefined, flush: 1 } as unknown,
                "TelemetrySender.flush must be a function or undefined",
            ],
        ])("%s → TypeError", (_case, sender, message) => {
            expect(() => createTelemetryLogger(sender as vscode.TelemetrySender)).toThrow(new TypeError(message));
        });
    });
});

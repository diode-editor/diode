import { describe, expect, it } from "vitest";

import { LogLevel } from "./logLevel.ts";
import { NULL_LOG_SERVICE } from "./nullLogService.ts";

describe("NULL_LOG_SERVICE", () => {
    it("createLogger returns a logger that is never enabled", () => {
        const logger = NULL_LOG_SERVICE.createLogger("x");
        expect(logger.isEnabled(LogLevel.Error)).toBe(false);
        expect(logger.isEnabled(LogLevel.Trace)).toBe(false);
    });

    it("logger methods are no-ops and do not throw", () => {
        const logger = NULL_LOG_SERVICE.createLogger("x");
        expect(() => {
            logger.trace("t");
            logger.debug("d");
            logger.info("i");
            logger.warn("w");
            logger.error("e", new Error("x"));
        }).not.toThrow();
    });

    it("getLevel returns Off", () => {
        expect(NULL_LOG_SERVICE.getLevel("any")).toBe(LogLevel.Off);
    });

    it("addSink returns a disposable no-op", () => {
        const sub = NULL_LOG_SERVICE.addSink({ append: () => {}, dispose: () => {} });
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });

    it("метки каналов не хранит", () => {
        NULL_LOG_SERVICE.createLogger("x", { label: "X" });
        const sub = NULL_LOG_SERVICE.onDidRegisterChannel(() => {});

        expect(NULL_LOG_SERVICE.getRegisteredChannels()).toEqual([]);
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });

    it("onDidAppend returns a disposable no-op", () => {
        const sub = NULL_LOG_SERVICE.onDidAppend(() => {});
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });
});

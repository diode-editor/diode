import { describe, expect, it, vi } from "vitest";

import { LogLevel } from "../../../../platform/log/common/logLevel.ts";

import { createStderrLogger } from "./stderrLogger.ts";

describe("createStderrLogger", () => {
    it("warn и error — строкой с префиксом, аргументы через «: », ошибка со стеком", () => {
        const lines: string[] = [];
        const logger = createStderrLogger((line) => lines.push(line));
        const error = new Error("boom");
        logger.warn("request failed", error);
        logger.error("plain", "detail", 42);
        logger.warn("bare");
        expect(lines).toEqual([
            `[ext-host] request failed: ${String(error.stack)}`,
            "[ext-host] plain: detail: 42",
            "[ext-host] bare",
        ]);
    });

    it("trace/debug/info молчат; включены только warn и выше", () => {
        const lines: string[] = [];
        const logger = createStderrLogger((line) => lines.push(line));
        logger.trace("t");
        logger.debug("d");
        logger.info("i");
        expect(lines).toEqual([]);
        expect(
            [LogLevel.Trace, LogLevel.Debug, LogLevel.Info, LogLevel.Warn, LogLevel.Error].map((l) =>
                logger.isEnabled(l),
            ),
        ).toEqual([false, false, false, true, true]);
    });

    it("по умолчанию пишет в stderr (console.error)", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            createStderrLogger().warn("x");
            expect(spy).toHaveBeenCalledWith("[ext-host] x");
        } finally {
            spy.mockRestore();
        }
    });
});

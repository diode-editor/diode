import { afterEach, describe, expect, it, vi } from "vitest";

import { onUnexpectedError, setUnexpectedErrorHandler } from "./errors.ts";

/**
 * Шим `base/common/errors`: обработчик непредвиденных ошибок. Дефолт у нас —
 * запись в консоль (upstream перебрасывает через setTimeout и роняет процесс);
 * обоснование отклонения — в шапке errors.ts.
 */

afterEach(() => {
    setUnexpectedErrorHandler((e) => {
        console.error(e);
    });
});

describe("onUnexpectedError", () => {
    it("по умолчанию пишет в консоль и не бросает", async () => {
        // Общий setupFiles ставит свой обработчик на каждый тест — дефолт
        // видно только у свежего экземпляра модуля.
        vi.resetModules();
        const fresh = await import("./errors.ts");
        const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const error = new Error("бум");
            expect(() => {
                fresh.onUnexpectedError(error);
            }).not.toThrow();
            expect(spy).toHaveBeenCalledWith(error);
        } finally {
            spy.mockRestore();
        }
    });

    it("зовёт установленный обработчик вместо дефолтного", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        const error = new Error("свой");
        onUnexpectedError(error);
        expect(handler).toHaveBeenCalledExactlyOnceWith(error);
    });
});

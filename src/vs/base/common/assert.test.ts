import { afterEach, describe, expect, it, vi } from "vitest";

import { assert, assertFn, checkAdjacentItems } from "./assert.ts";
import { BugIndicatingError, setUnexpectedErrorHandler } from "./errors.ts";

/** Deviation from upstream: `assertFn` doesn't throw but goes to the error handler, otherwise the TUI wouldn't survive an edge-case diff. */

afterEach(() => {
    setUnexpectedErrorHandler((e) => {
        console.error(e);
    });
});

describe("assert", () => {
    it("на истинном условии молчит", () => {
        expect(() => {
            assert(true);
        }).not.toThrow();
    });

    it("на ложном бросает BugIndicatingError с сообщением по умолчанию", () => {
        expect(() => {
            assert(false);
        }).toThrow(/Assertion Failed: unexpected state/);
        expect(() => {
            assert(false);
        }).toThrow(BugIndicatingError);
    });

    it("подставляет переданное сообщение", () => {
        expect(() => {
            assert(false, "всё плохо");
        }).toThrow(/Assertion Failed: всё плохо/);
    });

    it("пробрасывает переданный экземпляр ошибки как есть", () => {
        const error = new Error("свой");
        expect(() => {
            assert(false, error);
        }).toThrow(error);
    });
});

describe("assertFn", () => {
    it("на истинном условии не зовёт обработчик", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        assertFn(() => true);
        expect(handler).not.toHaveBeenCalled();
    });

    it("на ложном уходит в обработчик, а не бросает", () => {
        const handler = vi.fn();
        setUnexpectedErrorHandler(handler);
        expect(() => {
            assertFn(() => false);
        }).not.toThrow();
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toBeInstanceOf(BugIndicatingError);
    });

    it("тест может сделать поведение строгим — так работает фикстурный корпус", () => {
        setUnexpectedErrorHandler((e) => {
            throw e instanceof Error ? e : new Error(String(e));
        });
        expect(() => {
            assertFn(() => false);
        }).toThrow(BugIndicatingError);
    });
});

describe("checkAdjacentItems", () => {
    it("пустой массив и массив из одного элемента проходят", () => {
        expect(checkAdjacentItems([], () => false)).toBe(true);
        expect(checkAdjacentItems([1], () => false)).toBe(true);
    });

    it("истинно, когда предикат держится на всех парах", () => {
        expect(checkAdjacentItems([1, 2, 3], (a, b) => a < b)).toBe(true);
    });

    it("ложно, когда предикат ломается хоть на одной паре", () => {
        expect(checkAdjacentItems([1, 3, 2], (a, b) => a < b)).toBe(false);
    });
});

describe("BugIndicatingError", () => {
    it("instanceof работает после setPrototypeOf", () => {
        expect(new BugIndicatingError("x")).toBeInstanceOf(BugIndicatingError);
        expect(new BugIndicatingError("x")).toBeInstanceOf(Error);
    });

    it("без сообщения подставляет дефолтное", () => {
        expect(new BugIndicatingError().message).toBe("An unexpected bug occurred.");
        expect(new BugIndicatingError("своё").message).toBe("своё");
    });
});

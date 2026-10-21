import { describe, expect, it } from "vitest";

import {
    canceledName,
    CancellationError,
    isCancellationError,
    transformErrorForSerialization,
    transformErrorFromSerialization,
} from "./errorSerialization.ts";

describe("error serialization across a process boundary", () => {
    it("name, message, stack, code and the cause chain survive the round trip", () => {
        const cause = Object.assign(new Error("root"), { code: 42 });
        const error = Object.assign(new RangeError("top", { cause }), { code: "EFOO" });
        const wire = transformErrorForSerialization(error);
        expect(JSON.parse(JSON.stringify(wire))).toEqual({
            $isError: true,
            name: "RangeError",
            message: "top",
            stack: error.stack,
            code: "EFOO",
            cause: { $isError: true, name: "Error", message: "root", stack: cause.stack, code: 42 },
        });

        const back = transformErrorFromSerialization(wire);
        expect(back).toBeInstanceOf(Error);
        expect(back).toMatchObject({ name: "RangeError", message: "top", stack: error.stack, code: "EFOO" });
        expect(back.cause).toMatchObject({ name: "Error", message: "root", stack: cause.stack });
    });

    it("without code and cause the fields are absent; `stacktrace` wins over `stack`, an empty one yields to it", () => {
        const plain = transformErrorFromSerialization(transformErrorForSerialization(new Error("x")));
        expect("code" in plain).toBe(false);
        expect(plain.cause).toBeUndefined();

        const withTrace = Object.assign(new Error("y"), { stacktrace: "trace" });
        expect(transformErrorForSerialization(withTrace).stack).toBe("trace");
        const emptyTrace = Object.assign(new Error("z"), { stacktrace: "" });
        expect(transformErrorForSerialization(emptyTrace).stack).toBe(emptyTrace.stack);
    });

    it("a non-Error is returned as is", () => {
        expect(transformErrorForSerialization("text")).toBe("text");
        const value = { a: 1 };
        expect(transformErrorForSerialization(value)).toBe(value);
    });
});

describe("CancellationError", () => {
    it("is recognized by instance and by shape (name and message are Canceled), but not by name alone", () => {
        expect(new CancellationError()).toMatchObject({ name: canceledName, message: canceledName });
        expect(isCancellationError(new CancellationError())).toBe(true);
        // A cancellation error that crossed a process boundary is no longer an instance.
        const crossed = transformErrorFromSerialization(transformErrorForSerialization(new CancellationError()));
        expect(isCancellationError(crossed)).toBe(true);
        expect(isCancellationError(Object.assign(new Error("other"), { name: canceledName }))).toBe(false);
        expect(isCancellationError(Object.assign(new Error(canceledName), { name: "Error" }))).toBe(false);
        expect(isCancellationError({ name: canceledName, message: canceledName })).toBe(false);
        expect(isCancellationError(undefined)).toBe(false);
    });
});

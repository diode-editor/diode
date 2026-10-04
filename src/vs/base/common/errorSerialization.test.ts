import { describe, expect, it } from "vitest";

import {
    canceledName,
    CancellationError,
    isCancellationError,
    transformErrorForSerialization,
    transformErrorFromSerialization,
} from "./errorSerialization.ts";

describe("сериализация ошибок через границу процесса", () => {
    it("имя, сообщение, стек, код и цепочка причин доезжают туда и обратно", () => {
        const cause = Object.assign(new Error("корень"), { code: 42 });
        const error = Object.assign(new RangeError("сверху", { cause }), { code: "EFOO" });
        const wire = transformErrorForSerialization(error);
        expect(JSON.parse(JSON.stringify(wire))).toEqual({
            $isError: true,
            name: "RangeError",
            message: "сверху",
            stack: error.stack,
            code: "EFOO",
            cause: { $isError: true, name: "Error", message: "корень", stack: cause.stack, code: 42 },
        });

        const back = transformErrorFromSerialization(wire);
        expect(back).toBeInstanceOf(Error);
        expect(back).toMatchObject({ name: "RangeError", message: "сверху", stack: error.stack, code: "EFOO" });
        expect(back.cause).toMatchObject({ name: "Error", message: "корень", stack: cause.stack });
    });

    it("без кода и причины полей нет; `stacktrace` предпочтительнее `stack`, пустой ему уступает", () => {
        const plain = transformErrorFromSerialization(transformErrorForSerialization(new Error("x")));
        expect("code" in plain).toBe(false);
        expect(plain.cause).toBeUndefined();

        const withTrace = Object.assign(new Error("y"), { stacktrace: "trace" });
        expect(transformErrorForSerialization(withTrace).stack).toBe("trace");
        const emptyTrace = Object.assign(new Error("z"), { stacktrace: "" });
        expect(transformErrorForSerialization(emptyTrace).stack).toBe(emptyTrace.stack);
    });

    it("не-Error возвращается как есть", () => {
        expect(transformErrorForSerialization("строка")).toBe("строка");
        const value = { a: 1 };
        expect(transformErrorForSerialization(value)).toBe(value);
    });
});

describe("CancellationError", () => {
    it("узнаётся экземпляром и формой (имя и сообщение — Canceled), но не одним именем", () => {
        expect(new CancellationError()).toMatchObject({ name: canceledName, message: canceledName });
        expect(isCancellationError(new CancellationError())).toBe(true);
        // Ошибка отмены, пересёкшая границу процесса, — уже не экземпляр.
        const crossed = transformErrorFromSerialization(transformErrorForSerialization(new CancellationError()));
        expect(isCancellationError(crossed)).toBe(true);
        expect(isCancellationError(Object.assign(new Error("other"), { name: canceledName }))).toBe(false);
        expect(isCancellationError(Object.assign(new Error(canceledName), { name: "Error" }))).toBe(false);
        expect(isCancellationError({ name: canceledName, message: canceledName })).toBe(false);
        expect(isCancellationError(undefined)).toBe(false);
    });
});

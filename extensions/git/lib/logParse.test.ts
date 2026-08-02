import { describe, expect, it } from "vitest";

import { parseLogZ } from "./logParse.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("parseLogZ", () => {
    it("разбирает NUL-разделённые триплеты", () => {
        const stdout = `${SHA_A}\0aaaaaaaa\0feat: панель\0${SHA_B}\0bbbbbbbb\0fix: сэш`;
        expect(parseLogZ(stdout)).toEqual([
            { sha: SHA_A, shortSha: "aaaaaaaa", subject: "feat: панель" },
            { sha: SHA_B, shortSha: "bbbbbbbb", subject: "fix: сэш" },
        ]);
    });

    it("отбрасывает пустой хвост от завершающего NUL", () => {
        const stdout = `${SHA_A}\0aaaaaaaa\0subject\0`;
        expect(parseLogZ(stdout)).toEqual([{ sha: SHA_A, shortSha: "aaaaaaaa", subject: "subject" }]);
    });

    it("пустой subject — легальная запись, а не хвост", () => {
        const stdout = `${SHA_A}\0aaaaaaaa\0`;
        expect(parseLogZ(stdout)).toEqual([{ sha: SHA_A, shortSha: "aaaaaaaa", subject: "" }]);
    });

    it("неполный чанк (обрезанный вывод) отбрасывается", () => {
        const stdout = `${SHA_A}\0aaaaaaaa\0subject\0${SHA_B}\0bbbbbbbb`;
        expect(parseLogZ(stdout)).toEqual([{ sha: SHA_A, shortSha: "aaaaaaaa", subject: "subject" }]);
    });

    it("пустой вывод — пустой список", () => {
        expect(parseLogZ("")).toEqual([]);
    });

    it("запись с пустым sha пропускается", () => {
        const stdout = `\0short\0subject\0${SHA_A}\0aaaaaaaa\0ok`;
        expect(parseLogZ(stdout)).toEqual([{ sha: SHA_A, shortSha: "aaaaaaaa", subject: "ok" }]);
    });
});

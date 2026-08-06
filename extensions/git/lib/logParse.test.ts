import { describe, expect, it } from "vitest";

import type { ILogEntry } from "./logParse.ts";
import { parseDecorations, parseLogZ } from "./logParse.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);

/** Одна запись формата: семь NUL-разделённых полей. */
function entry(fields: {
    sha: string;
    shortSha?: string;
    parents?: string;
    refs?: string;
    author?: string;
    timestamp?: string;
    subject?: string;
}): string {
    return [
        fields.sha,
        fields.shortSha ?? fields.sha.slice(0, 8),
        fields.parents ?? "",
        fields.refs ?? "",
        fields.author ?? "Eugene",
        fields.timestamp ?? "1700000000",
        fields.subject ?? "subject",
    ].join("\0");
}

/** Ожидаемая запись с дефолтами полей, которые тест не проверяет. */
function expected(fields: Partial<ILogEntry> & { sha: string }): ILogEntry {
    return {
        shortSha: fields.sha.slice(0, 8),
        parents: [],
        refs: [],
        author: "Eugene",
        timestamp: 1700000000,
        subject: "subject",
        ...fields,
    };
}

describe("parseLogZ", () => {
    it("разбирает NUL-разделённые записи по семь полей", () => {
        const stdout = [
            entry({ sha: SHA_A, parents: SHA_B, subject: "feat: панель" }),
            entry({ sha: SHA_B, subject: "fix: сэш" }),
        ].join("\0");
        expect(parseLogZ(stdout)).toEqual([
            expected({ sha: SHA_A, parents: [SHA_B], subject: "feat: панель" }),
            expected({ sha: SHA_B, subject: "fix: сэш" }),
        ]);
    });

    it("родители merge-коммита разделены пробелом", () => {
        const stdout = entry({ sha: SHA_A, parents: `${SHA_B} ${SHA_C}` });
        expect(parseLogZ(stdout)[0].parents).toEqual([SHA_B, SHA_C]);
    });

    it("корневой коммит — пустой список родителей", () => {
        expect(parseLogZ(entry({ sha: SHA_A }))[0].parents).toEqual([]);
    });

    it("автор и время коммита попадают в запись", () => {
        const stdout = entry({ sha: SHA_A, author: "Ada Lovelace", timestamp: "1234567890" });
        expect(parseLogZ(stdout)[0]).toMatchObject({ author: "Ada Lovelace", timestamp: 1234567890 });
    });

    it("нечисловое время деградирует в 0, а не в NaN", () => {
        expect(parseLogZ(entry({ sha: SHA_A, timestamp: "хмм" }))[0].timestamp).toBe(0);
    });

    it("отбрасывает пустой хвост от завершающего NUL", () => {
        expect(parseLogZ(`${entry({ sha: SHA_A })}\0`)).toEqual([expected({ sha: SHA_A })]);
    });

    it("пустой subject — легальная запись, а не хвост", () => {
        expect(parseLogZ(entry({ sha: SHA_A, subject: "" }))).toEqual([expected({ sha: SHA_A, subject: "" })]);
    });

    it("неполный чанк (обрезанный вывод) отбрасывается", () => {
        const stdout = `${entry({ sha: SHA_A })}\0${SHA_B}\0bbbbbbbb`;
        expect(parseLogZ(stdout)).toEqual([expected({ sha: SHA_A })]);
    });

    it("пустой вывод — пустой список", () => {
        expect(parseLogZ("")).toEqual([]);
    });

    it("запись с пустым sha пропускается", () => {
        const stdout = `${entry({ sha: "", shortSha: "short" })}\0${entry({ sha: SHA_A, subject: "ok" })}`;
        expect(parseLogZ(stdout)).toEqual([expected({ sha: SHA_A, subject: "ok" })]);
    });
});

describe("parseDecorations", () => {
    it("текущая ветка помечается current", () => {
        expect(parseDecorations("HEAD -> main")).toEqual([{ name: "main", kind: "head", current: true }]);
    });

    it("разбирает полный набор: ветка, remote, тег", () => {
        expect(parseDecorations("HEAD -> main, origin/main, tag: v1.0")).toEqual([
            { name: "main", kind: "head", current: true },
            { name: "origin/main", kind: "remote", current: false },
            { name: "v1.0", kind: "tag", current: false },
        ]);
    });

    it("локальная ветка без HEAD — обычный head", () => {
        expect(parseDecorations("feature")).toEqual([{ name: "feature", kind: "head", current: false }]);
    });

    it("голый HEAD (detached) ref'ом не считается", () => {
        expect(parseDecorations("HEAD")).toEqual([]);
        expect(parseDecorations("HEAD, tag: v2")).toEqual([{ name: "v2", kind: "tag", current: false }]);
    });

    it("origin/HEAD отбрасывается — это симлинк-указатель", () => {
        expect(parseDecorations("origin/HEAD, origin/main")).toEqual([
            { name: "origin/main", kind: "remote", current: false },
        ]);
    });

    it("пустая строка декораций — пустой список", () => {
        expect(parseDecorations("")).toEqual([]);
    });

    it("мусорные пустые токены пропускаются", () => {
        expect(parseDecorations("tag: , , main")).toEqual([{ name: "main", kind: "head", current: false }]);
    });
});

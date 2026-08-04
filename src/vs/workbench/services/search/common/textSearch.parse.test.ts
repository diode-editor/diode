import { describe, expect, it } from "vitest";

import { parseRgMatchLine } from "./textSearch.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a `rg --json` "match" event line for the given fields. */
function matchLine(opts: {
    path: string;
    text: string;
    lineNumber: number;
    submatches: Array<{ text: string; start: number; end: number }>;
}): string {
    return JSON.stringify({
        type: "match",
        data: {
            path: { text: opts.path },
            lines: { text: opts.text },
            line_number: opts.lineNumber,
            absolute_offset: 0,
            submatches: opts.submatches.map((s) => ({ match: { text: s.text }, start: s.start, end: s.end })),
        },
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("parseRgMatchLine", () => {
    // ── Non-match events / junk ───────────────────────────────────────────────────

    it("returns null for a blank line", () => {
        expect(parseRgMatchLine("")).toBeNull();
        expect(parseRgMatchLine("   ")).toBeNull();
    });

    it("returns null for begin/end/summary events", () => {
        expect(parseRgMatchLine(JSON.stringify({ type: "begin", data: { path: { text: "a.ts" } } }))).toBeNull();
        expect(parseRgMatchLine(JSON.stringify({ type: "end", data: {} }))).toBeNull();
        expect(parseRgMatchLine(JSON.stringify({ type: "summary", data: {} }))).toBeNull();
    });

    it("returns null for malformed JSON", () => {
        expect(parseRgMatchLine("{not json")).toBeNull();
    });

    it("returns null for JSON that is not an object", () => {
        expect(parseRgMatchLine("5")).toBeNull();
        expect(parseRgMatchLine("null")).toBeNull();
    });

    it("returns null for a match event whose data is not an object", () => {
        expect(parseRgMatchLine(JSON.stringify({ type: "match", data: 5 }))).toBeNull();
    });

    it("returns null when the path field is missing entirely", () => {
        const line = JSON.stringify({
            type: "match",
            data: { lines: { text: "x" }, line_number: 1, submatches: [{ start: 0, end: 1 }] },
        });
        expect(parseRgMatchLine(line)).toBeNull();
    });

    it("returns null when the line text is missing", () => {
        const line = JSON.stringify({
            type: "match",
            data: { path: { text: "/a.ts" }, line_number: 1, submatches: [{ start: 0, end: 1 }] },
        });
        expect(parseRgMatchLine(line)).toBeNull();
    });

    it("returns null when the line number is not a number", () => {
        const line = JSON.stringify({
            type: "match",
            data: { path: { text: "/a.ts" }, lines: { text: "x" }, line_number: null, submatches: [{ start: 0, end: 1 }] },
        });
        expect(parseRgMatchLine(line)).toBeNull();
    });

    it("returns null when submatches is missing or not an array", () => {
        const line = JSON.stringify({
            type: "match",
            data: { path: { text: "/a.ts" }, lines: { text: "x" }, line_number: 1 },
        });
        expect(parseRgMatchLine(line)).toBeNull();
    });

    it("skips a submatch that lacks numeric start/end but keeps valid ones", () => {
        const line = JSON.stringify({
            type: "match",
            data: {
                path: { text: "/a.ts" },
                lines: { text: "foo foo\n" },
                line_number: 1,
                submatches: [{ match: { text: "foo" } }, { match: { text: "foo" }, start: 4, end: 7 }],
            },
        });
        const matches = parseRgMatchLine(line)!.matches;
        expect(matches).toHaveLength(1);
        expect(matches[0].startColumn).toBe(4);
    });

    it("returns null for a path reported only as bytes (non-UTF-8 filename)", () => {
        const line = JSON.stringify({
            type: "match",
            data: { path: { bytes: "AAAA" }, lines: { text: "x" }, line_number: 1, submatches: [{ start: 0, end: 1 }] },
        });
        expect(parseRgMatchLine(line)).toBeNull();
    });

    // ── Basic match ───────────────────────────────────────────────────────────────

    it("extracts file, line number and match column range", () => {
        const line = matchLine({
            path: "/work/project/a.ts",
            text: "const foo = 1\n",
            lineNumber: 12,
            submatches: [{ text: "foo", start: 6, end: 9 }],
        });
        const result = parseRgMatchLine(line)!;
        expect(result.absolutePath).toBe("/work/project/a.ts");
        expect(result.matches).toHaveLength(1);
        expect(result.matches[0]).toMatchObject({ lineNumber: 12, startColumn: 6, endColumn: 9 });
    });

    it("splits the preview around the match and drops the trailing newline", () => {
        const line = matchLine({
            path: "/a.ts",
            text: "const foo = 1\n",
            lineNumber: 1,
            submatches: [{ text: "foo", start: 6, end: 9 }],
        });
        expect(parseRgMatchLine(line)!.matches[0].preview).toEqual({
            before: "const ",
            inside: "foo",
            after: " = 1",
        });
    });

    it("returns one ITextMatch per submatch on the line", () => {
        const line = matchLine({
            path: "/a.ts",
            text: "foo bar foo\n",
            lineNumber: 3,
            submatches: [
                { text: "foo", start: 0, end: 3 },
                { text: "foo", start: 8, end: 11 },
            ],
        });
        const matches = parseRgMatchLine(line)!.matches;
        expect(matches.map((m) => m.startColumn)).toEqual([0, 8]);
    });

    // ── Byte-offset correctness (multibyte) ───────────────────────────────────────

    it("maps ripgrep byte offsets to character columns for multibyte lines", () => {
        // "café " is 5 chars but 6 bytes (é = 2 bytes); "foo" starts at byte 6.
        const line = matchLine({
            path: "/a.ts",
            text: "café foo\n",
            lineNumber: 1,
            submatches: [{ text: "foo", start: 6, end: 9 }],
        });
        const m = parseRgMatchLine(line)!.matches[0];
        expect(m.preview).toEqual({ before: "café ", inside: "foo", after: "" });
        // Columns are character offsets, not byte offsets.
        expect(m.startColumn).toBe(5);
        expect(m.endColumn).toBe(8);
    });

    it("returns null when a match event carries no submatches", () => {
        const line = matchLine({ path: "/a.ts", text: "x\n", lineNumber: 1, submatches: [] });
        expect(parseRgMatchLine(line)).toBeNull();
    });

    // ── Кап хвоста превью (докс: docs/TODO/SearchPerformance.md, случай 1) ────────

    it("режет preview.after до 256 символов — матч в минифицированной строке остаётся ограниченным", () => {
        const line = matchLine({
            path: "/a.min.js",
            text: "x needle " + "y".repeat(100_000) + "\n",
            lineNumber: 1,
            submatches: [{ text: "needle", start: 2, end: 8 }],
        });
        const m = parseRgMatchLine(line)!.matches[0];
        expect(m.preview.after.length).toBe(256);
        expect(m.preview.after.startsWith(" y")).toBe(true);
        // Колонки не зависят от хвоста — считаются из before/inside.
        expect(m.startColumn).toBe(2);
        expect(m.endColumn).toBe(8);
    });

    it("не разрывает суррогатную пару на границе капа", () => {
        const tail = "y".repeat(255) + "😀" + "z".repeat(300);
        const line = matchLine({
            path: "/a.ts",
            text: "needle" + tail + "\n",
            lineNumber: 1,
            submatches: [{ text: "needle", start: 0, end: 6 }],
        });
        const m = parseRgMatchLine(line)!.matches[0];
        // Высокий суррогат эмодзи попал на границу — срез сдвинут на символ влево.
        expect(m.preview.after.length).toBe(255);
        expect(m.preview.after.at(-1)).toBe("y");
    });
});

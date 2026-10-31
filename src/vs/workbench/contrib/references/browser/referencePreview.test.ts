import { describe, expect, it } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";

import { buildReferenceGroups, type IReferenceTextSource } from "./referencePreview.ts";

const ROOT = "/work/project";

function uriOf(relPath: string): string {
    return Uri.file(`${ROOT}/${relPath}`).toString();
}

function ref(relPath: string, range: ReturnType<typeof createRange>): ICoreReference {
    return { uri: uriOf(relPath), range };
}

function source(
    disk: Partial<Record<string, string>>,
    open: Record<string, string> = {},
): IReferenceTextSource & { reads: string[] } {
    const reads: string[] = [];
    return {
        reads,
        openText: (uri) => open[uri.fsPath] ?? null,
        readText: (uri) => {
            reads.push(uri.fsPath);
            const text = disk[uri.fsPath];
            if (text === undefined) return Promise.reject(new Error(`ENOENT ${uri.fsPath}`));
            return Promise.resolve(text);
        },
    };
}

describe("buildReferenceGroups", () => {
    it("groups by file, trims the line around the reference and gives the path from the root", async () => {
        const src = source({
            [`${ROOT}/src/a.ts`]: "const greet = 1;\nexport { greet };\n",
            [`${ROOT}/src/b.ts`]: 'import { greet } from "./a";\n',
        });

        const groups = await buildReferenceGroups(
            [
                ref("src/a.ts", createRange(0, 6, 0, 11)),
                ref("src/a.ts", createRange(1, 9, 1, 14)),
                ref("src/b.ts", createRange(0, 9, 0, 14)),
            ],
            src,
            ROOT,
        );

        expect(groups).toEqual([
            {
                uri: Uri.file(`${ROOT}/src/a.ts`).toString(),
                absolutePath: `${ROOT}/src/a.ts`,
                relPath: "src/a.ts",
                matches: [
                    {
                        lineNumber: 1,
                        startColumn: 6,
                        endColumn: 11,
                        preview: { before: "const ", inside: "greet", after: " = 1;" },
                    },
                    {
                        lineNumber: 2,
                        startColumn: 9,
                        endColumn: 14,
                        preview: { before: "export { ", inside: "greet", after: " };" },
                    },
                ],
            },
            {
                uri: Uri.file(`${ROOT}/src/b.ts`).toString(),
                absolutePath: `${ROOT}/src/b.ts`,
                relPath: "src/b.ts",
                matches: [
                    {
                        lineNumber: 1,
                        startColumn: 9,
                        endColumn: 14,
                        preview: { before: "import { ", inside: "greet", after: ' } from "./a";' },
                    },
                ],
            },
        ]);
    });

    it("a file is read once per request even with many references in it", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "aaa\nbbb\nccc\n" });

        await buildReferenceGroups(
            [
                ref("a.ts", createRange(0, 0, 0, 3)),
                ref("a.ts", createRange(1, 0, 1, 3)),
                ref("a.ts", createRange(2, 0, 2, 3)),
            ],
            src,
            ROOT,
        );

        expect(src.reads).toEqual([`${ROOT}/a.ts`]);
    });

    it("the open model wins over disk: unsaved edits are visible", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "an old disk text\n" }, { [`${ROOT}/a.ts`]: "a new buffer text\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 0, 0, 2))], src, ROOT);

        expect(groups[0].matches[0].preview).toEqual({ before: "", inside: "a ", after: "new buffer text" });
        expect(src.reads).toEqual([]);
    });

    it("an unavailable file and a line past the text are dropped without empty groups", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "one line\n" });

        const groups = await buildReferenceGroups(
            [
                ref("gone.ts", createRange(0, 0, 0, 1)),
                // The file exists but has no such line (it changed while the server was thinking).
                ref("a.ts", createRange(99, 0, 99, 1)),
                ref("a.ts", createRange(0, 0, 0, 4)),
            ],
            src,
            ROOT,
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].relPath).toBe("a.ts");
        expect(groups[0].matches).toHaveLength(1);
        // A failed read is cached too — there was no second reference into that file,
        // but there must be no read retries.
        expect(src.reads).toEqual([`${ROOT}/gone.ts`, `${ROOT}/a.ts`]);
    });

    it("columns past the end of the line are clamped to its length", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "abc\n" });

        const groups = await buildReferenceGroups(
            [ref("a.ts", createRange(0, 1, 0, 99)), ref("a.ts", createRange(0, 99, 0, 120))],
            src,
            ROOT,
        );

        expect(groups[0].matches).toEqual([
            { lineNumber: 1, startColumn: 1, endColumn: 3, preview: { before: "a", inside: "bc", after: "" } },
            { lineNumber: 1, startColumn: 3, endColumn: 3, preview: { before: "abc", inside: "", after: "" } },
        ]);
    });

    it("a multiline range is highlighted to the end of the first line", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "first line\nsecond line\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 6, 1, 3))], src, ROOT);

        expect(groups[0].matches[0]).toEqual({
            lineNumber: 1,
            startColumn: 6,
            endColumn: 10,
            preview: { before: "first ", inside: "line", after: "" },
        });
    });

    it("CRLF leaves no \\r at the end of the preview", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "const a = 1;\r\nconst b = 2;\r\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 6, 0, 7))], src, ROOT);

        expect(groups[0].matches[0].preview).toEqual({ before: "const ", inside: "a", after: " = 1;" });
    });

    it("a long line tail is capped without splitting a surrogate pair", async () => {
        const emojiAt255 = `${"x".repeat(255)}🙂${"y".repeat(50)}`;
        const src = source({
            [`${ROOT}/min.js`]: `ref${emojiAt255}\n`,
            [`${ROOT}/plain.js`]: `ref${"z".repeat(400)}\n`,
        });

        const groups = await buildReferenceGroups(
            [ref("min.js", createRange(0, 0, 0, 3)), ref("plain.js", createRange(0, 0, 0, 3))],
            src,
            ROOT,
        );

        // The 🙂 pair starts exactly at the cut boundary — drop it whole.
        const emojiTail = groups[0].matches[0].preview.after;
        expect(emojiTail).toBe("x".repeat(255));
        expect(emojiTail).not.toContain("\ud83d");

        expect(groups[1].matches[0].preview.after).toBe("z".repeat(256));
    });

    it("a line exactly at the cap is not cut, even if it ends with half a pair", async () => {
        // The boundary is inclusive: 256 chars are not cut yet, even though the last
        // code unit looks like the start of a surrogate pair.
        const exact = `${"x".repeat(255)}\ud83d`;
        const src = source({ [`${ROOT}/a.js`]: `ref${exact}\n` });

        const groups = await buildReferenceGroups([ref("a.js", createRange(0, 0, 0, 3))], src, ROOT);

        expect(groups[0].matches[0].preview.after).toBe(exact);
    });

    it("a surrogate pair right at the cap boundary is cut whole", async () => {
        // Edge points of the high-surrogate range: U+10000 (D800 DC00) and
        // U+10FFFF (DBFF DFFF) — both halves must go together.
        const lowest = `${"x".repeat(255)}\u{10000}${"y".repeat(10)}`;
        const highest = `${"x".repeat(255)}\u{10FFFF}${"y".repeat(10)}`;
        const src = source({
            [`${ROOT}/low.js`]: `ref${lowest}\n`,
            [`${ROOT}/high.js`]: `ref${highest}\n`,
        });

        const groups = await buildReferenceGroups(
            [ref("low.js", createRange(0, 0, 0, 3)), ref("high.js", createRange(0, 0, 0, 3))],
            src,
            ROOT,
        );

        expect(groups[0].matches[0].preview.after).toBe("x".repeat(255));
        expect(groups[1].matches[0].preview.after).toBe("x".repeat(255));
    });

    it("a character above the surrogate range at the cap boundary is not cut needlessly", async () => {
        // U+F900 is not half of a pair: the upper bound of the check must let it
        // through, otherwise an extra char is bitten off the tail.
        const tail = `${"x".repeat(255)}\uf900${"y".repeat(50)}`;
        const src = source({ [`${ROOT}/a.js`]: `ref${tail}\n` });

        const groups = await buildReferenceGroups([ref("a.js", createRange(0, 0, 0, 3))], src, ROOT);

        expect(groups[0].matches[0].preview.after).toBe(`${"x".repeat(255)}\uf900`);
    });

    it("a carriage return is stripped only at the end of the line", async () => {
        // \r in the middle of a line is part of the text (that's how the server sees it
        // when counting columns); only the trailing one from CRLF is stripped.
        const src = source({ [`${ROOT}/a.ts`]: "aa\rbb cc\r\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 0, 0, 2))], src, ROOT);

        expect(groups[0].matches[0].preview).toEqual({ before: "", inside: "aa", after: "\rbb cc" });
    });

    it("extra separators after the root and backslashes in the path are normalized", async () => {
        const src = source({
            [`${ROOT}//src/a.ts`]: "const a = 1;\n",
            [`${ROOT}/dir\\odd.ts`]: "const b = 2;\n",
        });

        const groups = await buildReferenceGroups(
            [
                { uri: Uri.file(`${ROOT}//src/a.ts`).toString(), range: createRange(0, 6, 0, 7) },
                { uri: Uri.file(`${ROOT}/dir\\odd.ts`).toString(), range: createRange(0, 6, 0, 7) },
            ],
            src,
            ROOT,
        );

        expect(groups.map((g) => g.relPath)).toEqual(["src/a.ts", "dir/odd.ts"]);
    });

    it("a file outside the workspace root is shown with an absolute path", async () => {
        const outside = Uri.file("/opt/lib/other.ts").toString();
        const src = source({ "/opt/lib/other.ts": "export const x = 1;\n" });

        const groups = await buildReferenceGroups([{ uri: outside, range: createRange(0, 13, 0, 14) }], src, ROOT);

        expect(groups[0].relPath).toBe("/opt/lib/other.ts");
        expect(groups[0].absolutePath).toBe("/opt/lib/other.ts");
    });

    it("without a workspace root the path stays absolute", async () => {
        const src = source({ [`${ROOT}/a.ts`]: "abc\n" });

        const groups = await buildReferenceGroups([ref("a.ts", createRange(0, 0, 0, 1))], src, "");

        expect(groups[0].relPath).toBe(`${ROOT}/a.ts`);
    });

    it("a sibling sharing the root prefix is not considered inside it", async () => {
        // "/work/project2" is not "/work/project": the path is shown whole, not
        // trimmed to "2/a.ts".
        const sibling = "/work/project2/a.ts";
        const src = source({ [sibling]: "const a = 1;\n" });

        const groups = await buildReferenceGroups(
            [{ uri: Uri.file(sibling).toString(), range: createRange(0, 6, 0, 7) }],
            src,
            ROOT,
        );

        expect(groups[0].relPath).toBe(sibling);
    });

    it("an empty reference list gives an empty group list", async () => {
        expect(await buildReferenceGroups([], source({}), ROOT)).toEqual([]);
    });
});

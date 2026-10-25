import { describe, expect, it } from "vitest";

import { emulatorWith, fakeLinkProvider, type IFakeLinkContext } from "../../../../../../TestUtils/terminalLinks.ts";
import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";

import { isInLink, type ITerminalLink } from "./terminalLinkProvider.ts";

const DISK: IFakeLinkContext["disk"] = {
    "/ws": "dir",
    "/ws/src": "dir",
    "/ws/src/a.ts": "file",
    "/ws/sub": "dir",
    "/ws/sub/x.ts": "file",
    "/ws/x.ts": "file",
    "/ws/app.py": "file",
    "/home/user/notes.md": "file",
    "/outside": "dir",
    "/outside/b.ts": "file",
    "/ws/my file.ts": "file",
};

interface ILinkView {
    readonly text: string;
    readonly path: string;
    readonly type: ITerminalLink["type"];
    readonly start: [number, number];
    readonly end: [number, number];
}

function view(link: ITerminalLink): ILinkView {
    return {
        text: link.text,
        path: link.uri.fsPath,
        type: link.type,
        start: [link.start.x, link.start.y],
        end: [link.end.x, link.end.y],
    };
}

async function linksOf(
    output: string,
    { row = 0, cols = 80, ...context }: Partial<IFakeLinkContext> & { row?: number; cols?: number } = {},
): Promise<ILinkView[]> {
    const session = await emulatorWith(output, cols);
    const buffer = session.buffer!;
    const links = await fakeLinkProvider({ disk: DISK, ...context }).provideLinks(buffer, row);
    session.dispose();
    return links.map(view);
}

describe("TerminalLinkProvider", () => {
    it("a relative path with a line and column suffix is one link over the path and the suffix", async () => {
        expect(await linksOf("see src/a.ts:3:2 here")).toEqual([
            { text: "src/a.ts:3:2", path: "/ws/src/a.ts", type: "LocalFile", start: [4, 0], end: [15, 0] },
        ]);
    });

    it("keeps the parsed suffix for the opener", async () => {
        const session = await emulatorWith("src/a.ts(10, 4)");
        const [link] = await fakeLinkProvider({ disk: DISK }).provideLinks(session.buffer!, 0);
        expect(link.parsedLink?.suffix).toMatchObject({ row: 10, col: 4 });
        session.dispose();
    });

    it.each([
        ["/ws/src/a.ts", "/ws/src/a.ts"],
        ["./src/a.ts", "/ws/src/a.ts"],
        ["../ws/src/a.ts", "/ws/src/a.ts"],
        ["~/notes.md", "/home/user/notes.md"],
        ["file:///ws/src/a.ts", "/ws/src/a.ts"],
    ])("resolves %s", async (output, path) => {
        const [link] = await linksOf(output);
        expect(link.path).toBe(path);
        expect(link.start).toEqual([0, 0]);
        expect(link.end).toEqual([output.length - 1, 0]);
    });

    it("a path that doesn't exist is not a link", async () => {
        expect(await linksOf("src/missing.ts:3")).toEqual([]);
    });

    it("an empty row has no links, a row past the buffer neither", async () => {
        expect(await linksOf("")).toEqual([]);
        expect(await linksOf("src/a.ts", { row: 500 })).toEqual([]);
    });

    it("relative paths resolve against the shell's cwd first, then the workspace root", async () => {
        expect((await linksOf("x.ts:1", { cwds: ["/ws/sub", "/ws"] }))[0].path).toBe("/ws/sub/x.ts");
        expect((await linksOf("src/a.ts", { cwds: ["/ws/sub", "/ws"] }))[0].path).toBe("/ws/src/a.ts");
    });

    it("a folder in the workspace is a folder link, a folder outside is not a link", async () => {
        expect(await linksOf("cd /ws/src")).toEqual([
            { text: "/ws/src", path: "/ws/src", type: "LocalFolderInWorkspace", start: [3, 0], end: [9, 0] },
        ]);
        expect(await linksOf("cd /outside")).toEqual([]);
        expect((await linksOf("/outside/b.ts:2"))[0].type).toBe("LocalFile");
    });

    it("the Python traceback form links the quoted path with its line", async () => {
        const [link] = await linksOf('  File "/ws/app.py", line 3, in <module>');
        expect(link).toMatchObject({ text: '"/ws/app.py", line 3', path: "/ws/app.py", start: [7, 0], end: [26, 0] });
    });

    it("a path with spaces is found by the fallback matchers", async () => {
        expect(await linksOf("/ws/my file.ts:4: error")).toEqual([
            { text: "/ws/my file.ts:4", path: "/ws/my file.ts", type: "LocalFile", start: [0, 0], end: [15, 0] },
        ]);
    });

    it("a trailing colon is not part of the link", async () => {
        expect((await linksOf("src/a.ts:3: error"))[0]).toMatchObject({ text: "src/a.ts:3", end: [9, 0] });
    });

    it("trailing dots and brackets are tried off the path; the underline drops them unless a suffix follows", async () => {
        expect(await linksOf("src/a.ts.")).toMatchObject([{ text: "src/a.ts.", path: "/ws/src/a.ts", end: [7, 0] }]);
        expect(await linksOf("src/a.ts..")).toMatchObject([{ text: "src/a.ts..", end: [7, 0] }]);
        expect(await linksOf("src/a.ts]:3")).toMatchObject([{ text: "src/a.ts]:3", end: [10, 0] }]);
        // cols=10: " src/a.ts." | ".": the trimmed end goes back to the first row
        expect(await linksOf(" src/a.ts..", { cols: 10 })).toMatchObject([{ start: [1, 0], end: [8, 0] }]);
    });

    it("`../` prefixes are also tried stripped: a path printed by a tool run in a subfolder", async () => {
        expect(await linksOf("../src/a.ts")).toMatchObject([{ text: "../src/a.ts", path: "/ws/src/a.ts" }]);
        expect(await linksOf("../../src/a.ts")).toMatchObject([{ path: "/ws/src/a.ts" }]);
    });

    it("the fallback matchers run only when the regular pass found nothing; their text keeps line and column", async () => {
        expect(await linksOf("src/a.ts")).toHaveLength(1);
        expect(await linksOf("/ws/my file.ts")).toMatchObject([{ text: "/ws/my file.ts", end: [13, 0] }]);
        expect(await linksOf("/ws/my file.ts(4,2): error")).toMatchObject([{ text: "/ws/my file.ts:4:2" }]);
        expect(await linksOf('  File "/ws/my file.ts", line 4, in <module>')).toMatchObject([
            { text: "/ws/my file.ts:4", start: [7, 0], end: [30, 0] },
        ]);
    });

    it("a path longer than 1024 characters is not resolved, the regular way or by the fallback", async () => {
        const plain = (length: number): string => `/ws/${"d".repeat(length - 4)}`;
        const spaced = (length: number): string => `/ws/a ${"b".repeat(length - 6)}`;
        const disk = {
            ...DISK,
            [plain(1024)]: "file",
            [plain(1025)]: "file",
            [spaced(1024)]: "file",
            [spaced(1025)]: "file",
        } as const;
        // A word before the path keeps the whole-line fallback from finding it.
        expect(await linksOf(`see ${plain(1024)}`, { cols: 1100, disk })).toHaveLength(1);
        expect(await linksOf(`see ${plain(1025)}`, { cols: 1100, disk })).toEqual([]);
        expect(await linksOf(spaced(1024), { cols: 1100, disk })).toHaveLength(1);
        expect(await linksOf(spaced(1025), { cols: 1100, disk })).toEqual([]);
    });

    it("a trailing dot or quote is trimmed off the underline", async () => {
        expect((await linksOf("open 'src/a.ts'."))[0]).toMatchObject({ path: "/ws/src/a.ts", end: [13, 0] });
    });

    it("a link wrapped onto the next row is one link spanning both rows, from either row", async () => {
        // cols=10: "xx src/a.t" | "s:3"
        const expected = [{ text: "src/a.ts:3", path: "/ws/src/a.ts", type: "LocalFile", start: [3, 0], end: [2, 1] }];
        expect(await linksOf("xx src/a.ts:3", { cols: 10, row: 0 })).toEqual(expected);
        expect(await linksOf("xx src/a.ts:3", { cols: 10, row: 1 })).toEqual(expected);
    });

    it("a link over three rows is found from its first row", async () => {
        // cols=5: "/ws/s" | "rc/a." | "ts:3"
        expect(await linksOf("/ws/src/a.ts:3 ok", { cols: 5 })).toMatchObject([
            { text: "/ws/src/a.ts:3", start: [0, 0], end: [3, 2] },
        ]);
    });

    it("wide characters on the wrapped rows shift the cells, from either row", async () => {
        // cols=10: "zhongwen" (4 cells) + " src/a" | ".ts:1"
        const before = [{ text: "src/a.ts:1", start: [5, 0], end: [4, 1] }];
        expect(await linksOf("\u4e2d\u6587 src/a.ts:1", { cols: 10, row: 1 })).toMatchObject(before);
        // cols=10: "xxxxxxx /w" | "s/zhong.ts:2": the wide character is on the continuation row
        const disk = { ...DISK, "/ws/\u4e2d.ts": "file" as const };
        const inside = [{ text: "/ws/\u4e2d.ts:2", start: [8, 0], end: [8, 1] }];
        expect(await linksOf("xxxxxxx /ws/\u4e2d.ts:2 ok", { cols: 10, row: 0, disk })).toMatchObject(inside);
    });

    it("a link starting in the row's last cell, and one with a wide character opening the next row", async () => {
        // cols=10: "xxxxxxxx s" | "rc/a.ts"
        expect(await linksOf("xxxxxxxx src/a.ts", { cols: 10 })).toMatchObject([{ start: [9, 0], end: [6, 1] }]);
        // cols=10: "xx /ws/abc" | "zhong.ts:2 ok"
        const disk = { ...DISK, "/ws/abc\u4e2d.ts": "file" as const };
        expect(await linksOf("xx /ws/abc\u4e2d.ts:2 ok", { cols: 10, disk })).toMatchObject([
            { start: [3, 0], end: [6, 1] },
        ]);
    });

    it("the end of a long wrapped line is read in full from its last row", async () => {
        expect(await linksOf(`${"x".repeat(300)} src/a.ts`, { cols: 10, row: 30 })).toMatchObject([
            { text: "src/a.ts", start: [1, 30] },
        ]);
    });

    it("rows above and below are not part of the line unless wrapped; the last row has nothing below", async () => {
        expect(await linksOf("src/a.ts\r\nx.ts")).toMatchObject([{ text: "src/a.ts", end: [7, 0] }]);
        expect(await linksOf("src/a.ts\r\nx.ts", { row: 1 })).toMatchObject([
            { text: "x.ts", start: [0, 1], end: [3, 1] },
        ]);
        expect(await linksOf("src/a.ts", { row: 9 })).toEqual([]);
    });

    it("a wrapped line is read only a link's length around the row: a huge line still has links", async () => {
        // cols=800: one row of context on either side, 1600 characters, under the 2000 limit; the line is 4 rows.
        const filler = "x".repeat(4 * 800 - " src/a.ts".length);
        expect(await linksOf(`src/a.ts ${filler}`, { cols: 800 })).toMatchObject([{ text: "src/a.ts" }]);
        expect(await linksOf(`${filler} src/a.ts`, { cols: 800, row: 3 })).toMatchObject([{ text: "src/a.ts" }]);
    });

    it("wide characters before the link shift its cells", async () => {
        // "zhongwen" takes 4 cells but 2 string indices
        expect((await linksOf("\u4e2d\u6587 src/a.ts:1"))[0]).toMatchObject({ start: [5, 0], end: [14, 0] });
    });

    it("wide and Cyrillic characters inside the path keep the underline on the path's cells", async () => {
        const cyrillic = "/ws/\u0444\u0430\u0439\u043b.ts"; // "fajl"
        const cjk = "/ws/\u4e2d.ts";
        const disk = { ...DISK, [cyrillic]: "file" as const, [cjk]: "file" as const };
        expect((await linksOf(`${cyrillic}:2 ok`, { disk }))[0]).toMatchObject({ start: [0, 0], end: [12, 0] });
        expect((await linksOf(`${cjk}:2 ok`, { disk }))[0]).toMatchObject({ start: [0, 0], end: [10, 0] });
    });

    it("finds every link on the line, up to the limit of resolved candidates", async () => {
        const links = await linksOf("src/a.ts x.ts src/a.ts");
        expect(links.map((link) => link.start[0])).toEqual([0, 14]);
        const many = Array.from({ length: 12 }, () => "src/a.ts").join(" ");
        expect(await linksOf(many, { cols: 200 })).toHaveLength(10);
    });

    it("skips a line longer than the upstream limit", async () => {
        // One row holds the whole line: wrapped context is capped by the link length limit anyway
        expect(await linksOf(`src/a.ts ${"x".repeat(1991)}`, { cols: 2100 })).toHaveLength(1);
        expect(await linksOf(`src/a.ts ${"x".repeat(1992)}`, { cols: 2100 })).toEqual([]);
    });

    it("sees the scrollback: rows are absolute buffer rows", async () => {
        const output = `${Array.from({ length: 30 }, (_, i) => `line ${String(i)}`).join("\r\n")}\r\nsrc/a.ts`;
        const session = await emulatorWith(`src/a.ts:7\r\n${output}`);
        const buffer = session.buffer!;
        const [link] = await fakeLinkProvider({ disk: DISK }).provideLinks(buffer, 0);
        expect(link.text).toBe("src/a.ts:7");
        expect(buffer.viewportY).toBeGreaterThan(0);
        session.dispose();
    });
});

describe("isInLink", () => {
    const link = { start: { x: 5, y: 1 }, end: { x: 2, y: 3 } } as ITerminalLink;

    it.each([
        [5, 1, true],
        [4, 1, false],
        [79, 1, true],
        [0, 2, true],
        [2, 3, true],
        [3, 3, false],
        [5, 0, false],
        [0, 4, false],
    ])("(%i, %i) \u2192 %s", (x, y, inside) => {
        expect(isInLink(link, x, y)).toBe(inside);
    });
});

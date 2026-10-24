import { describe, expect, it } from "vitest";

import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";

import { isInLink, type ITerminalLink } from "./terminalLinkProvider.ts";
import { emulatorWith, fakeLinkProvider, type IFakeLinkContext } from "./terminalLinks.testUtils.ts";

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

    it("a trailing dot or quote is trimmed off the underline", async () => {
        expect((await linksOf("open 'src/a.ts'."))[0]).toMatchObject({ path: "/ws/src/a.ts", end: [13, 0] });
    });

    it("a link wrapped onto the next row is one link spanning both rows, from either row", async () => {
        // cols=10: "xx src/a.t" | "s:3"
        const expected = [{ text: "src/a.ts:3", path: "/ws/src/a.ts", type: "LocalFile", start: [3, 0], end: [2, 1] }];
        expect(await linksOf("xx src/a.ts:3", { cols: 10, row: 0 })).toEqual(expected);
        expect(await linksOf("xx src/a.ts:3", { cols: 10, row: 1 })).toEqual(expected);
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

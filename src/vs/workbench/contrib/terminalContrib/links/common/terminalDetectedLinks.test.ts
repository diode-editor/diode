import { describe, expect, it, vi } from "vitest";

import { emulatorWith, type FakeDisk, fakeLinkProvider } from "../../../../../../TestUtils/terminalLinks.ts";
import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";

import {
    getDetectedLinks,
    getRecentFileLink,
    type IDetectedLinks,
    type ITerminalLinkLineSource,
} from "./terminalDetectedLinks.ts";
import type { ITerminalLink } from "./terminalLinkProvider.ts";

const DISK: FakeDisk = {
    "/ws/a.ts": "file",
    "/ws/b.ts": "file",
    "/ws/c.ts": "file",
    "/ws/d.ts": "file",
    "/ws/e.ts": "file",
    "/ws/dir": "dir",
};

function texts(links: IDetectedLinks): { files: string[]; folders: string[] } {
    return { files: links.fileLinks.map((link) => link.text), folders: links.folderLinks.map((link) => link.text) };
}

/** Scrolled so that `viewportY` is `top`: 4 rows of viewport. */
async function buffer(output: string, top?: number): Promise<ITerminalBuffer> {
    const session = await emulatorWith(output, 40, 4);
    const bottom = session.buffer!.viewportY;
    if (top !== undefined) session.scrollLines(top - bottom);
    const result = session.buffer!;
    expect(result.viewportY).toBe(top ?? bottom);
    return result;
}

/** The fake provider over `DISK`, recording the rows it was asked for. */
function recording(): ITerminalLinkLineSource & { rows(): unknown[] } {
    const provider = fakeLinkProvider({ disk: DISK });
    const provideLinks = vi.fn(
        (b: ITerminalBuffer, row: number): Promise<ITerminalLink[]> => provider.provideLinks(b, row),
    );
    return { provideLinks, rows: () => provideLinks.mock.calls.map(([, row]) => row) };
}

describe("getDetectedLinks", () => {
    it("the viewport bottom-up, each row's links right to left; files and folders apart", async () => {
        // A bare name is a link only alone on its line, as upstream.
        const buf = await buffer("./a.ts ./b.ts\r\ndir\r\n./c.ts ./d.ts");
        const { viewport } = getDetectedLinks(buf, fakeLinkProvider({ disk: DISK }));

        expect(texts(await viewport)).toEqual({ files: ["./d.ts", "./c.ts", "./b.ts", "./a.ts"], folders: ["dir"] });
    });

    it("all: the viewport, then below it bottom-up, then above it bottom-up", async () => {
        // Rows 0..7; the viewport shows rows 2..5.
        const buf = await buffer("a.ts\r\nb.ts\r\nc.ts\r\n\r\n\r\nd.ts\r\ne.ts\r\nx", 2);
        const { viewport, all } = getDetectedLinks(buf, fakeLinkProvider({ disk: DISK }));

        expect(texts(await viewport).files).toEqual(["d.ts", "c.ts"]);
        expect(texts(await all).files).toEqual(["d.ts", "c.ts", "e.ts", "b.ts", "a.ts"]);
    });

    it("each row of the buffer is read once: the viewport, below it, above it", async () => {
        // Rows 0..7; the viewport shows rows 2..5.
        const buf = await buffer("a.ts\r\nb.ts\r\nc.ts\r\n\r\n\r\nd.ts\r\ne.ts\r\nx", 2);
        const source = recording();
        const { viewport, all } = getDetectedLinks(buf, source);
        await Promise.all([viewport, all]);

        expect(source.rows()).toEqual([5, 4, 3, 2, 5, 4, 3, 2, 7, 6, 1, 0]);
    });

    it("a link on a wrapped line is listed once", async () => {
        const buf = await buffer(`${"x".repeat(36)} ./a.ts ./b.ts`);
        const { viewport } = getDetectedLinks(buf, fakeLinkProvider({ disk: DISK }));

        expect(texts(await viewport).files).toEqual(["./b.ts", "./a.ts"]);
    });

    it("the same text at two places is two links: the picker collapses them", async () => {
        const buf = await buffer("./a.ts ./a.ts");
        const { viewport } = getDetectedLinks(buf, fakeLinkProvider({ disk: DISK }));

        expect((await viewport).fileLinks.map((link) => link.start.x)).toEqual([7, 0]);
    });

    it("an empty buffer has no links", async () => {
        const buf = await buffer("");
        const { viewport, all } = getDetectedLinks(buf, fakeLinkProvider({ disk: DISK }));

        expect(texts(await viewport)).toEqual({ files: [], folders: [] });
        expect(texts(await all)).toEqual({ files: [], folders: [] });
    });
});

describe("getRecentFileLink", () => {
    it("the first file link of the bottom row that has one; folders don't count", async () => {
        const buf = await buffer("a.ts\r\n./b.ts ./c.ts\r\ndir\r\n");
        const link = await getRecentFileLink(buf, fakeLinkProvider({ disk: DISK }));

        expect(link?.text).toBe("./b.ts");
    });

    it("searches from the buffer end up to the viewport top, not the scrollback above it", async () => {
        const output = "a.ts\r\n\r\n\r\n\r\n\r\n\r\nb.ts\r\n\r\n\r\n\r\nx";
        const provider = fakeLinkProvider({ disk: DISK });

        // The viewport (rows 2..5) has no link; b.ts is below it.
        expect((await getRecentFileLink(await buffer(output, 2), provider))?.text).toBe("b.ts");
        // a.ts is only above the viewport.
        expect(await getRecentFileLink(await buffer(output, 7), provider)).toBeUndefined();
        expect(await getRecentFileLink(await buffer(output, 0), provider)).toMatchObject({ text: "b.ts" });
    });

    it("the viewport's top row is searched too", async () => {
        // Rows 0..4; the viewport shows rows 0..3, a.ts is on its top row.
        const link = await getRecentFileLink(await buffer("a.ts\r\n\r\n\r\n\r\nx", 0), recording());

        expect(link?.text).toBe("a.ts");
    });

    it("stops at the first row with a file link", async () => {
        const buf = await buffer("a.ts\r\nb.ts\r\n");
        const source = recording();

        expect((await getRecentFileLink(buf, source))?.text).toBe("b.ts");
        expect(source.rows()).toEqual([3, 2, 1]);
    });
});

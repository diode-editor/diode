import { describe, expect, it } from "vitest";

import type { FileClipboardEntry } from "../../../../platform/clipboard/common/iFileClipboard.ts";

import { buildPasteEdits } from "./fileOperationsService.ts";

describe("buildPasteEdits", () => {
    it("maps a copy entry to copy edits into the target dir", () => {
        const entry: FileClipboardEntry = { paths: ["/a/x.txt", "/a/y.txt"], mode: "copy" };
        expect(buildPasteEdits(entry, "/dst")).toEqual([
            { kind: "copy", from: "/a/x.txt", to: "/dst" },
            { kind: "copy", from: "/a/y.txt", to: "/dst" },
        ]);
    });

    it("maps a cut entry to move edits", () => {
        const entry: FileClipboardEntry = { paths: ["/a/x.txt"], mode: "cut" };
        expect(buildPasteEdits(entry, "/dst")).toEqual([{ kind: "move", from: "/a/x.txt", to: "/dst" }]);
    });

    it("drops paths whose ancestor is in the clipboard too (distinctParents)", () => {
        // Компактная строка в мультивыборе кладёт в буфер все папки цепочки.
        const entry: FileClipboardEntry = {
            paths: ["/w/src", "/w/src/main", "/w/src/main/java", "/w/srcx"],
            mode: "copy",
        };
        expect(buildPasteEdits(entry, "/dst")).toEqual([
            { kind: "copy", from: "/w/src", to: "/dst" },
            { kind: "copy", from: "/w/srcx", to: "/dst" },
        ]);
    });

    it("returns an empty list for no paths", () => {
        expect(buildPasteEdits({ paths: [], mode: "copy" }, "/dst")).toEqual([]);
    });
});

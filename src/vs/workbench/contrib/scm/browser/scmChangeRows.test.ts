import { describe, expect, it, vi } from "vitest";

import { packRgb } from "../../../../../../tuidom/common/colorUtils.ts";
import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { IScmChange } from "./changesService.ts";
import { buildFileRow, buildFolderRow, buildGroupRow, formatFileRow, type IScmRowStyles } from "./scmChangeRows.ts";

const MODIFIED = packRgb(226, 192, 141);
const DIM = packRgb(128, 128, 128);
const STYLES: IScmRowStyles = {
    statusColors: { "gitDecoration.modifiedResourceForeground": MODIFIED },
    dimFg: DIM,
};

function change(overrides: Partial<IScmChange> = {}): IScmChange {
    return {
        uri: Uri.file("/repo/src/a.ts"),
        status: "M",
        colorId: "gitDecoration.modifiedResourceForeground",
        path: "src/a.ts",
        group: "worktree",
        ...overrides,
    };
}

const WIDTH = 20;

describe("scmChangeRows — file row", () => {
    it("row id is the caller-provided rowId (id convention lives in the component)", () => {
        const parts = buildFileRow("scmRow-worktree-src-a-ts", change(), "src/a.ts", STYLES, () => undefined);
        expect(parts.root.id).toBe("scmRow-worktree-src-a-ts");
    });

    it("shows the label, the open glyph and the right-aligned status letter", () => {
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, () => undefined);
        const backend = renderElement(parts.root, WIDTH, 1);

        expect(backend.getTextAt(new Point(0, 0), 8)).toBe("src/a.ts");
        // Буква статуса — в последней колонке, цветом gitDecoration.
        expect(backend.getTextAt(new Point(WIDTH - 1, 0), 1)).toBe("M");
        expect(backend.getFgAt(new Point(WIDTH - 1, 0))).toBe(MODIFIED);
        // Имя — тем же цветом статуса, глиф — приглушённый.
        expect(backend.getFgAt(new Point(0, 0))).toBe(MODIFIED);
        expect(backend.getFgAt(new Point(WIDTH - 3, 0))).toBe(DIM);
    });

    it("unknown colorId leaves the inherited color (no explicit char styles)", () => {
        const parts = buildFileRow("row", change({ colorId: "not-a-color" }), "src/a.ts", STYLES, () => undefined);
        const backend = renderElement(parts.root, WIDTH, 1);

        expect(backend.getTextAt(new Point(0, 0), 8)).toBe("src/a.ts");
        expect(backend.getFgAt(new Point(0, 0))).not.toBe(MODIFIED);
        expect(backend.getFgAt(new Point(WIDTH - 1, 0))).not.toBe(MODIFIED);
    });

    it("formatFileRow restyles in place on theme change", () => {
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, () => undefined);
        const NEW = packRgb(1, 2, 3);
        formatFileRow(parts, change(), "src/a.ts", {
            statusColors: { "gitDecoration.modifiedResourceForeground": NEW },
            dimFg: DIM,
        });
        const backend = renderElement(parts.root, WIDTH, 1);

        expect(backend.getFgAt(new Point(0, 0))).toBe(NEW);
        expect(backend.getFgAt(new Point(WIDTH - 1, 0))).toBe(NEW);
    });

    it("glyph consumes click (calls onOpenFile) and dblclick (no-op)", () => {
        const onOpenFile = vi.fn();
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, onOpenFile);

        const click = new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
        expect(parts.openGlyph.dispatchEvent(click)).toBe(false); // потреблено
        expect(onOpenFile).toHaveBeenCalledTimes(1);

        const dbl = new TUIMouseEvent("dblclick", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
        expect(parts.openGlyph.dispatchEvent(dbl)).toBe(false);
        expect(onOpenFile).toHaveBeenCalledTimes(1);
    });
});

describe("scmChangeRows — group row", () => {
    it("shows the label and the right-aligned dim counter", () => {
        const row = buildGroupRow("scmGroup-index", "Staged Changes", 12);
        expect(row.id).toBe("scmGroup-index");

        const backend = renderElement(row, WIDTH, 1);
        expect(backend.getTextAt(new Point(0, 0), 14)).toBe("Staged Changes");
        expect(backend.getTextAt(new Point(WIDTH - 3, 0), 2)).toBe("12");
    });
});

describe("scmChangeRows — folder row", () => {
    it("is a plain label with the compacted path and the given id", () => {
        const row = buildFolderRow("dir:src/vs", "src/vs");
        expect(row.id).toBe("dir:src/vs");

        const backend = renderElement(row, WIDTH, 1);
        expect(backend.getTextAt(new Point(0, 0), 6)).toBe("src/vs");
    });
});

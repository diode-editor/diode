import { describe, expect, it, vi } from "vitest";

import { packRgb } from "../../../../../../tuidom/common/colorUtils.ts";
import { Point } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import { LIST_ROW_ACTIVE_STATE } from "../../../../../../tuidom/ui/list/listViewElement.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { Uri } from "../../../../base/common/uri.ts";

import type { IScmChange } from "./changesService.ts";
import {
    buildFileRow,
    buildFolderRow,
    buildGroupRow,
    formatFileRow,
    type IScmFileRowParts,
    type IScmRowStyles,
    OPEN_FILE_BUTTON_WIDTH,
    OPEN_FILE_GLYPH,
} from "./scmChangeRows.ts";

const MODIFIED = packRgb(226, 192, 141);
const STYLES: IScmRowStyles = {
    statusColors: { "gitDecoration.modifiedResourceForeground": MODIFIED },
};

/** Строка «под курсором/мышью» — состояние ставит список на обёртку строки. */
function activate(parts: IScmFileRowParts): void {
    parts.root.setStyleState(LIST_ROW_ACTIVE_STATE, true);
}

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

    it("shows the label and the right-aligned status letter, without the Open File button", () => {
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, () => undefined);
        const backend = renderElement(parts.root, WIDTH, 1);

        expect(backend.getTextAt(new Point(0, 0), 8)).toBe("src/a.ts");
        // Буква статуса — в последней колонке, цветом gitDecoration.
        expect(backend.getTextAt(new Point(WIDTH - 1, 0), 1)).toBe("M");
        expect(backend.getFgAt(new Point(WIDTH - 1, 0))).toBe(MODIFIED);
        expect(backend.getFgAt(new Point(0, 0))).toBe(MODIFIED);
        // Кнопки в покое нет вовсе — её колонки достались имени.
        expect(backend.getTextAt(new Point(0, 0), WIDTH - 1)).not.toContain(OPEN_FILE_GLYPH);
        expect(parts.openButton.layoutSize.width).toBe(0);
    });

    it("reveals the Open File button while the row is active (hover / focused cursor)", () => {
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, () => undefined);
        activate(parts);
        const backend = renderElement(parts.root, WIDTH, 1);

        // Кнопка занимает колонки слева от буквы статуса.
        const buttonX = WIDTH - 1 - OPEN_FILE_BUTTON_WIDTH;
        expect(backend.getTextAt(new Point(buttonX, 0), OPEN_FILE_BUTTON_WIDTH)).toBe(` ${OPEN_FILE_GLYPH} `);
        expect(parts.openButton.layoutSize.width).toBe(OPEN_FILE_BUTTON_WIDTH);
        // Статус остаётся на своём месте, имя ужимается.
        expect(backend.getTextAt(new Point(WIDTH - 1, 0), 1)).toBe("M");
    });

    it("hides the button again once the row stops being active", () => {
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, () => undefined);
        activate(parts);
        renderElement(parts.root, WIDTH, 1);
        parts.root.setStyleState(LIST_ROW_ACTIVE_STATE, false);
        const backend = renderElement(parts.root, WIDTH, 1);

        expect(parts.openButton.layoutSize.width).toBe(0);
        expect(backend.getTextAt(new Point(0, 0), WIDTH - 1)).not.toContain(OPEN_FILE_GLYPH);
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
        });
        const backend = renderElement(parts.root, WIDTH, 1);

        expect(backend.getFgAt(new Point(0, 0))).toBe(NEW);
        expect(backend.getFgAt(new Point(WIDTH - 1, 0))).toBe(NEW);
    });

    it("button consumes click (calls onOpenFile) and dblclick (no-op)", () => {
        const onOpenFile = vi.fn();
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, onOpenFile);

        const click = new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
        expect(parts.openButton.dispatchEvent(click)).toBe(false); // потреблено
        expect(onOpenFile).toHaveBeenCalledTimes(1);

        const dbl = new TUIMouseEvent("dblclick", { button: "left", screenX: 0, screenY: 0, localX: 0, localY: 0 });
        expect(parts.openButton.dispatchEvent(dbl)).toBe(false);
        expect(onOpenFile).toHaveBeenCalledTimes(1);
    });

    it("button stays out of the focus order — list rows are presentational", () => {
        const parts = buildFileRow("row", change(), "src/a.ts", STYLES, () => undefined);
        expect(parts.root.getDepthFirstFocusableOrder()).toEqual([]);
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

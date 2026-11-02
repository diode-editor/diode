import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../../base/common/uri.ts";
import type { SidebarService } from "../../../../browser/parts/sidebar/sidebarService.ts";
import type { IEditorService } from "../../../../services/editor/common/editorService.ts";
import { NULL_JUMP_RECORDER } from "../../../../services/history/browser/historyService.ts";
import type { ExplorerService } from "../../../files/browser/explorerService.ts";
import type { ITerminalLink } from "../common/terminalLinkProvider.ts";

import { TerminalLinkOpener } from "./terminalLinkOpener.ts";

// The end-to-end path (Ctrl+click in the frame) is in workbench.terminalLinks.test.ts; here are the cases
// the fake editor service of a unit test reaches more easily.

const A = Uri.file("/ws/a.ts");
const OTHER = Uri.file("/ws/other.ts");

/** A link of the fallback matchers (a path with spaces): no parsed link, the suffix is in the text. */
function fallbackLink(text: string): ITerminalLink {
    return { type: "LocalFile", text, uri: A, parsedLink: undefined, start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
}

/** A window with `active` open; `openUri` makes `opens` active (`null`: the open failed, nothing changes). */
function build(active: Uri | null, opens: Uri | null) {
    let current = active;
    const goToPosition = vi.fn<(line: number, column: number) => void>();
    const group = { findPaneIndex: () => -1 };
    const editors = {
        editorGroups: { activeGroup: group, groups: [group] },
        openUri: vi.fn(() => {
            if (opens !== null) current = opens;
            return Promise.resolve();
        }),
        getActiveEditor: () => (current === null ? null : { uri: current, goToPosition }),
    } as unknown as IEditorService;
    const opener = new TerminalLinkOpener(
        editors,
        NULL_JUMP_RECORDER,
        {} as unknown as SidebarService,
        {} as unknown as ExplorerService,
    );
    return { opener, goToPosition };
}

describe("TerminalLinkOpener", () => {
    it("a link without a parsed suffix takes line and column from its text", async () => {
        const h = build(null, A);
        await h.opener.open(fallbackLink("/ws/my dir/a.ts:3:2"));
        expect(h.goToPosition).toHaveBeenCalledWith(2, 1);
    });

    it("the file failed to open: no editor or another one stays active, and its cursor is left alone", async () => {
        const none = build(null, null);
        await none.opener.open(fallbackLink("/ws/a.ts:3"));
        expect(none.goToPosition).not.toHaveBeenCalled();
        const other = build(OTHER, null);
        await other.opener.open(fallbackLink("/ws/a.ts:3"));
        expect(other.goToPosition).not.toHaveBeenCalled();
    });
});

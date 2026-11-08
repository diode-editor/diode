import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { ClipboardDIToken, type IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { FileClipboardEntry } from "../../../../platform/clipboard/common/iFileClipboard.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { WorkspaceContextService } from "../../../../platform/workspace/common/workspaceContextService.ts";
import { editorTabPathArg, explorerTargetsArg } from "../../../browser/actions/menuContexts.ts";

import { type ExplorerService, ExplorerServiceDIToken } from "./explorerService.ts";
import { buildPasteEdits } from "./fileOperationsService.ts";
import { fileCopyPathAction, fileCopyRelativePathAction } from "./fileTreeClipboardActions.ts";

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
        // A compact row in a multi-selection puts every folder of the chain into the clipboard.
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

function copyPathRig(selected: string[]): { accessor: Container; written: () => string | undefined } {
    let written: string | undefined;
    const accessor = new Container();
    accessor.bind(ExplorerServiceDIToken, () => ({ getSelectedPaths: () => selected }) as unknown as ExplorerService);
    accessor.bind(
        ClipboardDIToken,
        () =>
            ({
                writeText: (text: string) => {
                    written = text;
                    return Promise.resolve();
                },
            }) as unknown as IClipboard,
    );
    const workspace = new WorkspaceContextService();
    workspace.setWorkspaceFolder("/ws");
    accessor.bind(IWorkspaceContextServiceDIToken, () => workspace);
    return { accessor, written: () => written };
}

describe("Copy Path / Copy Relative Path — targets", () => {
    it("from a keybinding: every selected path, one per line, in selection order", async () => {
        const rig = copyPathRig(["/ws/b.txt", "/ws/src/a.ts"]);
        await fileCopyPathAction.run(rig.accessor);
        expect(rig.written()).toBe("/ws/b.txt\n/ws/src/a.ts");
        await fileCopyRelativePathAction.run(rig.accessor);
        expect(rig.written()).toBe(`b.txt\n${path.join("src", "a.ts")}`);
    });

    it("from the explorer menu: the menu's targets", async () => {
        const rig = copyPathRig(["/ws/a.txt"]);
        const [targets] = explorerTargetsArg({
            path: "/ws/c.txt",
            targets: ["/ws/c.txt", "/ws/d.txt"],
            canPaste: false,
        });
        await fileCopyRelativePathAction.run(rig.accessor, targets);
        expect(rig.written()).toBe("c.txt\nd.txt");
    });

    it("from an editor tab: that one path, whatever the explorer selection", async () => {
        const rig = copyPathRig(["/ws/a.txt", "/ws/b.txt"]);
        const [tabPath] = editorTabPathArg({ path: "/ws/tab.txt" });
        await fileCopyPathAction.run(rig.accessor, tabPath);
        expect(rig.written()).toBe("/ws/tab.txt");
    });

    it("nothing selected — the clipboard is left alone", async () => {
        const rig = copyPathRig([]);
        await fileCopyPathAction.run(rig.accessor);
        await fileCopyRelativePathAction.run(rig.accessor);
        expect(rig.written()).toBeUndefined();
    });
});

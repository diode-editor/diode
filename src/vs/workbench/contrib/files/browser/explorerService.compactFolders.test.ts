import { describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";

import { ExplorerService, type IExplorerView } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

// Compact row "src/main/java": the key is the head, `path` is the last folder.
const CHAIN: FileTreeNode = {
    name: "java",
    path: "/w/src/main/java",
    isDirectory: true,
    compactParents: ["/w/src", "/w/src/main"],
};
const PLAIN_DIR: FileTreeNode = { name: "docs", path: "/w/docs", isDirectory: true };
const FILE: FileTreeNode = { name: "a.txt", path: "/w/a.txt", isDirectory: false };

function serviceWith(options: { cursor: FileTreeNode | null; selection?: FileTreeNode[]; segment?: number }) {
    const service = new ExplorerService(
        new InMemoryFileClipboard(),
        createTestConfigurationService(),
        diskFileService(),
        NULL_TREE_FILE_WATCHER,
    );
    const view = {
        refresh: async () => {},
        expand: async () => {},
        reveal: async () => {},
        focus: () => {},
        getSelectedNode: () => options.cursor,
        getSelectedNodes: () => options.selection ?? (options.cursor ? [options.cursor] : []),
        getSegmentIndex: (node: FileTreeNode) => (node === CHAIN ? (options.segment ?? 2) : 0),
        focusPreviousSegment: vi.fn(() => true),
        focusNextSegment: vi.fn(() => true),
        focusFirstSegment: vi.fn(() => true),
        focusLastSegment: vi.fn(() => true),
        setCutKeys: () => {},
        clearCutKeys: () => {},
    } satisfies IExplorerView;
    service.attachView(view);
    return { service, view };
}

describe("ExplorerService — compact row segments", () => {
    it("the row path is the current segment's folder; for a plain row — its path", () => {
        const { service } = serviceWith({ cursor: CHAIN, segment: 1 });
        expect(service.nodePath(CHAIN)).toBe("/w/src/main");
        expect(service.nodePath(PLAIN_DIR)).toBe("/w/docs");
    });

    it("without a view the compact row path is its last folder", () => {
        const service = new ExplorerService(
            new InMemoryFileClipboard(),
            createTestConfigurationService(),
            diskFileService(),
            NULL_TREE_FILE_WATCHER,
        );
        expect(service.nodePath(CHAIN)).toBe("/w/src/main/java");
        for (const target of ["previous", "next", "first", "last"] as const) {
            expect(() => {
                service.moveCompressedFocus(target);
            }).not.toThrow();
        }
    });

    it("selection, paste target and New File go to the current segment's folder", () => {
        const { service } = serviceWith({ cursor: CHAIN, segment: 0 });
        expect(service.getSelectedPaths()).toEqual(["/w/src"]);
        expect(service.getPasteTargetDir()).toBe("/w/src");
    });

    it("multi-select: a compact row yields all folders of the chain, like upstream getContext", () => {
        const { service } = serviceWith({ cursor: CHAIN, selection: [CHAIN, FILE], segment: 0 });
        expect(service.getSelectedPaths()).toEqual(["/w/src", "/w/src/main", "/w/src/main/java", "/w/a.txt"]);
    });

    it("explorerViewletCompressed* keys: first, middle, last segment; plain row — null", () => {
        expect(serviceWith({ cursor: CHAIN, segment: 0 }).service.getCompressedFocus()).toEqual({
            first: true,
            last: false,
        });
        expect(serviceWith({ cursor: CHAIN, segment: 1 }).service.getCompressedFocus()).toEqual({
            first: false,
            last: false,
        });
        expect(serviceWith({ cursor: CHAIN, segment: 2 }).service.getCompressedFocus()).toEqual({
            first: false,
            last: true,
        });
        expect(serviceWith({ cursor: PLAIN_DIR }).service.getCompressedFocus()).toBeNull();
        expect(serviceWith({ cursor: null }).service.getCompressedFocus()).toBeNull();
    });

    it("moveCompressedFocus calls the matching tree method", () => {
        const { service, view } = serviceWith({ cursor: CHAIN });
        service.moveCompressedFocus("previous");
        service.moveCompressedFocus("next");
        service.moveCompressedFocus("first");
        service.moveCompressedFocus("last");
        expect(view.focusPreviousSegment).toHaveBeenCalledTimes(1);
        expect(view.focusNextSegment).toHaveBeenCalledTimes(1);
        expect(view.focusFirstSegment).toHaveBeenCalledTimes(1);
        expect(view.focusLastSegment).toHaveBeenCalledTimes(1);
    });
});

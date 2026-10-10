import { describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";

import { ExplorerService, type IExplorerView } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

// Компактная строка «src/main/java»: ключ — голова, `path` — последняя папка.
const CHAIN: FileTreeNode = {
    name: "java",
    path: "/w/src/main/java",
    isDirectory: true,
    compactParents: ["/w/src", "/w/src/main"],
};
const PLAIN_DIR: FileTreeNode = { name: "docs", path: "/w/docs", isDirectory: true };
const FILE: FileTreeNode = { name: "a.txt", path: "/w/a.txt", isDirectory: false };

/** View, у которого курсор на `cursor`, выбор — `selection`, текущий сегмент — `segment`. */
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

describe("ExplorerService — сегменты компактной строки", () => {
    it("путь строки — папка текущего сегмента; у обычной строки — её путь", () => {
        const { service } = serviceWith({ cursor: CHAIN, segment: 1 });
        expect(service.nodePath(CHAIN)).toBe("/w/src/main");
        expect(service.nodePath(PLAIN_DIR)).toBe("/w/docs");
    });

    it("без view путь компактной строки — её последняя папка", () => {
        const service = new ExplorerService(
            new InMemoryFileClipboard(),
            createTestConfigurationService(),
            diskFileService(),
            NULL_TREE_FILE_WATCHER,
        );
        expect(service.nodePath(CHAIN)).toBe("/w/src/main/java");
        // Команды *CompressedFolder без дерева — no-op.
        for (const target of ["previous", "next", "first", "last"] as const) {
            expect(() => {
                service.moveCompressedFocus(target);
            }).not.toThrow();
        }
    });

    it("выбор, цель вставки и New File идут в папку текущего сегмента", () => {
        const { service } = serviceWith({ cursor: CHAIN, segment: 0 });
        expect(service.getSelectedPaths()).toEqual(["/w/src"]);
        expect(service.getPasteTargetDir()).toBe("/w/src");
    });

    it("мультивыбор: компактная строка отдаёт все папки цепочки, как getContext эталона", () => {
        const { service } = serviceWith({ cursor: CHAIN, selection: [CHAIN, FILE], segment: 0 });
        expect(service.getSelectedPaths()).toEqual(["/w/src", "/w/src/main", "/w/src/main/java", "/w/a.txt"]);
    });

    it("ключи explorerViewletCompressed*: первый, середина, последний сегмент; обычная строка — null", () => {
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

    it("moveCompressedFocus зовёт соответствующий метод дерева", () => {
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

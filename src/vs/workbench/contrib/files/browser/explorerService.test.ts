import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import { createConfigurationChangeEvent } from "../../../../platform/configuration/common/configurationChangeEvent.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_TREE_FILE_WATCHER } from "../../../../platform/files/common/iTreeFileWatcher.ts";
import type { LogEntry } from "../../../../platform/log/common/iLogService.ts";

import { ExplorerService, type IExplorerView } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

function createService(options?: {
    clipboard?: InMemoryFileClipboard;
    configurationService?: IConfigurationService;
}): ExplorerService {
    return new ExplorerService(
        options?.clipboard ?? new InMemoryFileClipboard(),
        options?.configurationService ?? createTestConfigurationService(),
        diskFileService(),
        NULL_TREE_FILE_WATCHER,
    );
}

function fakeView(overrides?: Partial<IExplorerView>): IExplorerView & {
    refreshCount: number;
    revealed: FileTreeNode[][];
    expanded: string[];
    focused: number;
    cutKeys: Set<string> | null;
} {
    const view = {
        refreshCount: 0,
        revealed: [] as FileTreeNode[][],
        expanded: [] as string[],
        focused: 0,
        cutKeys: null as Set<string> | null,
        refresh: async () => {
            view.refreshCount++;
        },
        expand: async (element: FileTreeNode) => {
            view.expanded.push(element.path);
        },
        reveal: async (chain: FileTreeNode[]) => {
            view.revealed.push(chain);
        },
        focus: () => {
            view.focused++;
        },
        getSelectedNode: (): FileTreeNode | null => null,
        getSelectedNodes: (): FileTreeNode[] => [],
        getSegmentIndex: () => 0,
        focusPreviousSegment: () => false,
        focusNextSegment: () => false,
        focusFirstSegment: () => false,
        focusLastSegment: () => false,
        setCutKeys: (keys: Set<string>) => {
            view.cutKeys = keys;
        },
        clearCutKeys: () => {
            view.cutKeys = null;
        },
        ...overrides,
    };
    return view;
}

describe("ExplorerService — operations before the root/tree is assigned", () => {
    it("returns an empty selection and a null paste target without a view", () => {
        const service = createService();

        expect(service.provider).toBeNull();
        expect(service.getSelectedPaths()).toEqual([]);
        expect(service.getPasteTargetDir()).toBeNull();
        expect(() => {
            service.focus();
        }).not.toThrow();
        service.dispose();
    });

    it("refresh() is a no-op before a view is attached", async () => {
        const service = createService();
        await expect(service.refresh()).resolves.toBeUndefined();
        service.dispose();
    });

    it("cut-highlight from the file clipboard is a no-op without a view", () => {
        const clipboard = new InMemoryFileClipboard();
        const service = createService({ clipboard });
        expect(() => {
            clipboard.write(["/x"], "cut");
            clipboard.clear();
        }).not.toThrow();
        service.dispose();
    });

    it("setFileDecorations without a provider/view is a no-op", () => {
        const service = createService();
        expect(() => {
            service.setFileDecorations([{ path: "/x", color: 0x73c991, badge: "M" }]);
        }).not.toThrow();
        service.dispose();
    });
});

describe("ExplorerService — view seam (IExplorerView)", () => {
    it("delegates focus/refresh/selection to the attached view", async () => {
        const service = createService();
        const view = fakeView({
            getSelectedNodes: () => [
                { name: "a.ts", path: "/root/a.ts", isDirectory: false },
                { name: "b", path: "/root/b", isDirectory: true },
            ],
        });
        service.attachView(view);

        service.focus();
        await service.refresh();
        expect(view.focused).toBe(1);
        expect(view.refreshCount).toBe(1);
        expect(service.getSelectedPaths()).toEqual(["/root/a.ts", "/root/b"]);
        service.dispose();
    });

    it("cut-highlight follows the file clipboard: cut sets keys, copy/clear removes them", () => {
        const clipboard = new InMemoryFileClipboard();
        const service = createService({ clipboard });
        const view = fakeView();
        service.attachView(view);

        clipboard.write(["/root/a.ts"], "cut");
        expect(view.cutKeys).toEqual(new Set(["/root/a.ts"]));

        // Copy mode clears the highlight (empty path list → clearCutKeys).
        clipboard.write(["/root/a.ts"], "copy");
        expect(view.cutKeys).toBeNull();

        clipboard.write(["/root/b.ts"], "cut");
        expect(view.cutKeys).toEqual(new Set(["/root/b.ts"]));
        clipboard.clear();
        expect(view.cutKeys).toBeNull();
        service.dispose();
    });

    it("paste target: directory node → itself, file node → its parent, none → root", () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-" });
        const service = createService();
        service.setRootPath(ws.dir);

        const view = fakeView();
        service.attachView(view);
        expect(service.getPasteTargetDir()).toBe(ws.dir);

        service.attachView(
            fakeView({ getSelectedNode: () => ({ name: "dir", path: "/root/dir", isDirectory: true }) }),
        );
        expect(service.getPasteTargetDir()).toBe("/root/dir");

        service.attachView(
            fakeView({ getSelectedNode: () => ({ name: "a.ts", path: "/root/dir/a.ts", isDirectory: false }) }),
        );
        expect(service.getPasteTargetDir()).toBe("/root/dir");

        service.dispose();
        ws.dispose();
    });

    it("getSelectedFilePath: file → path, directory and empty tree → null (Open to the Side)", () => {
        const service = createService();

        expect(service.getSelectedFilePath()).toBeNull();

        service.attachView(
            fakeView({ getSelectedNode: () => ({ name: "a.ts", path: "/root/dir/a.ts", isDirectory: false }) }),
        );
        expect(service.getSelectedFilePath()).toBe("/root/dir/a.ts");

        service.attachView(
            fakeView({ getSelectedNode: () => ({ name: "dir", path: "/root/dir", isDirectory: true }) }),
        );
        expect(service.getSelectedFilePath()).toBeNull();

        service.dispose();
    });

    it("revealPath with a tree but no root — false, the tree is untouched", async () => {
        const service = createService();
        const view = fakeView();
        service.attachView(view);

        expect(await service.revealPath("/anything/x.ts")).toBe(false);
        expect(view.expanded).toEqual([]);
        expect(view.revealed).toEqual([]);
        service.dispose();
    });

    it("revealPath builds the ancestor chain and passes it to the view", async () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-reveal-" });
        const service = createService();
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);

        const target = path.join(ws.dir, "src", "deep", "x.ts");
        expect(await service.revealPath(target)).toBe(true);
        expect(view.revealed).toEqual([
            [
                { name: "src", path: path.join(ws.dir, "src"), isDirectory: true },
                { name: "deep", path: path.join(ws.dir, "src", "deep"), isDirectory: true },
                { name: "x.ts", path: target, isDirectory: false },
            ],
        ]);
        // Ancestors are expanded along the way, before reveal: expansion decides
        // which row comes next (compact chains).
        expect(view.expanded).toEqual([path.join(ws.dir, "src"), path.join(ws.dir, "src", "deep")]);
        service.dispose();
        ws.dispose();
    });

    it("a chain row lagging behind the provider does not stop the descent: reveal reaches the file", async () => {
        // The provider knows the chain pkg → pkg/a → pkg/a/b, but the row from findNode doesn't (`path` is
        // the head), and `expand` of an expanded key won't update it: reveal looped on microtasks.
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-reveal-stale-" });
        const service = createService();
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);
        const head = path.join(ws.dir, "pkg");
        const chainDirs = [head, path.join(head, "a"), path.join(head, "a", "b")];
        const staleRow: FileTreeNode = { name: "pkg", path: head, isDirectory: true };
        if (!service.provider) throw new Error("provider not created");
        let calls = 0;
        vi.spyOn(service.provider, "findNode").mockImplementation((dirPath) => {
            // The regression is an endless loop, not an error: break it so the test fails instead of hanging.
            if (++calls > 100) throw new Error("revealChain makes no progress through the tree");
            return chainDirs.includes(dirPath) ? staleRow : undefined;
        });

        const target = path.join(head, "a", "b", "C.java");
        expect(await service.revealPath(target)).toBe(true);
        // The chain row appears once: no need to expand and select it again.
        expect(view.revealed).toEqual([[staleRow, { name: "C.java", path: target, isDirectory: false }]]);
        expect(view.expanded).toEqual([head]);
        service.dispose();
        ws.dispose();
    });

    it("an expanded compact row sends the descent straight to its last folder, past the intermediate ones", async () => {
        // After expansion the "pkg/a/b" row points at the last folder, while the
        // provider no longer recognizes the intermediate ones (it may have forgotten
        // the chain, the row hasn't yet). Descending one segment at a time would hand
        // the tree rows "pkg/a" and "pkg/a/b" that it doesn't have.
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-reveal-jump-" });
        const service = createService();
        service.setRootPath(ws.dir);
        const head = path.join(ws.dir, "pkg");
        const last = path.join(head, "a", "b");
        const row: FileTreeNode = { name: "pkg", path: head, isDirectory: true };
        const view = fakeView({
            expand: async (element) => {
                view.expanded.push(element.path);
                if (element === row) {
                    row.name = "b";
                    row.path = last;
                    row.compactParents = [head, path.join(head, "a")];
                }
            },
        });
        service.attachView(view);
        if (!service.provider) throw new Error("provider not created");
        vi.spyOn(service.provider, "findNode").mockImplementation((dirPath) => (dirPath === head ? row : undefined));

        const target = path.join(last, "C.java");
        expect(await service.revealPath(target)).toBe(true);
        expect(view.revealed).toEqual([[row, { name: "C.java", path: target, isDirectory: false }]]);
        expect(view.expanded).toEqual([head]);
        service.dispose();
        ws.dispose();
    });
});

describe("ExplorerService — autoRevealActiveFile", () => {
    function configWith(autoReveal: boolean | undefined): IConfigurationService {
        return createTestConfigurationService(autoReveal === undefined ? {} : { "explorer.autoReveal": autoReveal });
    }

    it("reveals the active file when explorer.autoReveal is on (default)", async () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-auto-" });
        const service = createService({ configurationService: configWith(undefined) });
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);

        service.autoRevealActiveFile(path.join(ws.dir, "a.ts"));
        // reveal is async: ancestors are expanded along the way (compact chains).
        await vi.waitFor(() => {
            expect(view.revealed).toHaveLength(1);
        });
        service.dispose();
        ws.dispose();
    });

    it("does nothing when explorer.autoReveal is off", () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-auto-off-" });
        const service = createService({ configurationService: configWith(false) });
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);

        service.autoRevealActiveFile(path.join(ws.dir, "a.ts"));
        expect(view.revealed).toEqual([]);
        service.dispose();
        ws.dispose();
    });

    it("does nothing without an active file path", () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-auto-null-" });
        const service = createService();
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);

        service.autoRevealActiveFile(null);
        expect(view.revealed).toEqual([]);
        service.dispose();
        ws.dispose();
    });
});

describe("ExplorerService — files.exclude", () => {
    function emittingConfig(values: Record<string, unknown>): IConfigurationService & {
        set(key: string, value: unknown): void;
    } {
        const listeners: ((event: IConfigurationChangeEvent) => void)[] = [];
        return {
            ...NULL_CONFIGURATION_SERVICE,
            get: (key: string) => values[key] as never,
            onDidChangeConfiguration: (listener: (event: IConfigurationChangeEvent) => void) => {
                listeners.push(listener);
                return {
                    dispose: () => {
                        /* the subscription lives until the end of the test */
                    },
                };
            },
            set: (key: string, value: unknown) => {
                values[key] = value;
                const event = createConfigurationChangeEvent([key]);
                for (const listener of [...listeners]) listener(event);
            },
        };
    }

    it("the tree provider hides entries by the setting's patterns", async () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-exclude-" });
        ws.writeFile("__pycache__/app.cpython-312.pyc", "");
        ws.writeFile("app.py", "");
        const service = createService({
            configurationService: emittingConfig({ "files.exclude": { "**/__pycache__": true } }),
        });

        service.setRootPath(ws.dir);

        expect((await service.provider?.getChildren())?.map((n) => n.name)).toEqual(["app.py"]);
        service.dispose();
        ws.dispose();
    });

    it("editing the setting re-reads the tree — no restart", () => {
        const config = emittingConfig({ "files.exclude": { "**/__pycache__": true } });
        const service = createService({ configurationService: config });
        const view = fakeView();
        service.attachView(view);

        config.set("files.exclude", { "**/__pycache__": false });

        expect(view.refreshCount).toBe(1);
        service.dispose();
    });

    it("an unrelated setting does not touch the tree", () => {
        const config = emittingConfig({});
        const service = createService({ configurationService: config });
        const view = fakeView();
        service.attachView(view);

        config.set("editor.tabSize", 2);

        expect(view.refreshCount).toBe(0);
        service.dispose();
    });

    it("explorer.decorations.* rebuilds decorations, an unrelated setting does not", () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-deco-settings-" });
        const config = emittingConfig({ "explorer.decorations.colors": true, "explorer.decorations.badges": true });
        const service = createService({ configurationService: config });
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);
        service.setFileDecorations([{ path: ws.path("a.ts"), badge: "M" }]);
        expect(view.refreshCount).toBe(1);

        config.set("editor.tabSize", 2);
        expect(view.refreshCount).toBe(1);

        config.set("explorer.decorations.badges", false);
        expect(view.refreshCount).toBe(2);
        config.set("explorer.decorations.colors", false);
        expect(view.refreshCount).toBe(3);
        service.dispose();
        ws.dispose();
    });
});

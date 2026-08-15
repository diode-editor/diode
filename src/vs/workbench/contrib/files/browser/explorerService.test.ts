import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { InMemoryFileClipboard } from "../../../../platform/clipboard/common/inMemoryFileClipboard.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import type { LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { LogService } from "../../../../platform/log/common/logService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";

import { ExplorerService, type IExplorerView } from "./explorerService.ts";
import type { FileTreeNode } from "./fileTreeDataProvider.ts";

function createService(options?: {
    clipboard?: InMemoryFileClipboard;
    configurationService?: IConfigurationService;
    logService?: LogService;
}): ExplorerService {
    return new ExplorerService(
        options?.clipboard ?? new InMemoryFileClipboard(),
        options?.configurationService ?? NULL_CONFIGURATION_SERVICE,
        options?.logService ?? NULL_LOG_SERVICE,
    );
}

/** Наблюдаемый фейковый view дерева (шов IExplorerView). */
function fakeView(overrides?: Partial<IExplorerView>): IExplorerView & {
    refreshCount: number;
    revealed: FileTreeNode[][];
    focused: number;
    cutKeys: Set<string> | null;
} {
    const view = {
        refreshCount: 0,
        revealed: [] as FileTreeNode[][],
        focused: 0,
        cutKeys: null as Set<string> | null,
        refresh: async () => {
            view.refreshCount++;
        },
        reveal: async (chain: FileTreeNode[]) => {
            view.revealed.push(chain);
        },
        focus: () => {
            view.focused++;
        },
        getSelectedNode: (): FileTreeNode | null => null,
        getSelectedNodes: (): FileTreeNode[] => [],
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

describe("ExplorerService — операции до присвоения корня/дерева", () => {
    it("returns an empty selection and a null paste target without a view", () => {
        const service = createService();

        expect(service.hasRootPath()).toBe(false);
        expect(service.getRootPath()).toBeNull();
        expect(service.getSelectedPaths()).toEqual([]);
        expect(service.getPasteTargetDir()).toBeNull();
        // Фокус и refresh без дерева — no-op, не должны падать.
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
        // Подсветка «вырезанных» без дерева — no-op, не должна падать.
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

describe("ExplorerService — view-шов (IExplorerView)", () => {
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

        // Режим copy подсветку снимает (пустой список путей → clearCutKeys).
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

    it("getSelectedFilePath: файл → путь, каталог и пустое дерево → null (Open to the Side)", () => {
        const service = createService();

        // Без view выбранного узла нет.
        expect(service.getSelectedFilePath()).toBeNull();

        service.attachView(
            fakeView({ getSelectedNode: () => ({ name: "a.ts", path: "/root/dir/a.ts", isDirectory: false }) }),
        );
        expect(service.getSelectedFilePath()).toBe("/root/dir/a.ts");

        // Каталог — не файл: открывать «в сторону» нечего.
        service.attachView(
            fakeView({ getSelectedNode: () => ({ name: "dir", path: "/root/dir", isDirectory: true }) }),
        );
        expect(service.getSelectedFilePath()).toBeNull();

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
        service.dispose();
        ws.dispose();
    });
});

describe("ExplorerService — autoRevealActiveFile", () => {
    function configWith(autoReveal: boolean | undefined): IConfigurationService {
        return {
            ...NULL_CONFIGURATION_SERVICE,
            get: <T>(key: string, defaultValue?: T): T | undefined =>
                key === "explorer.autoReveal" ? ((autoReveal ?? defaultValue) as T) : defaultValue,
        };
    }

    it("reveals the active file when explorer.autoReveal is on (default)", () => {
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-auto-" });
        const service = createService({ configurationService: configWith(undefined) });
        service.setRootPath(ws.dir);
        const view = fakeView();
        service.attachView(view);

        service.autoRevealActiveFile(path.join(ws.dir, "a.ts"));
        expect(view.revealed).toHaveLength(1);
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

describe("ExplorerService — file watcher error logging", () => {
    function createWithCapturedLog(): { service: ExplorerService; entries: LogEntry[]; dispose: () => void } {
        const logService = new LogService();
        const entries: LogEntry[] = [];
        logService.onDidAppend((entry) => entries.push(entry));
        const ws = createTempWorkspace({ prefix: "diode-explorer-svc-watch-" });
        const service = createService({ logService });
        service.setRootPath(ws.dir);
        return {
            service,
            entries,
            dispose: () => {
                service.dispose();
                ws.dispose();
            },
        };
    }

    function fireWatchError(service: ExplorerService, dirPath: string, error: Error): void {
        // onWatchError на провайдере присвоен в setRootPath — вызов колбэка
        // эмулирует ошибку watcher'а, всплывшую из chokidar.
        service.provider?.onWatchError?.(dirPath, error);
    }

    it("logs a warn with an inotify hint for ENOSPC", () => {
        const { service, entries, dispose } = createWithCapturedLog();
        const err = Object.assign(new Error("ENOSPC: watch limit reached"), { code: "ENOSPC" });

        fireWatchError(service, "/repo/src", err);

        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.channel).toBe("filetree.watcher");
        expect(entry.message).toContain("increase fs.inotify.max_user_watches");
        expect(entry.args[0]).toMatchObject({ dirPath: "/repo/src", code: "ENOSPC" });
        dispose();
    });

    it("logs a warn with an inotify hint for EMFILE", () => {
        const { service, entries, dispose } = createWithCapturedLog();
        const err = Object.assign(new Error("EMFILE: too many open files"), { code: "EMFILE" });

        fireWatchError(service, "/repo/lib", err);

        expect(entries).toHaveLength(1);
        expect(entries[0].message).toContain("increase fs.inotify.max_user_watches");
        dispose();
    });

    it("logs a warn without a hint for an unrelated error code", () => {
        const { service, entries, dispose } = createWithCapturedLog();
        const err = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });

        fireWatchError(service, "/repo/vendor", err);

        expect(entries).toHaveLength(1);
        expect(entries[0].message).toBe("file watcher error");
        expect(entries[0].args[0]).toMatchObject({ dirPath: "/repo/vendor", code: "EACCES" });
        dispose();
    });
});

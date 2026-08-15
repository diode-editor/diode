import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";

import { EXCLUDED_FS_NAMES, FileSearchService } from "./fileSearchService.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkdir(dir: string, relPath: string): string {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(fullPath, { recursive: true });
    return fullPath;
}

function indexedPaths(service: FileSearchService): string[] {
    return service.search("").map((r) => r.entry.relativePath);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FileSearchService — indexing", () => {
    let ws: ITempWorkspace;
    let service: FileSearchService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-filesearch-index-" });
        service = new FileSearchService();
    });

    afterEach(() => {
        service.dispose();
        ws.dispose();
        vi.useRealTimers();
    });

    describe("activate()", () => {
        it("sets isIndexed to true after the initial walk completes", async () => {
            expect(service.isIndexed).toBe(false);
            await service.activate(ws.dir);
            expect(service.isIndexed).toBe(true);
        });

        it("activate() returns the same promise as `ready`", async () => {
            const p = service.activate(ws.dir);
            await service.ready;
            await p;
            expect(service.isIndexed).toBe(true);
        });

        it("empty directory yields no results", async () => {
            await service.activate(ws.dir);
            expect(service.search("")).toHaveLength(0);
        });

        it("indexes flat list of files", async () => {
            ws.writeFile("alpha.ts", "");
            ws.writeFile("beta.ts", "");
            ws.writeFile("gamma.ts", "");
            await service.activate(ws.dir);

            const names = indexedPaths(service);
            expect(names).toContain("alpha.ts");
            expect(names).toContain("beta.ts");
            expect(names).toContain("gamma.ts");
        });

        it("indexes files recursively", async () => {
            ws.writeFile("src/Controls/AppContainer.ts", "");
            ws.writeFile("src/Common/DiContainer.ts", "");
            ws.writeFile("package.json", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).toContain("src/Controls/AppContainer.ts");
            expect(paths).toContain("src/Common/DiContainer.ts");
            expect(paths).toContain("package.json");
        });

        it("relativePath always uses forward slashes", async () => {
            ws.writeFile("a/b/c.ts", "");
            await service.activate(ws.dir);

            for (const p of indexedPaths(service)) {
                expect(p).not.toContain("\\");
            }
        });

        it("relativePath is relative to rootPath (no leading slash)", async () => {
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            for (const p of indexedPaths(service)) {
                expect(p.startsWith("/")).toBe(false);
            }
        });

        it("absolutePath is an absolute path", async () => {
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            for (const r of service.search("")) {
                expect(path.isAbsolute(r.entry.absolutePath)).toBe(true);
            }
        });

        it("does not index directories, only files", async () => {
            mkdir(ws.dir, "emptyDir");
            ws.writeFile("real.ts", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).not.toContain("emptyDir");
            expect(paths).toContain("real.ts");
        });

        it("tolerates a non-existent root (resolves, empty index)", async () => {
            await service.activate(ws.path("does-not-exist"));
            expect(service.isIndexed).toBe(true);
            expect(service.search("")).toHaveLength(0);
        });
    });

    describe("background / cancellation", () => {
        it("a dispose before the walk runs cancels indexing", async () => {
            ws.writeFile("a.ts", "");
            ws.writeFile("b.ts", "");
            const pending = service.activate(ws.dir);
            service.dispose();
            await pending;

            expect(service.isIndexed).toBe(false);
            expect(service.search("")).toHaveLength(0);
        });

        it("a newer activate supersedes an in-flight one", async () => {
            ws.writeFile("a.ts", "");
            const first = service.activate(ws.dir);
            const second = service.activate(ws.dir);
            await Promise.all([first, second]);

            expect(service.isIndexed).toBe(true);
            expect(indexedPaths(service)).toContain("a.ts");
        });
    });

    describe("refreshIfStale()", () => {
        it("is a no-op before activate (no root)", () => {
            expect(() => {
                service.refreshIfStale();
            }).not.toThrow();
            expect(service.search("")).toHaveLength(0);
        });

        it("does nothing while the index is still fresh", async () => {
            ws.writeFile("a.ts", "");
            await service.activate(ws.dir);

            // Add a file but do not advance time — refresh should skip (throttled).
            ws.writeFile("b.ts", "");
            service.refreshIfStale();
            await service.ready;

            const paths = indexedPaths(service);
            expect(paths).toContain("a.ts");
            expect(paths).not.toContain("b.ts");
        });

        it("does nothing after dispose", async () => {
            await service.activate(ws.dir);
            service.dispose();
            expect(() => {
                service.refreshIfStale();
            }).not.toThrow();
        });

        it("re-walks and picks up new files once stale", async () => {
            ws.writeFile("a.ts", "");
            await service.activate(ws.dir);
            const base = Date.now();

            ws.writeFile("b.ts", "");

            // Jump the clock forward past the staleness window (fake Date only,
            // leaving setImmediate/setTimeout real so the walk still runs).
            vi.useFakeTimers({ toFake: ["Date"] });
            vi.setSystemTime(new Date(base + 60_000));

            service.refreshIfStale();
            await service.ready;

            const paths = indexedPaths(service);
            expect(paths).toContain("a.ts");
            expect(paths).toContain("b.ts");
        });
    });

    describe("re-index reflects filesystem changes", () => {
        it("a removed file is gone after re-activate", async () => {
            const removed = ws.writeFile("to-delete.ts", "");
            ws.writeFile("keep.ts", "");
            await service.activate(ws.dir);
            expect(indexedPaths(service)).toContain("to-delete.ts");

            fs.unlinkSync(removed);
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).not.toContain("to-delete.ts");
            expect(paths).toContain("keep.ts");
        });
    });

    describe("exclusions", () => {
        it("EXCLUDED_FS_NAMES contains node_modules, .git, .DS_Store", () => {
            expect(EXCLUDED_FS_NAMES.has("node_modules")).toBe(true);
            expect(EXCLUDED_FS_NAMES.has(".git")).toBe(true);
            expect(EXCLUDED_FS_NAMES.has(".DS_Store")).toBe(true);
        });

        it("excludes node_modules directory", async () => {
            ws.writeFile("node_modules/some-pkg/index.js", "");
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
            expect(paths).toContain("src/main.ts");
        });

        it("excludes .git directory", async () => {
            ws.writeFile(".git/COMMIT_EDITMSG", "");
            ws.writeFile("src/main.ts", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths.some((p) => p.includes(".git"))).toBe(false);
        });

        it("does not exclude files just because they start with a dot", async () => {
            ws.writeFile(".eslintrc.json", "");
            await service.activate(ws.dir);

            const paths = indexedPaths(service);
            expect(paths).toContain(".eslintrc.json");
        });
    });
});

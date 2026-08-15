import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import {
    type IUserDataPaths,
    resolveUserDataPaths,
    resolveWorkspaceStatePath,
} from "../../environment/node/userDataPaths.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import type { IStateDescriptor } from "../common/iStateService.ts";

import { loadState, StateService } from "./stateService.ts";

const width: IStateDescriptor<number> = { key: "workbench.sideBar.width", scope: "global", default: 30 };
const wsWidth: IStateDescriptor<number> = { key: "workbench.sideBar.width", scope: "workspace", default: 30 };
const openFiles: IStateDescriptor<string[]> = { key: "workbench.editors.openFiles", scope: "workspace", default: [] };

describe("StateService", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-state-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function paths(profile?: string): IUserDataPaths {
        return resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir, profile });
    }

    it("returns the descriptor default when nothing is stored", () => {
        const svc = loadState(paths());
        expect(svc.get(width)).toBe(30);
        expect(svc.get(openFiles)).toEqual([]);
    });

    it("round-trips global state through flushSync + reload", () => {
        const p = paths();
        const a = loadState(p);
        a.store(width, 42);
        a.flushSync();
        expect(fs.existsSync(p.globalStateFile)).toBe(true);

        const b = loadState(p);
        expect(b.get(width)).toBe(42);
    });

    it("writes plain JSON (not jsonc) with a trailing newline", () => {
        const p = paths();
        const svc = loadState(p);
        svc.store(width, 7);
        svc.flushSync();
        const raw = fs.readFileSync(p.globalStateFile, "utf-8");
        expect(raw.endsWith("\n")).toBe(true);
        expect(JSON.parse(raw)).toMatchObject({ "workbench.sideBar.width": 7 });
    });

    it("isolates the store from caller mutation (clone in and out)", () => {
        const svc = loadState(paths());
        const arr = ["a.ts", "b.ts"];
        svc.store(openFiles, arr);
        arr.push("c.ts"); // mutating the source must not leak into the store
        const read = svc.get(openFiles);
        expect(read).toEqual(["a.ts", "b.ts"]);
        read.push("x.ts"); // mutating the result must not leak either
        expect(svc.get(openFiles)).toEqual(["a.ts", "b.ts"]);
    });

    it("does not resurrect the descriptor default array on mutation", () => {
        const svc = loadState(paths());
        svc.get(openFiles).push("leak.ts");
        expect(openFiles.default).toEqual([]);
    });

    describe("workspace scope", () => {
        it("falls back to the global store until a workspace is opened", () => {
            const p = paths();
            const svc = loadState(p);
            svc.store(wsWidth, 50);
            svc.flushSync();
            // No workspace open → the value landed in the global file.
            expect(JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8"))).toMatchObject({
                "workbench.sideBar.width": 50,
            });
        });

        it("persists per-project state under workspaceStorage/<hash>/state.json", () => {
            const p = paths();
            const folder = "/projects/alpha";
            const a = loadState(p);
            a.openWorkspace(folder);
            a.store(wsWidth, 55);
            a.store(openFiles, ["alpha/main.ts"]);
            a.flushSync();

            const stateFile = resolveWorkspaceStatePath(p.workspaceStorageDir, folder);
            expect(fs.existsSync(stateFile)).toBe(true);

            const b = loadState(p);
            b.openWorkspace(folder);
            expect(b.get(wsWidth)).toBe(55);
            expect(b.get(openFiles)).toEqual(["alpha/main.ts"]);
        });

        it("keeps different projects independent", () => {
            const p = paths();
            const svc = loadState(p);
            svc.openWorkspace("/projects/alpha");
            svc.store(wsWidth, 11);
            svc.openWorkspace("/projects/beta"); // flushes alpha, loads beta
            expect(svc.get(wsWidth)).toBe(30); // beta has no stored value → default
            svc.store(wsWidth, 22);
            svc.flushSync();

            const reopened = loadState(p);
            reopened.openWorkspace("/projects/alpha");
            expect(reopened.get(wsWidth)).toBe(11);
        });
    });

    it("preserves unknown keys written by another/future build", () => {
        const p = paths();
        fs.mkdirSync(path.dirname(p.globalStateFile), { recursive: true });
        fs.writeFileSync(p.globalStateFile, JSON.stringify({ "future.unknown.key": { a: 1 } }));

        const svc = loadState(p);
        svc.store(width, 33);
        svc.flushSync();

        const onDisk = JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8")) as Record<string, unknown>;
        expect(onDisk["future.unknown.key"]).toEqual({ a: 1 });
        expect(onDisk["workbench.sideBar.width"]).toBe(33);
    });

    describe("tolerant load", () => {
        it("treats a corrupt JSON file as empty and logs", () => {
            const p = paths();
            fs.mkdirSync(path.dirname(p.globalStateFile), { recursive: true });
            fs.writeFileSync(p.globalStateFile, "{ this is not json ");
            const logger = fakeLogger();

            const svc = loadState(p, logger);
            expect(svc.get(width)).toBe(30);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Corrupt state file"), expect.anything());
        });

        it("treats a non-object JSON top-level as empty", () => {
            const p = paths();
            fs.mkdirSync(path.dirname(p.globalStateFile), { recursive: true });
            fs.writeFileSync(p.globalStateFile, "[1, 2, 3]");
            const svc = loadState(p);
            expect(svc.get(width)).toBe(30);
        });

        it("logs a non-ENOENT read error and falls back to empty", () => {
            const logger = fakeLogger();
            // Point the global-state path at a directory → readFileSync throws EISDIR.
            const dirAsFile = path.join(ws.dir, "state-as-dir");
            fs.mkdirSync(dirAsFile, { recursive: true });
            const svc = new StateService({
                globalStateFile: dirAsFile,
                workspaceStorageDir: path.join(ws.dir, "wss"),
                logger,
            });
            expect(svc.get(width)).toBe(30);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringContaining("Failed to read state file"),
                expect.anything(),
            );
        });
    });

    it("logs a write failure and keeps the store dirty for retry", () => {
        const logger = fakeLogger();
        // dirname of the state file is a regular file → mkdirSync/writeFileSync fail.
        const blocker = path.join(ws.dir, "blocker");
        fs.writeFileSync(blocker, "x");
        const svc = new StateService({
            globalStateFile: path.join(blocker, "globalState.json"),
            workspaceStorageDir: path.join(ws.dir, "wss"),
            logger,
        });
        svc.store(width, 99);
        svc.flushSync();
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Failed to write state file"),
            expect.anything(),
        );
    });

    describe("versioning / migration", () => {
        it("migrates a value stored under an older version", () => {
            const p = paths();
            const v1: IStateDescriptor<string> = { key: "some.value", scope: "global", default: "def", version: 1 };
            const a = loadState(p);
            a.store(v1, "old-shape");
            a.flushSync();

            const v2: IStateDescriptor<string> = {
                key: "some.value",
                scope: "global",
                default: "def",
                version: 2,
                migrate: (raw, from) => `migrated:${String(raw)}:from${from}`,
            };
            const b = loadState(p);
            expect(b.get(v2)).toBe("migrated:old-shape:from1");
        });

        it("migrates a value that has no recorded version (from 0)", () => {
            const p = paths();
            // Value written by a build that didn't track versions (no $versions key).
            fs.mkdirSync(path.dirname(p.globalStateFile), { recursive: true });
            fs.writeFileSync(p.globalStateFile, JSON.stringify({ "legacy.value": "raw" }));

            const v2: IStateDescriptor<string> = {
                key: "legacy.value",
                scope: "global",
                default: "def",
                version: 2,
                migrate: (raw, from) => `migrated:${String(raw)}:from${from}`,
            };
            expect(loadState(p).get(v2)).toBe("migrated:raw:from0");
        });

        it("does not migrate when the stored version matches", () => {
            const p = paths();
            const migrate = vi.fn((raw: unknown) => `should-not-run:${String(raw)}`);
            const v2: IStateDescriptor<string> = { key: "k", scope: "global", default: "d", version: 2, migrate };
            const a = loadState(p);
            a.store(v2, "current");
            a.flushSync();

            const b = loadState(p);
            expect(b.get(v2)).toBe("current");
            expect(migrate).not.toHaveBeenCalled();
        });
    });

    it("is a no-op flushSync when nothing is dirty", () => {
        const p = paths();
        const svc = loadState(p);
        svc.flushSync(); // no store() beforehand → no timer, nothing to write
        expect(fs.existsSync(p.globalStateFile)).toBe(false);
    });

    it("logs an async write failure and keeps the store dirty for the next flush", async () => {
        const logger = fakeLogger();
        // At construction the dir is missing → read is a silent ENOENT (no log). We then
        // plant a FILE where the dir should be, so the debounced write's mkdir fails.
        const subAsFile = path.join(ws.dir, "async-sub");
        const svc = new StateService({
            globalStateFile: path.join(subAsFile, "globalState.json"),
            workspaceStorageDir: path.join(ws.dir, "wss"),
            logger,
            writeDebounceMs: 5,
        });
        fs.writeFileSync(subAsFile, "x");
        svc.store(width, 5);
        await waitFor(() => (logger.error as ReturnType<typeof vi.fn>).mock.calls.length > 0);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Failed to write state file"),
            expect.anything(),
        );
    });

    it("writes dirty stores on the debounced timer (without an explicit flush)", async () => {
        const p = paths();
        const svc = new StateService({
            globalStateFile: p.globalStateFile,
            workspaceStorageDir: p.workspaceStorageDir,
            writeDebounceMs: 5,
        });
        svc.store(width, 88);
        expect(fs.existsSync(p.globalStateFile)).toBe(false); // not yet — debounced
        await waitFor(() => fs.existsSync(p.globalStateFile));
        expect(JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8"))).toMatchObject({
            "workbench.sideBar.width": 88,
        });
    });
});

async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition not met in time");
        await new Promise((r) => setTimeout(r, 5));
    }
}

function fakeLogger(): ILogger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => false,
    };
}

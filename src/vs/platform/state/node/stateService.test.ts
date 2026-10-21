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
import { computeWorkspaceId, EMPTY_WINDOW_WORKSPACE_ID } from "../../workspace/common/workspaceId.ts";
import type { IStateDescriptor } from "../common/iStateService.ts";
import { NULL_STATE_SERVICE } from "../common/nullStateService.ts";

import {
    loadApplicationState,
    loadState as loadStateReal,
    StateFileStore,
    StateService,
    WRITE_DEBOUNCE_MS,
} from "./stateService.ts";

const width: IStateDescriptor<number> = { key: "workbench.sideBar.width", scope: "global", default: 30 };
const wsWidth: IStateDescriptor<number> = { key: "workbench.sideBar.width", scope: "workspace", default: 30 };
const openFiles: IStateDescriptor<string[]> = { key: "workbench.editors.openFiles", scope: "workspace", default: [] };

describe("StateService", () => {
    let ws: ITempWorkspace;
    /** `afterEach` silences them BEFORE removing the directory: a late debounced write would recreate it in `os.tmpdir()`. */
    let writers: StateService[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-state-" });
        writers = [];
    });

    afterEach(() => {
        for (const writer of writers) writer.dispose();
        ws.dispose();
    });

    function loadState(...args: Parameters<typeof loadStateReal>): StateService {
        const state = loadStateReal(...args);
        writers.push(state);
        return state;
    }

    function newStateService(...args: ConstructorParameters<typeof StateService>): StateService {
        const state = new StateService(...args);
        writers.push(state);
        return state;
    }

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
        it("an empty window writes the workspace scope to its empty-window store and leaves global alone", () => {
            const p = paths();
            const svc = loadState(p);
            svc.store(wsWidth, 50);
            svc.flushSync();

            const emptyWindowFile = resolveWorkspaceStatePath(p.workspaceStorageDir, EMPTY_WINDOW_WORKSPACE_ID);
            expect(JSON.parse(fs.readFileSync(emptyWindowFile, "utf-8"))).toMatchObject({
                "workbench.sideBar.width": 50,
            });
            expect(fs.existsSync(p.globalStateFile)).toBe(false);
            expect(loadState(p).get(wsWidth)).toBe(50);
        });

        it("an untouched empty-window store is not written to disk, neither on flushSync nor by timer", async () => {
            const p = paths();
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 0,
            });
            const emptyWindowFile = resolveWorkspaceStatePath(p.workspaceStorageDir, EMPTY_WINDOW_WORKSPACE_ID);

            svc.flushSync();
            expect(fs.existsSync(emptyWindowFile)).toBe(false);

            // Writing only a global key wakes the shared timer; it doesn't touch the empty window's store.
            svc.store(width, 44);
            await vi.waitFor(() => {
                expect(fs.existsSync(p.globalStateFile)).toBe(true);
            });
            expect(fs.existsSync(emptyWindowFile)).toBe(false);
        });

        it("openWorkspace switches from the empty window to the project, flushing the empty-window store", () => {
            const p = paths();
            const svc = loadState(p);
            svc.store(wsWidth, 40);
            svc.openWorkspace(computeWorkspaceId("/projects/alpha"));

            // The project has its own store: the empty window's value didn't leak into it…
            expect(svc.get(wsWidth)).toBe(30);
            // …and the value itself is already on disk, without flushSync.
            const emptyWindowFile = resolveWorkspaceStatePath(p.workspaceStorageDir, EMPTY_WINDOW_WORKSPACE_ID);
            expect(JSON.parse(fs.readFileSync(emptyWindowFile, "utf-8"))).toMatchObject({
                "workbench.sideBar.width": 40,
            });
        });

        it("onDidOpenWorkspace fires after the project store is loaded", () => {
            const p = paths();
            const folder = computeWorkspaceId("/projects/alpha");
            const seed = loadState(p);
            seed.openWorkspace(folder);
            seed.store(wsWidth, 55);
            seed.flushSync();

            const svc = loadState(p);
            const seen: { id: string; width: number }[] = [];
            svc.onDidOpenWorkspace((id) => {
                // The listener already reads the project's store, not the empty window's.
                seen.push({ id, width: svc.get(wsWidth) });
            });
            svc.openWorkspace(folder);

            expect(seen).toEqual([{ id: folder, width: 55 }]);
        });

        it("persists per-project state under workspaceStorage/<workspaceId>/state.json", () => {
            const p = paths();
            // The argument is the workspace identity, not the folder path (see computeWorkspaceId).
            const folder = computeWorkspaceId("/projects/alpha");
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
            svc.openWorkspace(computeWorkspaceId("/projects/alpha"));
            svc.store(wsWidth, 11);
            svc.openWorkspace(computeWorkspaceId("/projects/beta"));
            expect(svc.get(wsWidth)).toBe(30);
            svc.store(wsWidth, 22);
            svc.flushSync();

            const reopened = loadState(p);
            reopened.openWorkspace(computeWorkspaceId("/projects/alpha"));
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

    describe("remove", () => {
        it("removes the key and its version: get returns the default, the file has no empty leftovers", () => {
            const p = paths();
            const versioned: IStateDescriptor<string> = { key: "ext.v", scope: "global", default: "def", version: 2 };
            const svc = loadState(p);
            svc.store(versioned, "value");
            svc.store(width, 41);

            svc.remove(versioned);
            svc.flushSync();

            expect(svc.get(versioned)).toBe("def");
            expect(JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8"))).toEqual({ "workbench.sideBar.width": 41 });
        });

        it("sibling versions stay; removing a key without a version leaves them alone", () => {
            const p = paths();
            const a: IStateDescriptor<string> = { key: "a", scope: "global", default: "", version: 1 };
            const b: IStateDescriptor<string> = { key: "b", scope: "global", default: "", version: 3 };
            const svc = loadState(p);
            svc.store(a, "x");
            svc.store(b, "y");
            svc.store(width, 7);

            svc.remove(a);
            svc.remove(width);
            svc.flushSync();

            expect(JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8"))).toEqual({ b: "y", $versions: { b: 3 } });
        });

        it("removal in the workspace scope edits the open project's store, and the write happens by timer", async () => {
            const p = paths();
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 0,
            });
            const folder = computeWorkspaceId("/projects/rm");
            svc.openWorkspace(folder);
            svc.store(wsWidth, 33);
            svc.flushSync();

            svc.remove(wsWidth);

            const stateFile = resolveWorkspaceStatePath(p.workspaceStorageDir, folder);
            await vi.waitFor(() => {
                expect(JSON.parse(fs.readFileSync(stateFile, "utf-8"))).toEqual({});
            });
        });

        it("remove on the stub is a no-op", () => {
            expect(() => {
                NULL_STATE_SERVICE.remove(width);
            }).not.toThrow();
            expect(NULL_STATE_SERVICE.get(width)).toBe(30);
        });
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
            const svc = newStateService({
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
        const svc = newStateService({
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
        // The store stayed dirty: with the obstacle gone, the next flush writes it.
        fs.rmSync(blocker);
        svc.flushSync();
        expect(JSON.parse(fs.readFileSync(path.join(blocker, "globalState.json"), "utf-8"))).toMatchObject({
            "workbench.sideBar.width": 99,
        });
    });

    it("without a logger a write failure does not crash flushSync, the data waits for the next flush", () => {
        const blocker = path.join(ws.dir, "blocker");
        fs.writeFileSync(blocker, "x");
        const store = new StateFileStore(path.join(blocker, "s.json"));
        store.store(width, 7);
        expect(() => {
            store.flushSync();
        }).not.toThrow();
        fs.rmSync(blocker);
        store.flushSync();
        expect(JSON.parse(fs.readFileSync(path.join(blocker, "s.json"), "utf-8"))).toMatchObject({
            "workbench.sideBar.width": 7,
        });
        store.dispose();
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
        const svc = newStateService({
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
        // The store stayed dirty: with the obstacle gone, the next flush writes it.
        fs.rmSync(subAsFile);
        svc.flushSync();
        expect(JSON.parse(fs.readFileSync(path.join(subAsFile, "globalState.json"), "utf-8"))).toMatchObject({
            "workbench.sideBar.width": 5,
        });
    });

    it("writes dirty stores on the debounced timer (without an explicit flush)", async () => {
        const p = paths();
        const svc = newStateService({
            globalStateFile: p.globalStateFile,
            workspaceStorageDir: p.workspaceStorageDir,
            writeDebounceMs: 5,
        });
        svc.store(width, 88);
        expect(fs.existsSync(p.globalStateFile)).toBe(false); // not yet — debounced
        // Wait for PARSEABLE contents, not just the file's existence: the write goes through
        // `fs.promises.writeFile`, so the path appears immediately with O_CREAT while the data
        // arrives later. Waiting on `existsSync` hit that gap and failed on
        // `JSON.parse("")`, rarely and only under full-run load.
        const onDisk = await waitForJson(p.globalStateFile);
        expect(onDisk).toMatchObject({ "workbench.sideBar.width": 88 });
    });

    describe("dispose", () => {
        it("cancels the scheduled write: nothing is written even after a pause", async () => {
            const p = paths();
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 5,
            });
            svc.store(width, 88);
            svc.dispose();

            await sleep(40); // with margin over the debounce
            expect(fs.existsSync(p.globalStateFile)).toBe(false);
        });

        it("after dispose a new store does not schedule a write again", async () => {
            const p = paths();
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 5,
            });
            svc.dispose();
            svc.store(width, 88);

            await sleep(40);
            expect(fs.existsSync(p.globalStateFile)).toBe(false);
            // The store remains a working reader: silencing the writer doesn't break `get`.
            expect(svc.get(width)).toBe(88);
        });

        it("a removed directory is not resurrected by a deferred write (regression: garbage in os.tmpdir)", async () => {
            // Exactly the sequence a temp directory owner uses to clean up:
            // the writer schedules a pending write, the owner silences the
            // writer and removes the directory. Before this fix, `mkdir` with
            // `recursive` inside `writeStoreAsync` recreated the path AFTER
            // `rmSync`, and the directory stayed in `os.tmpdir()` forever.
            const home = path.join(ws.dir, "doomed");
            const p = resolveUserDataPaths({ homedir: "/never", userDataDir: home });
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 5,
            });
            svc.openWorkspace(computeWorkspaceId("/projects/alpha"));
            svc.store(wsWidth, 42);

            svc.dispose();
            fs.rmSync(home, { recursive: true, force: true });

            await sleep(40);
            expect(fs.existsSync(home)).toBe(false);
        });

        it("cancels ALL scheduled writes, not just the last one", async () => {
            const p = paths();
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 5,
            });
            // Three `store` calls in a row: the debounce must keep ONE timer for all.
            // If each one schedules its own, `dispose` cancels only the last,
            // and the rest write the file after the directory is removed.
            svc.store(width, 1);
            svc.store(width, 2);
            svc.store(width, 3);
            svc.dispose();

            await sleep(40);
            expect(fs.existsSync(p.globalStateFile)).toBe(false);
        });

        it("after dispose the openWorkspace event does not reach subscribers", () => {
            const svc = loadState(paths());
            const seen: string[] = [];
            svc.onDidOpenWorkspace((id) => seen.push(id));

            svc.openWorkspace(computeWorkspaceId("/projects/alpha"));
            expect(seen).toHaveLength(1);

            svc.dispose();
            svc.openWorkspace(computeWorkspaceId("/projects/beta"));

            expect(seen).toHaveLength(1); // no second event: the emitter is disposed
        });

        it("flushSync remains the way to write; dispose does not replace it", () => {
            const p = paths();
            const svc = loadState(p);
            svc.store(width, 7);
            svc.flushSync();
            svc.dispose();
            expect(JSON.parse(fs.readFileSync(p.globalStateFile, "utf-8"))).toMatchObject({
                "workbench.sideBar.width": 7,
            });
        });
    });

    describe("application scope", () => {
        const profiles: IStateDescriptor<string[]> = { key: "userDataProfiles", scope: "application", default: [] };

        it("lives in User/globalStorage/storage.json, outside the profile, and survives a restart", () => {
            const p = paths("work");
            const svc = loadState(p);
            svc.store(profiles, ["work"]);
            svc.flushSync();
            expect(p.applicationStateFile.endsWith(path.join("User", "globalStorage", "storage.json"))).toBe(true);
            expect(JSON.parse(fs.readFileSync(p.applicationStateFile, "utf-8"))).toEqual({
                userDataProfiles: ["work"],
            });
            // Another profile reads the same file: one store per installation.
            expect(loadState(paths("home")).get(profiles)).toEqual(["work"]);
            // The key didn't land in the profile's global store.
            expect(fs.existsSync(p.globalStateFile)).toBe(false);
        });

        it("adopts the store read before the service is built: the file has a single writer", () => {
            const p = paths();
            const application = loadApplicationState(p.applicationStateFile);
            application.store(profiles, ["early"]);
            const svc = loadState(p, undefined, application);
            // Same instance: what was written before the service is visible through it without disk.
            expect(svc.get(profiles)).toEqual(["early"]);
            svc.store(profiles, ["late"]);
            expect(application.get(profiles)).toEqual(["late"]);
            svc.flushSync();
            expect(JSON.parse(fs.readFileSync(p.applicationStateFile, "utf-8"))).toEqual({
                userDataProfiles: ["late"],
            });
        });

        it("without a file the store is in-memory only: writes nothing and does not fail", async () => {
            const p = paths();
            const logger = fakeLogger();
            const svc = newStateService({
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                logger,
                writeDebounceMs: 5,
            });
            svc.store(profiles, ["mem"]);
            expect(svc.get(profiles)).toEqual(["mem"]);
            svc.remove(profiles);
            expect(svc.get(profiles)).toEqual([]);
            // Neither the pending write (no timer is scheduled) nor flushSync tries to write:
            // there's nowhere to write, which isn't a write failure, so nothing is logged.
            await sleep(20);
            svc.flushSync();
            expect(fs.existsSync(p.applicationStateFile)).toBe(false);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("dispose cancels the deferred write of the application store too", async () => {
            const p = paths();
            const svc = newStateService({
                application: p.applicationStateFile,
                globalStateFile: p.globalStateFile,
                workspaceStorageDir: p.workspaceStorageDir,
                writeDebounceMs: 5,
            });
            svc.store(profiles, ["x"]);
            svc.dispose();
            await sleep(20);
            expect(fs.existsSync(p.applicationStateFile)).toBe(false);
        });

        it("loadApplicationState: a corrupt file gives an empty store and an error in the log", () => {
            const p = paths();
            fs.mkdirSync(path.dirname(p.applicationStateFile), { recursive: true });
            fs.writeFileSync(p.applicationStateFile, "{ nope");
            const logger = fakeLogger();
            const store = loadApplicationState(p.applicationStateFile, logger);
            expect(store.get(profiles)).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Corrupt state file"), expect.anything());
            store.dispose();
        });

        it("StateFileStore writes on its own: debounce without the service, and flushSync", async () => {
            const file = path.join(ws.dir, "store.json");
            const store = new StateFileStore(file, { writeDebounceMs: 5 });
            store.store(profiles, ["a"]);
            expect(await waitForJson(file)).toEqual({ userDataProfiles: ["a"] });
            store.dispose();
            store.store(profiles, ["b"]);
            await sleep(20);
            expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ userDataProfiles: ["a"] });
        });

        it("the default write delay is WRITE_DEBOUNCE_MS", () => {
            const timers = vi.spyOn(globalThis, "setTimeout");
            try {
                const store = new StateFileStore(path.join(ws.dir, "store.json"));
                store.store(profiles, ["a"]);
                expect(timers).toHaveBeenCalledWith(expect.any(Function), WRITE_DEBOUNCE_MS);
                store.dispose();
            } finally {
                timers.mockRestore();
            }
        });

        it("a second store before the write does not schedule its own timer over the first: dispose cancels the only one", async () => {
            const file = path.join(ws.dir, "store.json");
            const store = new StateFileStore(file, { writeDebounceMs: 5 });
            store.store(profiles, ["a"]);
            store.store(profiles, ["a", "b"]);
            store.dispose();
            await sleep(20);
            expect(fs.existsSync(file)).toBe(false);
        });

        it("open: the previous file is flushed synchronously, the new one is not created until written to", async () => {
            const a = path.join(ws.dir, "a.json");
            const b = path.join(ws.dir, "b.json");
            const store = new StateFileStore(a, { writeDebounceMs: 5 });
            store.store(profiles, ["a"]);
            store.open(b);
            expect(JSON.parse(fs.readFileSync(a, "utf-8"))).toEqual({ userDataProfiles: ["a"] });
            expect(store.get(profiles)).toEqual([]);
            // The timer scheduled before open is cancelled along with writing the previous file.
            await sleep(20);
            expect(fs.existsSync(b)).toBe(false);
            // The new file is clean, so flushSync has nothing to write.
            store.flushSync();
            expect(fs.existsSync(b)).toBe(false);
            store.dispose();
        });

        it("after a write the store is clean: a deleted file is not resurrected by a repeated flushSync", async () => {
            const file = path.join(ws.dir, "store.json");
            const store = new StateFileStore(file, { writeDebounceMs: 5 });
            store.store(profiles, ["a"]);
            store.flushSync(); // sync path
            fs.rmSync(file);
            store.flushSync();
            expect(fs.existsSync(file)).toBe(false);
            store.store(profiles, ["b"]);
            await waitForJson(file); // deferred path
            fs.rmSync(file);
            store.flushSync();
            expect(fs.existsSync(file)).toBe(false);
            store.dispose();
        });
    });
});

async function sleep(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
}

async function waitFor(cond: () => boolean, timeoutMs = 1000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeoutMs) throw new Error("waitFor: condition not met in time");
        await new Promise((r) => setTimeout(r, 5));
    }
}

/** File contents once they are valid JSON: the only reliable sign the write has finished. */
async function waitForJson(filePath: string, timeoutMs = 1000): Promise<unknown> {
    let parsed: unknown;
    await waitFor(() => {
        let raw: string;
        try {
            raw = fs.readFileSync(filePath, "utf-8");
        } catch {
            return false; // file doesn't exist yet
        }
        try {
            parsed = JSON.parse(raw);
        } catch {
            return false; // created but still empty
        }
        return true;
    }, timeoutMs);
    return parsed;
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

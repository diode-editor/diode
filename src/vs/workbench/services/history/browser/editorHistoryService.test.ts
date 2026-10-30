import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeHistoryEditorSource } from "../../../../../TestUtils/HistoryEditorSourceFake.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { FileOperation, type IFileOperationEvent } from "../../../../platform/files/common/files.ts";
import { StateService } from "../../../../platform/state/node/stateService.ts";

import { EDITOR_HISTORY_STATE, EditorHistoryService, MAX_HISTORY_ITEMS } from "./editorHistoryService.ts";

describe("EditorHistoryService", () => {
    let ws: ITempWorkspace;
    let source: FakeHistoryEditorSource;
    let operations: Emitter<IFileOperationEvent>;
    let changes: Emitter<readonly Uri[]>;
    let states: StateService[];
    let services: EditorHistoryService[];

    // Missing files drop out by a disk check, so the resources are real.
    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-editor-history-",
            files: { "a.ts": "", "b.ts": "", "c.ts": "", "src/d.ts": "", "src/e.ts": "" },
        });
        source = new FakeHistoryEditorSource();
        operations = new Emitter();
        changes = new Emitter();
        states = [];
        services = [];
    });

    afterEach(() => {
        for (const service of services) service.dispose();
        for (const state of states) state.dispose();
        ws.dispose();
    });

    const file = (name: string): Uri => Uri.file(ws.path(name));
    const open = (name: string): void => {
        source.open(file(name).toString());
    };
    const names = (service: EditorHistoryService): string[] =>
        service.getHistory().map((uri) => path.relative(ws.dir, uri.fsPath));

    /** One state directory per test: a second store over it is "the next run". */
    function newState(): StateService {
        const state = new StateService({
            globalStateFile: path.join(ws.dir, "user", "globalState.json"),
            workspaceStorageDir: path.join(ws.dir, "user", "workspaceStorage"),
        });
        states.push(state);
        return state;
    }

    function createService(state: StateService = newState()): EditorHistoryService {
        const service = new EditorHistoryService(
            source,
            {
                exists: (uri) => Promise.resolve(fs.existsSync(uri.fsPath)),
                onDidRunOperation: operations.event,
                onDidFilesChange: changes.event,
            },
            state,
        );
        services.push(service);
        return service;
    }

    it("activating a file puts it on top, without duplicates", () => {
        const service = createService();
        open("a.ts");
        open("b.ts");
        open("c.ts");
        open("a.ts");

        expect(names(service)).toEqual(["a.ts", "c.ts", "b.ts"]);
    });

    it("closing a tab keeps the file in history", () => {
        const service = createService();
        open("a.ts");
        open("b.ts");
        source.close(file("b.ts").toString());

        expect(names(service)).toEqual(["a.ts", "b.ts"]);
    });

    it("non-file editors (untitled, virtual documents) are not recorded", () => {
        const service = createService();
        open("a.ts");
        source.open("untitled:Untitled-1");
        source.open("jdt://contents/Foo.class");

        expect(names(service)).toEqual(["a.ts"]);
    });

    it("an editor that was active before the service came up is on top", () => {
        open("b.ts");
        const service = createService();

        expect(names(service)).toEqual(["b.ts"]);
    });

    it(`keeps at most ${String(MAX_HISTORY_ITEMS)} entries, dropping the oldest`, () => {
        const service = createService();
        for (let i = 0; i <= MAX_HISTORY_ITEMS; i++) source.open(Uri.file(ws.path(`f${String(i)}.ts`)).toString());

        const history = names(service);
        expect(history).toHaveLength(MAX_HISTORY_ITEMS);
        expect(history[0]).toBe(`f${String(MAX_HISTORY_ITEMS)}.ts`);
        expect(history).not.toContain("f0.ts");
    });

    it("the next run reads the same list from the workspace state", () => {
        const first = newState();
        const service = createService(first);
        open("a.ts");
        open("b.ts");
        source.close(file("b.ts").toString());
        first.flushSync();
        expect(names(service)).toEqual(["a.ts", "b.ts"]);

        source = new FakeHistoryEditorSource();
        const next = createService(newState());

        expect(names(next)).toEqual(["a.ts", "b.ts"]);
    });

    it("is stored under the upstream key, in the workspace scope", () => {
        expect(EDITOR_HISTORY_STATE).toMatchObject({ key: "history.entries", scope: "workspace", default: [] });
        const state = newState();
        createService(state);
        open("a.ts");

        expect(state.get(EDITOR_HISTORY_STATE)).toEqual([ws.path("a.ts")]);
    });

    it("opening another workspace loads its own list", () => {
        const state = newState();
        const service = createService(state);
        open("a.ts");

        state.openWorkspace("other");
        expect(names(service)).toEqual(["a.ts"]);
        state.store(EDITOR_HISTORY_STATE, [ws.path("c.ts")]);
        state.openWorkspace("third");

        expect(names(service)).toEqual(["a.ts"]);
        // The active editor goes on top of the loaded list.
        state.openWorkspace("other");
        expect(names(service)).toEqual(["a.ts", "c.ts"]);
    });

    it(`a stored list longer than ${String(MAX_HISTORY_ITEMS)} is cut on load`, () => {
        const state = newState();
        state.store(
            EDITOR_HISTORY_STATE,
            Array.from({ length: MAX_HISTORY_ITEMS + 5 }, (_, i) => ws.path(`f${String(i)}.ts`)),
        );

        const service = createService(state);

        expect(service.getHistory()).toHaveLength(MAX_HISTORY_ITEMS);
        expect(names(service).at(-1)).toBe(`f${String(MAX_HISTORY_ITEMS - 1)}.ts`);
    });

    it("an empty store gives an empty list", () => {
        const service = createService();

        expect(service.getHistory()).toEqual([]);
    });

    it("a rename moves the entry to the new path in place, in the stored list too", () => {
        const state = newState();
        const service = createService(state);
        open("a.ts");
        open("b.ts");
        operations.fire({ operation: FileOperation.Move, resource: file("a.ts"), target: file("z.ts") });

        expect(names(service)).toEqual(["b.ts", "z.ts"]);
        expect(state.get(EDITOR_HISTORY_STATE)).toEqual([ws.path("b.ts"), ws.path("z.ts")]);
    });

    it("moving a folder retargets the files under it; a rename onto a recorded file leaves one entry", () => {
        const service = createService();
        open("src/d.ts");
        open("lib/d.ts");
        open("a.ts");
        operations.fire({ operation: FileOperation.Move, resource: file("src"), target: file("lib") });

        expect(names(service)).toEqual(["a.ts", "lib/d.ts"]);
    });

    it("deleting a file or its folder removes the entries", () => {
        const service = createService();
        open("src/d.ts");
        open("src/e.ts");
        open("a.ts");
        open("b.ts");
        operations.fire({ operation: FileOperation.Delete, resource: file("b.ts") });
        expect(names(service)).toEqual(["a.ts", "src/e.ts", "src/d.ts"]);

        operations.fire({ operation: FileOperation.Delete, resource: file("src") });
        expect(names(service)).toEqual(["a.ts"]);
    });

    it("other file operations leave the list alone", () => {
        const service = createService();
        open("a.ts");
        operations.fire({ operation: FileOperation.Write, resource: file("a.ts") });
        operations.fire({ operation: FileOperation.Copy, resource: file("a.ts"), target: file("q.ts") });

        expect(names(service)).toEqual(["a.ts"]);
    });

    it("an external change drops the touched entries that are gone from disk", async () => {
        const service = createService();
        open("a.ts");
        open("b.ts");
        open("c.ts");
        fs.rmSync(ws.path("a.ts"));
        fs.rmSync(ws.path("b.ts"));
        changes.fire([file("b.ts"), file("c.ts")]);
        await flushMicrotasks();

        // a.ts is gone too, but the watcher has not reported it yet.
        expect(names(service)).toEqual(["c.ts", "a.ts"]);
    });

    it("removeMissing drops every entry whose file is gone and says whether it dropped any", async () => {
        const state = newState();
        const service = createService(state);
        open("a.ts");
        open("b.ts");
        expect(await service.removeMissing()).toBe(false);
        fs.rmSync(ws.path("a.ts"));

        expect(await service.removeMissing()).toBe(true);
        expect(names(service)).toEqual(["b.ts"]);
        expect(state.get(EDITOR_HISTORY_STATE)).toEqual([ws.path("b.ts")]);
    });

    it("stops listening once disposed", () => {
        const service = createService();
        open("a.ts");
        service.dispose();
        open("b.ts");
        operations.fire({ operation: FileOperation.Delete, resource: file("a.ts") });

        expect(names(service)).toEqual(["a.ts"]);
    });
});

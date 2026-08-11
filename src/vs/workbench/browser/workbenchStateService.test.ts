import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../base/common/uri.ts";
import { resolveUserDataPaths, resolveWorkspaceStatePath } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, StateService } from "../../platform/state/node/stateService.ts";
import { OPEN_EDITORS_STATE } from "../common/stateKeys.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";

import { WorkbenchStateService } from "./workbenchStateService.ts";

/** Фейковая вкладка: сервису от неё нужны только путь и ресурс. */
class FakePane {
    public constructor(public readonly absoluteFilePath: string | null) {}

    public get uri(): Uri {
        return Uri.file(this.absoluteFilePath ?? "/untitled");
    }
}

/** Фейковая группа: панели + активная + журнал activateTab. */
class FakeEditorGroup {
    public panes: FakePane[] = [];
    public activeIndexValue = -1;
    public activated: { index: number; focus: boolean }[] = [];

    public getPanes(): readonly FakePane[] {
        return this.panes;
    }

    public get activePane(): FakePane | null {
        return this.panes[this.activeIndexValue] ?? null;
    }

    public get editorCount(): number {
        return this.panes.length;
    }

    public findPaneIndex(uri: Uri): number {
        return this.panes.findIndex((pane) => pane.uri.toString() === uri.toString());
    }

    public activateTab(index: number, { focus = true }: { focus?: boolean } = {}): void {
        this.activated.push({ index, focus });
        this.activeIndexValue = index;
    }
}

/** Минимальный дублёр EditorService: полоса фейковых групп + журналы вызовов. */
class FakeGroup {
    public opened: { path: string; focus: boolean }[] = [];
    public groupsList: FakeEditorGroup[] = [new FakeEditorGroup()];
    public activeGroupValue = this.groupsList[0];
    private listeners: (() => void)[] = [];

    public get groups(): readonly FakeEditorGroup[] {
        return this.groupsList;
    }

    public get activeGroup(): FakeEditorGroup {
        return this.activeGroupValue;
    }

    /** Готовит одногрупповое состояние (паритет со старым плоским фейком). */
    public setState(paths: string[], active: number): void {
        const group = this.groupsList[0];
        group.panes = paths.map((p) => new FakePane(p));
        group.activeIndexValue = active;
    }

    public openFile(path: string, { focus = true }: { focus?: boolean } = {}): void {
        this.opened.push({ path, focus });
        this.activeGroupValue.panes.push(new FakePane(path));
        this.activeGroupValue.activeIndexValue = this.activeGroupValue.panes.length - 1;
    }

    public newGroup(_position: "before" | "after", _opts: { focus?: boolean } = {}): FakeEditorGroup {
        const group = new FakeEditorGroup();
        this.groupsList.push(group);
        this.activeGroupValue = group;
        return group;
    }

    public focusGroup(target: { index: number }, _opts: { focus?: boolean } = {}): void {
        const group = this.groupsList[target.index];
        if (group !== undefined) this.activeGroupValue = group;
    }

    public onActiveEditorChanged(listener: () => void): { dispose(): void } {
        this.listeners.push(listener);
        return {
            dispose: () => {
                this.listeners = this.listeners.filter((l) => l !== listener);
            },
        };
    }

    public onDidGroupsChange(_listener: () => void): { dispose(): void } {
        return { dispose: () => undefined };
    }

    /** Эмулирует смену активного редактора (write-through подписка сервиса). */
    public fireActiveEditorChanged(): void {
        for (const listener of [...this.listeners]) listener();
    }
}

describe("WorkbenchStateService", () => {
    let ws: ITempWorkspace;
    let state: StateService;
    let group: FakeGroup;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-wbstate-" });
        state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir }));
        group = new FakeGroup();
    });

    afterEach(() => {
        ws.dispose();
    });

    function make(): WorkbenchStateService {
        return new WorkbenchStateService(state, group as unknown as EditorService);
    }

    describe("open editors", () => {
        it("captures open files with the active index relative to the file list", () => {
            group.setState(["/a.ts", "/b.ts", "/c.ts"], 2);
            make().captureOpenEditors();
            expect(state.get(OPEN_EDITORS_STATE)).toEqual({ files: ["/a.ts", "/b.ts", "/c.ts"], activeIndex: 2 });
        });

        it("stores activeIndex -1 when the group is empty", () => {
            group.setState([], -1);
            make().captureOpenEditors();
            expect(state.get(OPEN_EDITORS_STATE)).toEqual({ files: [], activeIndex: -1 });
        });

        it("auto-captures on the group's active-editor change (write-through)", () => {
            const service = make();
            group.setState(["/a.ts", "/b.ts"], 0);
            group.fireActiveEditorChanged();
            expect(state.get(OPEN_EDITORS_STATE)).toEqual({ files: ["/a.ts", "/b.ts"], activeIndex: 0 });

            // Подписка снимается вместе с сервисом.
            service.dispose();
            group.setState(["/c.ts"], 0);
            group.fireActiveEditorChanged();
            expect(state.get(OPEN_EDITORS_STATE)).toEqual({ files: ["/a.ts", "/b.ts"], activeIndex: 0 });
        });

        it("restores existing files and re-activates the saved active file", () => {
            ws.writeFile("a.ts", "A");
            ws.writeFile("b.ts", "B");
            const a = ws.path("a.ts");
            const b = ws.path("b.ts");
            state.store(OPEN_EDITORS_STATE, { files: [a, b, "/gone/missing.ts"], activeIndex: 1 });

            make().restoreOpenEditors();

            expect(group.opened.map((o) => o.path)).toEqual([a, b]); // missing filtered out
            expect(group.opened.every((o) => !o.focus)).toBe(true);
            // b пережил фильтрацию на позиции 1 — активирован он.
            expect(group.groups[0].activated).toEqual([{ index: 1, focus: false }]);
        });

        it("falls back to the first tab when the saved active file is gone", () => {
            ws.writeFile("a.ts", "A");
            const a = ws.path("a.ts");
            state.store(OPEN_EDITORS_STATE, { files: [a, "/gone/x.ts"], activeIndex: 1 });

            make().restoreOpenEditors();

            expect(group.opened.map((o) => o.path)).toEqual([a]);
            expect(group.groups[0].activated).toEqual([{ index: 0, focus: false }]);
        });

        it("activates the first tab when the snapshot has no valid active index", () => {
            ws.writeFile("a.ts", "A");
            const a = ws.path("a.ts");
            state.store(OPEN_EDITORS_STATE, { files: [a], activeIndex: -1 });

            make().restoreOpenEditors();

            expect(group.opened.map((o) => o.path)).toEqual([a]);
            expect(group.groups[0].activated).toEqual([{ index: 0, focus: false }]);
        });

        it("opens nothing and activates nothing when no saved file exists", () => {
            state.store(OPEN_EDITORS_STATE, { files: ["/gone/x.ts"], activeIndex: 0 });
            make().restoreOpenEditors();
            expect(group.opened).toEqual([]);
            expect(group.groups[0].activated).toEqual([]);
        });

        it("does nothing on an empty snapshot", () => {
            make().restoreOpenEditors();
            expect(group.opened).toEqual([]);
            expect(group.groups[0].activated).toEqual([]);
        });
    });

    it("routes workspace-scoped state to the opened project's store", () => {
        const paths = resolveUserDataPaths({ homedir: "/never", userDataDir: ws.dir });
        const service = make();
        service.openWorkspace("/projects/gamma");
        group.setState(["/projects/gamma/x.ts"], 0);
        service.captureOpenEditors();
        state.flushSync();

        const stateFile = resolveWorkspaceStatePath(paths.workspaceStorageDir, "/projects/gamma");
        const onDisk = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as Record<string, unknown>;
        expect(onDisk["workbench.editors.openEditors"]).toEqual({ files: ["/projects/gamma/x.ts"], activeIndex: 0 });
    });
});

import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../platform/configuration/common/nullConfigurationService.ts";
import { resolveUserDataPaths, resolveWorkspaceStatePath } from "../../platform/environment/node/userDataPaths.ts";
import { NULL_FILE_WATCHER } from "../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../platform/log/common/nullLogService.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { WorkbenchTheme } from "../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../platform/undoRedo/common/undoRedoService.ts";
import { computeWorkspaceId } from "../../platform/workspace/common/workspaceId.ts";
import { EDITOR_GROUPS_STATE, OPEN_EDITORS_STATE } from "../common/stateKeys.ts";
import { TEXT_EDITOR_PANE_TYPE_ID } from "../services/editor/browser/editorPaneFactory.ts";
import { EditorService } from "../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../services/themes/common/themeService.ts";

import { WorkbenchStateService } from "./workbenchStateService.ts";

/** Inspects what landed in the store and what opened, not which methods were called. */
describe("WorkbenchStateService", () => {
    let ws: ITempWorkspace;
    let state: StateService;
    let editors: EditorService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-wbstate-", files: { "a.ts": "A", "b.ts": "B", "c.ts": "C" } });
        state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: ws.path(".user") }));
        editors = new EditorService(
            new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
            new TokenizationRegistry(),
            NULL_TOKEN_STYLE_RESOLVER,
            NULL_LANGUAGE_SERVICE,
            NULL_CONFIGURATION_SERVICE,
            new UndoRedoService(),
            NULL_FILE_WATCHER,
            createTestEditorContextMenuController(),
            NULL_LOG_SERVICE,
        );
    });

    afterEach(() => {
        // Silence the writer BEFORE removing the directory: a debounced write after `rmSync` recreates it.
        state.dispose();
        editors.dispose();
        ws.dispose();
    });

    function make(): WorkbenchStateService {
        return new WorkbenchStateService(state, editors, editors.editorGroups);
    }

    const fileEditor = (name: string) => ({
        typeId: TEXT_EDITOR_PANE_TYPE_ID,
        value: Uri.file(ws.path(name)).toString(),
    });
    const openPaths = () => editors.editorGroups.activeGroup.getPanes().map((pane) => pane.uri.fsPath);

    describe("snapshot", () => {
        it("writes tabs as recipes and files; the active one as an index in each list", () => {
            make();
            editors.newUntitled();
            editors.openFile(ws.path("a.ts"));
            editors.openFile(ws.path("b.ts"));

            expect(state.get(EDITOR_GROUPS_STATE)?.groups).toEqual([
                {
                    files: [ws.path("a.ts"), ws.path("b.ts")],
                    activeIndex: 1,
                    // An untitled buffer does not survive a restart; it is in neither list.
                    editors: [fileEditor("a.ts"), fileEditor("b.ts")],
                    activeEditor: 1,
                },
            ]);
            expect(state.get(OPEN_EDITORS_STATE)).toEqual({
                files: [ws.path("a.ts"), ws.path("b.ts")],
                activeIndex: 1,
            });
        });

        it("an empty group has no active tab", () => {
            make().captureOpenEditors();

            expect(state.get(EDITOR_GROUPS_STATE)?.groups).toEqual([
                { files: [], activeIndex: -1, editors: [], activeEditor: -1 },
            ]);
        });

        it("an active tab that cannot be saved leaves no active tab in the snapshot", () => {
            make();
            editors.openFile(ws.path("a.ts"));
            editors.newUntitled();

            expect(state.get(EDITOR_GROUPS_STATE)?.groups[0]).toMatchObject({ activeIndex: -1, activeEditor: -1 });
        });

        it("writes through on active editor change; the subscription is disposed with the service", () => {
            const service = make();
            editors.openFile(ws.path("a.ts"));
            expect(state.get(OPEN_EDITORS_STATE).files).toEqual([ws.path("a.ts")]);

            service.dispose();
            editors.openFile(ws.path("b.ts"));
            expect(state.get(OPEN_EDITORS_STATE).files).toEqual([ws.path("a.ts")]);
        });
    });

    describe("restore", () => {
        it("from records: opens the surviving tabs and activates the saved one", () => {
            state.store(EDITOR_GROUPS_STATE, {
                orientation: "columns",
                groups: [
                    {
                        files: [],
                        activeIndex: -1,
                        editors: [fileEditor("a.ts"), fileEditor("gone.ts"), fileEditor("b.ts")],
                        activeEditor: 2,
                    },
                ],
                weights: [1],
                activeGroup: 0,
            });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
            expect(editors.editorGroups.activeGroup.activePane?.uri.fsPath).toBe(ws.path("b.ts"));
        });

        it("several groups: the saved one becomes active, content focus is not touched", () => {
            state.store(EDITOR_GROUPS_STATE, {
                orientation: "columns",
                groups: [
                    { files: [], activeIndex: -1, editors: [fileEditor("a.ts")], activeEditor: 0 },
                    { files: [], activeIndex: -1, editors: [fileEditor("b.ts")], activeEditor: 0 },
                    { files: [], activeIndex: -1, editors: [fileEditor("c.ts")], activeEditor: 0 },
                ],
                weights: [1, 1, 1],
                // The first is not adjacent to the last created group, so a naive "just the previous one" misses it.
                activeGroup: 0,
            });
            const focused: unknown[] = [];
            editors.editorGroups.focusGroupContentHook = (group) => focused.push(group);

            make().restoreOpenEditors();

            expect(editors.editorGroups.groups).toHaveLength(3);
            expect(editors.editorGroups.viewColumnOf(editors.editorGroups.activeGroup)).toBe(1);
            expect(openPaths()).toEqual([ws.path("a.ts")]);
            expect(focused).toEqual([]);
        });

        it("from records without activeEditor: the first tab", () => {
            state.store(EDITOR_GROUPS_STATE, {
                orientation: "columns",
                groups: [{ files: [], activeIndex: -1, editors: [fileEditor("a.ts"), fileEditor("b.ts")] }],
                weights: [1],
                activeGroup: 0,
            });

            make().restoreOpenEditors();

            expect(editors.editorGroups.activeGroup.activeIndex).toBe(0);
        });

        it("an old snapshot without editors is restored from files", () => {
            state.store(EDITOR_GROUPS_STATE, {
                orientation: "columns",
                groups: [{ files: [ws.path("a.ts"), ws.path("b.ts")], activeIndex: 1 }],
                weights: [1],
                activeGroup: 0,
            });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
            expect(editors.editorGroups.activeGroup.activeIndex).toBe(1);
        });

        it("flat legacy key: a missing file is skipped, the active one is reindexed", () => {
            state.store(OPEN_EDITORS_STATE, {
                files: [ws.path("a.ts"), "/gone/missing.ts", ws.path("b.ts")],
                activeIndex: 2,
            });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
            expect(editors.editorGroups.activeGroup.activePane?.uri.fsPath).toBe(ws.path("b.ts"));
        });

        it("the saved active tab is gone, so the first one is active", () => {
            state.store(OPEN_EDITORS_STATE, { files: [ws.path("a.ts"), "/gone/x.ts"], activeIndex: 1 });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts")]);
            expect(editors.editorGroups.activeGroup.activeIndex).toBe(0);
        });

        it("no surviving tabs: opens nothing", () => {
            state.store(OPEN_EDITORS_STATE, { files: ["/gone/x.ts"], activeIndex: 0 });

            make().restoreOpenEditors();

            expect(editors.editorGroups.activeGroup.editorCount).toBe(0);
            expect(editors.editorGroups.groups.length).toBe(1);
        });

        it("an empty snapshot does nothing", () => {
            make().restoreOpenEditors();

            expect(editors.editorGroups.activeGroup.editorCount).toBe(0);
        });

        it("restore opens without focus and ends with a snapshot of the actual group strip", () => {
            state.store(OPEN_EDITORS_STATE, { files: [ws.path("a.ts"), "/gone/x.ts"], activeIndex: 0 });

            make().restoreOpenEditors();

            expect(state.get(EDITOR_GROUPS_STATE)?.groups[0].editors).toEqual([fileEditor("a.ts")]);
        });
    });

    it("writes workspace state to the store of the open project", () => {
        const paths = resolveUserDataPaths({ homedir: "/never", userDataDir: ws.path(".user") });
        const service = make();
        const workspaceId = computeWorkspaceId("/projects/gamma");
        service.openWorkspace(workspaceId);
        editors.openFile(ws.path("c.ts"));
        state.flushSync();

        const stateFile = resolveWorkspaceStatePath(paths.workspaceStorageDir, workspaceId);
        const onDisk = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as Record<string, unknown>;
        expect(onDisk["workbench.editors.openEditors"]).toEqual({ files: [ws.path("c.ts")], activeIndex: 0 });
    });
});

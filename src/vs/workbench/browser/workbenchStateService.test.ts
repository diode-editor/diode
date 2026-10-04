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

/**
 * Снимок и рестор открытых редакторов поверх настоящего `EditorService`:
 * смотрим, что легло в стор и что открылось, а не какие методы позвали.
 */
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
        editors.dispose();
        ws.dispose();
    });

    function make(): WorkbenchStateService {
        return new WorkbenchStateService(state, editors);
    }

    const fileEditor = (name: string) => ({
        typeId: TEXT_EDITOR_PANE_TYPE_ID,
        value: Uri.file(ws.path(name)).toString(),
    });
    const openPaths = () => editors.activeGroup.getPanes().map((pane) => pane.uri.fsPath);

    describe("снимок", () => {
        it("пишет вкладки рецептами и файлами; активная — индексом в каждом списке", () => {
            make();
            editors.newUntitled();
            editors.openFile(ws.path("a.ts"));
            editors.openFile(ws.path("b.ts"));

            expect(state.get(EDITOR_GROUPS_STATE)?.groups).toEqual([
                {
                    files: [ws.path("a.ts"), ws.path("b.ts")],
                    activeIndex: 1,
                    // Безымянный буфер рестарт не переживает — его нет ни в одном списке.
                    editors: [fileEditor("a.ts"), fileEditor("b.ts")],
                    activeEditor: 1,
                },
            ]);
            expect(state.get(OPEN_EDITORS_STATE)).toEqual({
                files: [ws.path("a.ts"), ws.path("b.ts")],
                activeIndex: 1,
            });
        });

        it("пустая группа — активной вкладки нет", () => {
            make().captureOpenEditors();

            expect(state.get(EDITOR_GROUPS_STATE)?.groups).toEqual([
                { files: [], activeIndex: -1, editors: [], activeEditor: -1 },
            ]);
        });

        it("активная вкладка, которую не сохранить, — активной в снимке нет", () => {
            make();
            editors.openFile(ws.path("a.ts"));
            editors.newUntitled();

            expect(state.get(EDITOR_GROUPS_STATE)?.groups[0]).toMatchObject({ activeIndex: -1, activeEditor: -1 });
        });

        it("write-through по смене активного редактора; подписка снимается с сервисом", () => {
            const service = make();
            editors.openFile(ws.path("a.ts"));
            expect(state.get(OPEN_EDITORS_STATE).files).toEqual([ws.path("a.ts")]);

            service.dispose();
            editors.openFile(ws.path("b.ts"));
            expect(state.get(OPEN_EDITORS_STATE).files).toEqual([ws.path("a.ts")]);
        });
    });

    describe("рестор", () => {
        it("по записям: открывает уцелевшие вкладки и активирует сохранённую", () => {
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
            expect(editors.activeGroup.activePane?.uri.fsPath).toBe(ws.path("b.ts"));
        });

        it("по записям без activeEditor — первая вкладка", () => {
            state.store(EDITOR_GROUPS_STATE, {
                orientation: "columns",
                groups: [{ files: [], activeIndex: -1, editors: [fileEditor("a.ts"), fileEditor("b.ts")] }],
                weights: [1],
                activeGroup: 0,
            });

            make().restoreOpenEditors();

            expect(editors.activeGroup.activeIndex).toBe(0);
        });

        it("старый снимок без editors поднимается по files", () => {
            state.store(EDITOR_GROUPS_STATE, {
                orientation: "columns",
                groups: [{ files: [ws.path("a.ts"), ws.path("b.ts")], activeIndex: 1 }],
                weights: [1],
                activeGroup: 0,
            });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
            expect(editors.activeGroup.activeIndex).toBe(1);
        });

        it("плоский legacy-ключ: пропавший файл пропущен, активный переиндексирован", () => {
            state.store(OPEN_EDITORS_STATE, {
                files: [ws.path("a.ts"), "/gone/missing.ts", ws.path("b.ts")],
                activeIndex: 2,
            });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts"), ws.path("b.ts")]);
            expect(editors.activeGroup.activePane?.uri.fsPath).toBe(ws.path("b.ts"));
        });

        it("сохранённая активная вкладка пропала — активна первая", () => {
            state.store(OPEN_EDITORS_STATE, { files: [ws.path("a.ts"), "/gone/x.ts"], activeIndex: 1 });

            make().restoreOpenEditors();

            expect(openPaths()).toEqual([ws.path("a.ts")]);
            expect(editors.activeGroup.activeIndex).toBe(0);
        });

        it("ни одной уцелевшей вкладки — ничего не открывает", () => {
            state.store(OPEN_EDITORS_STATE, { files: ["/gone/x.ts"], activeIndex: 0 });

            make().restoreOpenEditors();

            expect(editors.activeGroup.editorCount).toBe(0);
            expect(editors.groups.length).toBe(1);
        });

        it("пустой снимок — ничего не делает", () => {
            make().restoreOpenEditors();

            expect(editors.activeGroup.editorCount).toBe(0);
        });

        it("рестор открывает без фокуса и кончается снимком фактической полосы", () => {
            state.store(OPEN_EDITORS_STATE, { files: [ws.path("a.ts"), "/gone/x.ts"], activeIndex: 0 });

            make().restoreOpenEditors();

            expect(state.get(EDITOR_GROUPS_STATE)?.groups[0].editors).toEqual([fileEditor("a.ts")]);
        });
    });

    it("пишет workspace-состояние в стор открытого проекта", () => {
        const paths = resolveUserDataPaths({ homedir: "/never", userDataDir: ws.path(".user") });
        const service = make();
        // Стор адресуется идентичностью воркспейса, а не путём папки.
        const workspaceId = computeWorkspaceId("/projects/gamma");
        service.openWorkspace(workspaceId);
        editors.openFile(ws.path("c.ts"));
        state.flushSync();

        const stateFile = resolveWorkspaceStatePath(paths.workspaceStorageDir, workspaceId);
        const onDisk = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as Record<string, unknown>;
        expect(onDisk["workbench.editors.openEditors"]).toEqual({ files: [ws.path("c.ts")], activeIndex: 0 });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { DiagnosticsService } from "./diagnosticsService.ts";

/**
 * Маркеры поверх настоящего EditorService со сплитом: squiggles получает
 * каждая вкладка ресурса, а не только вкладки активной группы.
 */
describe("DiagnosticsService — все группы", () => {
    let ws: ITempWorkspace;
    let editors: EditorService;
    let markers: MarkerService;
    let service: DiagnosticsService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-diagnostics-groups-",
            files: { "a.ts": "alpha\nbeta", "b.ts": "gamma" },
        });
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
        markers = new MarkerService();
        service = new DiagnosticsService(
            editors,
            markers,
            { settingsResource: ws.path("settings.json") },
            new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS),
        );
    });

    afterEach(() => {
        service.dispose();
        editors.dispose();
        ws.dispose();
    });

    it("маркер ресурса доходит до его вкладки в неактивной группе", () => {
        editors.openFile(ws.path("a.ts"));
        editors.splitActiveGroup(); // группа 2 — дубль a.ts
        editors.editorGroups.focusGroup({ index: 0 });
        const inactive = editors.editorGroups.groups[1].getPane(0);
        expect(inactive instanceof TextEditorPane).toBe(true);
        const pushed = vi.spyOn(inactive as TextEditorPane, "setMarkerDecorations");

        markers.changeOne("lint", Uri.file(ws.path("a.ts")).toString(), [
            { severity: MarkerSeverity.Error, range: createRange(1, 0, 1, 4), message: "x" },
        ]);

        expect(pushed).toHaveBeenCalledWith([{ range: createRange(1, 0, 1, 4), severity: MarkerSeverity.Error }]);
    });

    it("маркер ресурса не попадает во вкладки других ресурсов", () => {
        editors.openFile(ws.path("a.ts"));
        editors.openFile(ws.path("b.ts"));
        const other = editors.getActiveEditor()!;
        const pushed = vi.spyOn(other, "setMarkerDecorations");

        markers.changeOne("lint", Uri.file(ws.path("a.ts")).toString(), [
            { severity: MarkerSeverity.Error, range: createRange(0, 0, 0, 1), message: "x" },
        ]);

        expect(pushed).not.toHaveBeenCalled();
    });
});

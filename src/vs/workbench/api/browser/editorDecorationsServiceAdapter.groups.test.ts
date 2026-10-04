import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import { createTestEditorContextMenuController } from "../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import { EditorService } from "../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../services/themes/common/themeService.ts";

import { EditorDecorationsServiceAdapter } from "./editorDecorationsServiceAdapter.ts";

/**
 * Gutter-полоски quick-diff/SCM поверх настоящего EditorService со сплитом:
 * их получает каждая вкладка ресурса, а не только вкладки активной группы.
 */
describe("EditorDecorationsServiceAdapter — все группы", () => {
    let ws: ITempWorkspace;
    let service: EditorService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-decorations-groups-", files: { "a.ts": "alpha\nbeta" } });
        service = new EditorService(
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
        service.dispose();
        ws.dispose();
    });

    it("декорации ресурса доходят до его вкладки в неактивной группе", () => {
        service.openFile(ws.path("a.ts"));
        service.splitActiveGroup(); // группа 2 — дубль a.ts
        service.editorGroups.focusGroup({ index: 0 });
        const inactive = service.editorGroups.groups[1].getPane(0);
        expect(inactive instanceof TextEditorPane).toBe(true);
        const pushed = vi.spyOn(inactive as TextEditorPane, "setGutterChangeDecorations");
        const decorations = [{ range: createRange(1, 0, 1, 0), color: 0x123456 }];

        new EditorDecorationsServiceAdapter(service).setGutterChangeDecorations(
            Uri.file(ws.path("a.ts")).toString(),
            decorations,
        );

        expect(pushed).toHaveBeenCalledWith(decorations);
    });
});

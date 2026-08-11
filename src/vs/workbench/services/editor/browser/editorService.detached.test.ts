import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { describe, expect, it } from "vitest";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";

import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

/**
 * Detached-панель — редактор вне таб-строки (нижняя Panel: Output). Здесь
 * проверяется её изоляция: всё, что перечисляет вкладки, обязано её НЕ видеть.
 */
function createEditorService(): EditorService {
    return new EditorService(
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
}

const OUTPUT_URI = Uri.from({ scheme: "output", path: "extensions" });

describe("EditorService.openDetached", () => {
    it("создаёт редактор с синтетическим ресурсом и пустым документом", () => {
        const service = createEditorService();

        const pane = service.openDetached(OUTPUT_URI, "log");

        expect(pane.uri.toString()).toBe(OUTPUT_URI.toString());
        expect(pane.getText()).toBe("");
        expect(pane.viewState.document.languageId).toBe("log");
        service.dispose();
    });

    it("не попадает ни в одну перечисляющую вкладки поверхность", () => {
        // Это и есть весь смысл отдельного списка: код табов, персиста сессии и
        // shutdown-протокола ходит по `editors` и о detached не знает.
        const service = createEditorService();

        service.openDetached(OUTPUT_URI, "log");

        expect(service.editorCount).toBe(0);
        expect(service.getEditors()).toHaveLength(0);
        expect(service.getOpenFilePaths()).toHaveLength(0);
        expect(service.getEditor(0)).toBeNull();
        service.dispose();
    });

    it("не участвует в shutdown-протоколе даже с непустым содержимым", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");

        pane.model.appendOwnedContent("12:00:00.000 [info] hello\n");

        expect(pane.isModified).toBe(false);
        expect(service.collectDirty()).toHaveLength(0);
        service.dispose();
    });

    it("getActiveEditor не отдаёт detached, пока фокус не внутри неё", () => {
        // Без фокуса активным остаётся редактор-вкладка; detached всплывает
        // только когда пользователь реально работает в панели.
        const service = createEditorService();
        service.newUntitled({ focus: false });
        const tab = service.getEditor(0);

        service.openDetached(OUTPUT_URI, "log");

        expect(service.getActiveEditor()).toBe(tab);
        service.dispose();
    });

    it("без вкладок и без фокуса активного редактора нет", () => {
        const service = createEditorService();

        service.openDetached(OUTPUT_URI, "log");

        expect(service.getActiveEditor()).toBeNull();
        service.dispose();
    });
});

describe("TextFileModel: owner-write для detached", () => {
    it("appendOwnedContent дописывает в конец и не пачкает буфер", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");

        pane.model.appendOwnedContent("first\n");
        pane.model.appendOwnedContent("second\n");

        expect(pane.getText()).toBe("first\nsecond\n");
        expect(pane.isModified).toBe(false);
        service.dispose();
    });

    it("appendOwnedContent проходит в read-only редакторе", () => {
        // Ключевое свойство: read-only запрещает правки ПОЛЬЗОВАТЕЛЯ, но владелец
        // документа писать обязан — иначе живой хвост лога встал бы намертво.
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");
        pane.readOnly = true;

        pane.model.appendOwnedContent("line\n");

        expect(pane.getText()).toBe("line\n");
        // А вот обычная правка через ту же модель по-прежнему заблокирована.
        expect(pane.viewState.type("X")).toBeUndefined();
        expect(pane.getText()).toBe("line\n");
        service.dispose();
    });

    it("пустой append — no-op", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");
        pane.model.appendOwnedContent("a\n");
        const versionBefore = pane.viewState.document.versionId;

        pane.model.appendOwnedContent("");

        expect(pane.viewState.document.versionId).toBe(versionBefore);
        service.dispose();
    });

    it("replaceOwnedContent меняет содержимое целиком и сохраняет язык", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");
        pane.model.appendOwnedContent("old\n");

        pane.model.replaceOwnedContent("new\n");

        expect(pane.getText()).toBe("new\n");
        expect(pane.viewState.document.languageId).toBe("log");
        expect(pane.isModified).toBe(false);
        service.dispose();
    });

    it("save синтетического буфера не пишет на диск", () => {
        const service = createEditorService();
        const pane = service.openDetached(OUTPUT_URI, "log");

        return expect(pane.save()).resolves.toBe("no-file");
    });
});

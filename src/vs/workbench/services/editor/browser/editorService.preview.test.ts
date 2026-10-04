import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createInsertEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

const PREVIEW_KEY = "workbench.editor.enablePreview";

/**
 * Настройки с живым событием изменения: предпросмотр гасится настройкой, и
 * выключение обязано доехать до уже открытой превью-вкладки.
 */
/**
 * Настройки с дефолтами приложения: `workbench.editor.enablePreview` читается
 * типизированной перегрузкой `get(key)`, и дефолт ей даёт РЕЕСТР — у
 * `NULL_CONFIGURATION_SERVICE` дефолтов нет, и предпросмотр на ней был бы
 * выключен, чего в приложении не бывает.
 */
function defaultsConfig(): IConfigurationService {
    return createTestConfigurationService();
}

function switchableConfig(initial: boolean): {
    service: IConfigurationService;
    set: (value: boolean) => void;
} {
    let enabled = initial;
    const listeners: ((event: IConfigurationChangeEvent) => void)[] = [];
    return {
        service: {
            ...NULL_CONFIGURATION_SERVICE,
            get<T>(key: string, defaultValue?: T): T | undefined {
                return key === PREVIEW_KEY ? (enabled as unknown as T) : defaultValue;
            },
            onDidChangeConfiguration(listener) {
                listeners.push(listener);
                return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
            },
        },
        set(value: boolean) {
            enabled = value;
            const event: IConfigurationChangeEvent = {
                affectedKeys: [PREVIEW_KEY],
                overrideIdentifiers: [],
                affectsConfiguration: (key) => key === PREVIEW_KEY,
            };
            for (const listener of [...listeners]) listener(event);
        },
    };
}

/**
 * Вкладка, которая МОЛЧА становится грязной: про `onDidChangeState` она не
 * знает, поэтому защёлка «первая правка прикалывает» на ней не срабатывает.
 */
function makeSilentPane(uriPath: string): IEditorPane & { isModified: boolean } {
    return {
        uri: Uri.file(uriPath),
        label: uriPath,
        view: {} as never,
        isModified: false,
        readOnly: false,
        getSelectedTexts: () => [],
        onDidChangeState: () => ({ dispose() {} }),
        focusEditor() {},
        dispose() {},
    };
}

function createEditorService(configurationService: IConfigurationService = defaultsConfig()): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        configurationService,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

describe("EditorService — режим предпросмотра вкладок", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-preview-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content = name): string {
        const filePath = path.join(ws.dir, name);
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    function tabs(service: EditorService): string[] {
        return service.activeGroup.getPanes().map((pane) => pane.label);
    }

    it("превью замещает превью: обход дерева не копит таб-строку", () => {
        const service = createEditorService();

        service.openFile(writeFile("a.ts"), { preview: true });
        expect(tabs(service)).toEqual(["a.ts"]);

        service.openFile(writeFile("b.ts"), { preview: true });
        expect(tabs(service)).toEqual(["b.ts"]);

        service.openFile(writeFile("c.ts"), { preview: true });
        expect(tabs(service)).toEqual(["c.ts"]);
        expect(service.activeGroup.previewPane?.label).toBe("c.ts");
        expect(service.activeGroup.activeIndex).toBe(0);
    });

    it("превью занимает СЛОТ прежнего, а не уезжает в конец полосы", () => {
        const service = createEditorService();
        service.openFile(writeFile("pinned.ts"));
        service.openFile(writeFile("a.ts"), { preview: true });
        service.openFile(writeFile("tail.ts"));
        expect(tabs(service)).toEqual(["pinned.ts", "a.ts", "tail.ts"]);

        service.openFile(writeFile("b.ts"), { preview: true });

        expect(tabs(service)).toEqual(["pinned.ts", "b.ts", "tail.ts"]);
        expect(service.activeGroup.activeIndex).toBe(1);
    });

    it("открытие БЕЗ превью копит вкладки, как раньше", () => {
        const service = createEditorService();

        service.openFile(writeFile("a.ts"));
        service.openFile(writeFile("b.ts"));

        expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        expect(service.activeGroup.previewPane).toBe(null);
    });

    it("постоянное открытие превью-вкладки её прикалывает", () => {
        const service = createEditorService();
        const a = writeFile("a.ts");
        service.openFile(a, { preview: true });
        expect(service.activeGroup.previewPane?.label).toBe("a.ts");

        // Ctrl+P по файлу, висящему предпросмотром.
        service.openFile(a);

        expect(service.activeGroup.previewPane).toBe(null);
        expect(tabs(service)).toEqual(["a.ts"]);

        // И следующее превью теперь встаёт рядом, а не замещает приколотую.
        service.openFile(writeFile("b.ts"), { preview: true });
        expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
    });

    it("повторное превью того же файла предпросмотр не снимает", () => {
        const service = createEditorService();
        const a = writeFile("a.ts");
        service.openFile(a, { preview: true });

        service.openFile(a, { preview: true });

        expect(service.activeGroup.previewPane?.label).toBe("a.ts");
    });

    it("правка прикалывает превью-вкладку, и следующее превью её не теряет", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts", "const x = 1;"), { preview: true });
        const editor = service.getActiveEditor()!;

        editor.model.document.applyEdits([createInsertEdit(0, 0, "// ")]);
        expect(editor.isModified).toBe(true);

        service.openFile(writeFile("b.ts"), { preview: true });

        expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        expect(service.activeGroup.previewPane?.label).toBe("b.ts");
    });

    it("грязную вкладку замещение прикалывает, даже если защёлка её упустила", () => {
        // Вторая линия обороны: вкладка стала грязной, НЕ сообщив об этом
        // событием. Защёлка группы в этом случае не взведена, и единственное,
        // что стоит между несохранёнными правками и замещением, — проверка
        // `isModified` в самом замещении.
        const service = createEditorService();
        const group = service.activeGroup;
        const silent = makeSilentPane("/silent.ts");
        group.insertPane(silent, { preview: true });
        group.activateTab(0);
        silent.isModified = true;

        service.openFile(writeFile("b.ts"), { preview: true });

        expect(tabs(service)).toEqual(["/silent.ts", "b.ts"]);
        expect(group.isPinned(silent)).toBe(true);
        expect(group.previewPane?.label).toBe("b.ts");
    });

    it("общая грязная модель: приехавшую грязной вкладку превью не делает, прежнюю прикалывает", () => {
        // Тот же файл уже открыт и ИЗМЕНЁН в другой группе — модель общая через
        // реестр, поэтому новая вкладка рождается грязной. Предпросмотром она
        // не становится, и прежний (тоже грязный) предпросмотр обязан быть
        // приколот: иначе он остался бы в слоте замещения и следующее превью
        // унесло бы его несохранённые правки.
        const service = createEditorService();
        const shared = writeFile("shared.ts");
        service.openFile(shared);
        const opened = service.getActiveEditor();
        if (opened === null) throw new Error("вкладка не открылась");
        opened.pushUndo(opened.viewState.type("dirty"));

        const second = service.newGroup("after");
        if (second === null) throw new Error("вторая группа не создалась");
        const silent = makeSilentPane("/silent.ts");
        second.insertPane(silent, { preview: true });
        second.activateTab(0);
        silent.isModified = true;

        service.openFile(shared, { group: second, preview: true });

        expect(second.getPanes().map((pane) => pane.label)).toEqual(["/silent.ts", "shared.ts"]);
        expect(second.previewPane).toBe(null);
        expect(second.isPinned(silent)).toBe(true);
    });

    it("сплит прикалывает вкладку-источник", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"), { preview: true });
        const source = service.activeGroup;

        service.splitActiveGroup();

        expect(source.previewPane).toBe(null);
        expect(service.activeGroup.previewPane).toBe(null);
    });

    it("копия вкладки в соседнюю группу прикалывает источник", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"), { preview: true });
        const source = service.activeGroup;
        service.newGroup("after");
        service.focusGroup(source.id);

        service.copyActiveEditorToGroup("next");

        expect(source.previewPane).toBe(null);
        expect(service.activeGroup.previewPane).toBe(null);
    });

    it("перенос вкладки в соседнюю группу прикалывает её", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"), { preview: true });
        const source = service.activeGroup;

        service.moveActiveEditorToGroup("next");

        expect(service.activeGroup === source).toBe(false);
        expect(service.activeGroup.previewPane).toBe(null);
    });

    it("`group: beside` превьюит в соседней группе, не в активной", () => {
        const service = createEditorService();
        service.openFile(writeFile("a.ts"));
        const source = service.activeGroup;

        service.openFile(writeFile("b.ts"), { group: "beside", preview: true });

        expect(source.previewPane).toBe(null);
        expect(service.activeGroup === source).toBe(false);
        expect(service.activeGroup.previewPane?.label).toBe("b.ts");
    });

    describe("настройка workbench.editor.enablePreview", () => {
        it("выключенная — превью не создаётся, вкладки копятся", () => {
            const service = createEditorService(switchableConfig(false).service);

            service.openFile(writeFile("a.ts"), { preview: true });
            service.openFile(writeFile("b.ts"), { preview: true });

            expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
            expect(service.activeGroup.previewPane).toBe(null);
        });

        it("выключение на ходу прикалывает уже открытое превью", () => {
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });
            expect(service.activeGroup.previewPane?.label).toBe("a.ts");

            config.set(false);

            expect(service.activeGroup.previewPane).toBe(null);
            service.openFile(writeFile("b.ts"), { preview: true });
            expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        });

        it("событие по ключу превью при ВКЛЮЧЁННОЙ настройке предпросмотр не снимает", () => {
            // Пересохранение settings.json шлёт событие по ключу, даже когда
            // значение то же: прикалывать превью имеет право только ВЫКЛЮЧЕНИЕ.
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });

            config.set(true);

            expect(service.activeGroup.previewPane?.label).toBe("a.ts");
            service.openFile(writeFile("b.ts"), { preview: true });
            expect(tabs(service)).toEqual(["b.ts"]);
        });

        it("включение на ходу открытые вкладки не трогает", () => {
            const config = switchableConfig(false);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });

            config.set(true);

            expect(service.activeGroup.previewPane).toBe(null);
            service.openFile(writeFile("b.ts"), { preview: true });
            expect(tabs(service)).toEqual(["a.ts", "b.ts"]);
        });

        it("выключение не будит группы, где превью и не было", () => {
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });
            const withPreview = service.activeGroup;
            const second = service.newGroup("after");
            if (second === null) throw new Error("вторая группа не создалась");
            service.openFile(writeFile("b.ts"), { group: second });
            let quietGroupEvents = 0;
            second.onDidChangeEditors(() => quietGroupEvents++);

            config.set(false);

            // Прикалывать в группе без превью нечего: лишнее событие — это
            // лишняя перерисовка полосы у половины сплита, которую не трогали.
            expect(quietGroupEvents).toBe(0);
            expect(withPreview.previewPane).toBe(null);
        });

        it("выключение прикалывает превью во ВСЕХ группах полосы", () => {
            const config = switchableConfig(true);
            const service = createEditorService(config.service);
            service.openFile(writeFile("a.ts"), { preview: true });
            const first = service.activeGroup;
            service.openFile(writeFile("b.ts"), { group: "beside", preview: true });
            const second = service.activeGroup;
            expect(first.previewPane?.label).toBe("a.ts");
            expect(second.previewPane?.label).toBe("b.ts");

            config.set(false);

            expect(first.previewPane).toBe(null);
            expect(second.previewPane).toBe(null);
        });
    });
});

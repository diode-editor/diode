import { describe, expect, it, vi } from "vitest";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";

import { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";
import { createTempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

/**
 * Шов «в группе может жить панель не только текстового вида». Проверяем на
 * фейковой панели: настоящий второй вид (дифф) появится на этапе 5, но
 * абстракция обязана держать его уже сейчас — иначе она декоративная.
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
    );
}

/** Минимальная панель не-текстового вида — ровно контракт IEditorPane, без текста. */
class FakePane implements IEditorPane {
    public readonly view = new TUIElement();
    public isModified = false;
    public readonly readOnly = false;
    public disposed = false;
    private readonly listeners: (() => void)[] = [];

    public readonly label: string;

    public constructor(public readonly uri: Uri) {
        this.view.id = `fake-${uri.path}`;
        this.label = uri.path;
    }

    public onDidChangeState(cb: () => void): { dispose: () => void } {
        this.listeners.push(cb);
        return {
            dispose: () => {
                const idx = this.listeners.indexOf(cb);
                if (idx >= 0) this.listeners.splice(idx, 1);
            },
        };
    }

    /** Имитация «во вкладке что-то поменялось» (маркер правки). */
    public markModified(): void {
        this.isModified = true;
        for (const cb of [...this.listeners]) cb();
    }

    public focusEditor(): void {
        // Фокус фейковой панели никуда не ведёт — важно лишь, что группа его зовёт.
    }

    public getSelectedText(): string {
        return ""; // понятия выделения у панели нет
    }

    public dispose(): void {
        this.disposed = true;
    }
}

const fakeUri = (name: string) => Uri.from({ scheme: "fake", path: `/${name}` });

describe("EditorService — панели не-текстового вида", () => {
    it("открытая панель становится вкладкой и активной", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));

        service.openPane(pane);

        expect(service.editorCount).toBe(1);
        expect(service.getActivePane()).toBe(pane);
        expect(service.getPanes()).toEqual([pane]);
        expect(service.displayName(pane)).toBe("/diff");
    });

    it("группа получает view панели и событие перерисовки", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));
        const changed = vi.fn();
        service.onDidChangeEditors(changed);

        service.openPane(pane);
        expect(service.getActivePane()?.view).toBe(pane.view);

        const afterOpen = changed.mock.calls.length;
        pane.markModified();

        // onDidChangeState панели доходит до группы — таб перерисуется с маркером.
        expect(changed.mock.calls.length).toBe(afterOpen + 1);
    });

    it("повторное открытие того же ресурса переключает, а не заводит вторую вкладку", () => {
        const service = createEditorService();
        service.openPane(new FakePane(fakeUri("diff")));
        service.openPane(new FakePane(fakeUri("other")));

        const duplicate = new FakePane(fakeUri("diff"));
        service.openPane(duplicate);

        expect(service.editorCount).toBe(2);
        expect(service.activeIndex).toBe(0);
        // Лишнюю панель обязаны утилизировать, иначе она утечёт.
        expect(duplicate.disposed).toBe(true);
    });

    it("закрытие вкладки утилизирует панель", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));
        service.openPane(pane);

        service.closeTab(0);

        expect(service.editorCount).toBe(0);
        expect(pane.disposed).toBe(true);
        expect(service.getActivePane()).toBeNull();
    });

    it("фокус группы доходит до панели", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));
        const focus = vi.spyOn(pane, "focusEditor");

        service.openPane(pane);
        service.focusEditor();

        expect(focus).toHaveBeenCalled();
    });
});

describe("EditorService — сужение текстовой поверхности", () => {
    it("пока активна не-текстовая панель, текстовые геттеры дают null", () => {
        const service = createEditorService();
        const pane = new FakePane(fakeUri("diff"));

        service.openPane(pane);

        expect(service.getActivePane()).toBe(pane);
        expect(service.getActiveEditor()).toBeNull();
        expect(service.getEditor(0)).toBeNull();
        expect(service.getEditors()).toEqual([]);
    });

    it("подписчики активного редактора видят переключение на дифф как «нет редактора»", () => {
        // Это и есть причина сужения: статус-бар, find, host-адаптеры не должны
        // получать панель, у которой нет ни курсора, ни языка, ни кодировки.
        const service = createEditorService();
        const seen: unknown[] = [];
        service.onActiveEditorChanged((editor) => seen.push(editor));

        service.openPane(new FakePane(fakeUri("diff")));

        expect(seen).toEqual([null]);
    });

    it("команды правки текста на не-текстовой панели — no-op, а не падение", () => {
        const service = createEditorService();
        service.openPane(new FakePane(fakeUri("diff")));

        // Так выглядит каждая из 26 команд в editorActions.ts.
        expect(() => service.getActiveEditor()?.viewState.cursorDown()).not.toThrow();
        expect(() => service.getActiveEditor()?.save()).not.toThrow();
    });
});

describe("EditorService — смешанная группа", () => {
    const openMixed = () => {
        const ws = createTempWorkspace({ prefix: "vexx-panes-", files: { "a.ts": "alpha\n" } });
        const service = createEditorService();
        service.openFile(ws.path("a.ts"));
        const pane = new FakePane(fakeUri("diff"));
        service.openPane(pane);
        return { ws, service, pane };
    };

    it("вкладки обоих видов живут рядом и переключаются", () => {
        const { ws, service, pane } = openMixed();
        try {
            expect(service.editorCount).toBe(2);
            expect(service.getActivePane()).toBe(pane);

            service.activateTab(0);

            expect(service.getActiveEditor()?.uri.fsPath).toBe(ws.path("a.ts"));
            expect(service.getPanes()).toHaveLength(2);
        } finally {
            service.dispose();
            ws.dispose();
        }
    });

    it("MRU видит обе вкладки", () => {
        const { ws, service, pane } = openMixed();
        try {
            service.activateTab(0);
            service.cycleMru(1);

            expect(service.getActivePane()).toBe(pane);
            expect(service.getMruOrder()).toHaveLength(2);
        } finally {
            service.dispose();
            ws.dispose();
        }
    });

    it("сессия и shutdown видят только текстовые вкладки", () => {
        const { ws, service } = openMixed();
        try {
            // Не-текстовую вкладку нечего восстанавливать по пути и нечего сохранять.
            expect(service.getOpenFilePaths()).toEqual([ws.path("a.ts")]);
            expect(service.collectDirty()).toEqual([]);

            service.activateTab(0);
            service.getActiveEditor()?.viewState.type("X");

            expect(service.collectDirty().map((item) => item.name)).toEqual(["a.ts"]);
        } finally {
            service.dispose();
            ws.dispose();
        }
    });
});

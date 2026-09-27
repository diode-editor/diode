import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { EXTENSIONS_VIEWLET_ID } from "../contrib/extensions/browser/extensionsComponent.ts";
import { EXPLORER_VIEWLET_ID } from "../contrib/files/browser/explorerComponent.ts";

import { SidebarServiceDIToken } from "./parts/sidebar/sidebarService.ts";

/**
 * Пустое окно (`diode` без аргументов): воркспейса нет, но оболочка обязана быть
 * рабочей. До расцепа вьюлетов и `setWorkspaceFolder` сайдбар в этом состоянии
 * не собирался вовсе — из окна нельзя было даже открыть папку.
 */
describe("Workbench — окно без воркспейса", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function screen(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-empty-window-", files: { "alpha.txt": "Alpha" } });
        // Ни workspaceFolder, ни openFile — ровно как запуск без аргументов.
        h = createAppTestHarness({ size: new Size(80, 24) });
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("сайдбар собран и показывает Explorer с подсказкой вместо дерева", () => {
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).toBe(EXPLORER_VIEWLET_ID);
        const shown = screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).toContain("No folder opened.");
    });

    it("остальные вьюлеты тоже на месте — магазин открывается без папки", () => {
        h.commands.execute("workbench.view.extensions");
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).toBe(EXTENSIONS_VIEWLET_ID);
        expect(screen()).toContain("EXTENSIONS");
    });

    it("не открывает ни одного редактора", () => {
        expect(h.container.get(SidebarServiceDIToken).getActiveViewletId()).not.toBeNull();
        expect(h.testApp.querySelectorAll("TreeViewElement")).toHaveLength(0);
    });

    // Тест НАРОЧНО не зовёт `activate()`: Open Folder в живом приложении его не
    // зовёт тоже, а `TreeViewElement` грузит узлы только через refresh(). Без
    // refresh внутри setWorkspaceFolder подсказка пропадала, а дерево оставалось
    // пустым — панель выглядела сломанной.
    it("Open Folder из пустого окна наполняет дерево, а не просто убирает подсказку", async () => {
        h.workbench.setWorkspaceFolder(ws.dir);
        await h.workbench.fileIndexReady;
        await vi.waitFor(() => {
            expect(screen()).toContain("alpha.txt");
        });

        const shown = screen();
        expect(shown).toContain("EXPLORER");
        expect(shown).not.toContain("No folder opened.");
    });
});

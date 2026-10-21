import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { getFileIcon } from "../../base/common/fileIcons.ts";
import {
    type ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../platform/keybinding/common/modifierReleaseArmory.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import type { TabSwitcherComponent } from "./parts/editor/tabSwitcherComponent.ts";
import { TabSwitcherComponentDIToken } from "./parts/editor/tabSwitcherComponent.ts";

describe("Workbench — оверлей Ctrl+Tab и цикл Ctrl+PgUp/PgDn", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let switcher: TabSwitcherComponent;
    let armory: ModifierReleaseArmory;
    let editorService: IEditorService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-tabswitcher-",
            files: { "a.ts": "// a", "b.ts": "// b", "c.ts": "// c" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        h.workbench.openFile(ws.path("a.ts"));
        h.workbench.openFile(ws.path("b.ts"));
        h.workbench.openFile(ws.path("c.ts"));
        h.workbench.focusEditor();
        h.testApp.render();
        switcher = h.container.get(TabSwitcherComponentDIToken);
        armory = h.container.get(ModifierReleaseArmoryDIToken);
        editorService = h.container.get(EditorServiceDIToken);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function activeName(): string | null {
        return h.activeEditor().fileName;
    }

    it("Ctrl+Tab показывает MRU-список с позицией цикла; отпускание Ctrl гасит и фиксирует", () => {
        expect(switcher.isOpen()).toBe(false);

        // An edit in the active tab (c.ts): the overlay must show the ● marker for it.
        h.testApp.sendKey("x");
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();

        expect(activeName()).toBe("b.ts");
        expect(switcher.isOpen()).toBe(true);
        expect(switcher.view.inspectState()).toMatchObject({
            items: ["c.ts", "b.ts", "a.ts"],
            currentIndex: 1,
        });

        const frame = h.testApp.backend.screenToString();
        const tsIcon = getFileIcon("c.ts").icon;
        expect(frame).toMatch(new RegExp(`│\\s*${tsIcon} c\\.ts\\s+● │`));
        expect(frame).toMatch(new RegExp(`│\\s*${tsIcon} a\\.ts\\s+│`));

        // Like the quick pick: horizontally centered, ~10% from the top; width 48 at 80×24.
        expect(switcher.view.globalPosition.x).toBe(16);
        expect(switcher.view.globalPosition.y).toBe(2);
        expect(switcher.view.layoutSize.width).toBe(48);
        expect(switcher.view.layoutSize.height).toBe(5);

        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(activeName()).toBe("a.ts");
        expect(switcher.view.inspectState()).toMatchObject({ currentIndex: 2 });
        const rowBg = (y: number) => h.testApp.backend.getBgAt(new Point(20, y));
        // Overlay at (16,2): border y=2, rows y=3..5; the current one is the third (y=5).
        expect(rowBg(4)).toBe(rowBg(3));
        expect(rowBg(5)).not.toBe(rowBg(3));

        armory.fireRelease("Control");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(false);
        expect(editorService.editorGroups.activeGroup.getMruOrder()[0]?.label).toBe("a.ts");
        const frameAfter = h.testApp.backend.screenToString();
        expect(frameAfter).not.toMatch(/│\s*\S+ c\.ts.*│/);
    });

    // A legacy terminal never sends the modifier keyup, so the series must end
    // without it too: otherwise the list would hang over the editor until the
    // next switch.
    it("любая другая клавиша завершает серию: список гаснет, выбор зафиксирован", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(true);
        expect(activeName()).toBe("b.ts");

        h.testApp.sendKey("ArrowDown");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(false);
        expect(activeName()).toBe("b.ts");
        expect(editorService.editorGroups.activeGroup.getMruOrder()[0]?.label).toBe("b.ts");
    });

    it("повторный Ctrl+Tab серию не рвёт — цикл идёт вглубь с живым списком", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(true);
        expect(activeName()).toBe("a.ts");
        expect(switcher.view.inspectState()).toMatchObject({ currentIndex: 2 });
    });

    it("Ctrl+Shift+Tab идёт по MRU в обратную сторону с тем же оверлеем", () => {
        h.testApp.sendKey("Ctrl+Shift+Tab");
        h.testApp.render();

        expect(activeName()).toBe("a.ts");
        expect(switcher.isOpen()).toBe(true);
        expect(switcher.view.inspectState()).toMatchObject({ currentIndex: 2 });
    });

    it("Ctrl+PgDn/PgUp циклируют по визуальному порядку вкладок без оверлея", () => {
        // c is active (opened last); visual order: a, b, c.
        h.testApp.sendKey("Ctrl+PageDown");
        h.testApp.render();
        expect(activeName()).toBe("a.ts");
        expect(switcher.isOpen()).toBe(false);

        h.testApp.sendKey("Ctrl+PageUp");
        h.testApp.render();
        expect(activeName()).toBe("c.ts");
        expect(switcher.isOpen()).toBe(false);

        // The MRU order was updated along the way (each step commits immediately): a
        // Ctrl+Tab series after the visual cycle starts from it, not from the old MRU.
        expect(editorService.editorGroups.activeGroup.getMruOrder()[0]?.label).toBe("c.ts");
    });

    it("Alt+PgDn/PgUp — дубли визуального цикла для терминалов, где Ctrl+PgDn занят", () => {
        h.testApp.sendKey("Alt+PageDown");
        h.testApp.render();
        expect(activeName()).toBe("a.ts");

        h.testApp.sendKey("Alt+PageUp");
        h.testApp.render();
        expect(activeName()).toBe("c.ts");
    });

    it("вне текстового фокуса (дерево файлов) Ctrl+PgDn вкладку не переключает", () => {
        const tree = h.testApp.querySelector("TreeViewElement");
        expect(tree).not.toBeNull();
        tree!.focus();
        h.testApp.render();

        h.testApp.sendKey("Ctrl+PageDown");
        h.testApp.render();

        expect(activeName()).toBe("c.ts");
    });

    it("оверлей пассивный: глобальные бинды не гасятся, пока он на экране", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(true);

        // A non-focus global binding (Ctrl+B, no when) must fire over the
        // visible overlay — the session doesn't set capturesKeyboard, unlike the quick pick.
        const layout = h.testApp.querySelector("WorkbenchLayoutElement") as unknown as {
            getLeftPanelVisible: () => boolean;
        };
        const before = layout.getLeftPanelVisible();
        h.testApp.sendKey("Ctrl+B");
        expect(layout.getLeftPanelVisible()).toBe(!before);
    });

    it("сплит во время серии Ctrl+Tab гасит оверлей (страховка по смене активной группы)", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(true);

        h.commands.execute("workbench.action.splitEditor");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(false);
    });

    it("узкий терминал: оверлей ужимается до ширины экрана минус поля", () => {
        const narrowWs = createTempWorkspace({
            prefix: "diode-tabswitcher-narrow-",
            files: { "a.ts": "// a", "b.ts": "// b" },
        });
        const narrow = createAppTestHarness({ workspaceFolder: narrowWs.dir, size: new Size(40, 24) });
        try {
            narrow.workbench.openFile(narrowWs.path("a.ts"));
            narrow.workbench.openFile(narrowWs.path("b.ts"));
            narrow.workbench.focusEditor();
            narrow.testApp.render();

            narrow.testApp.sendKey("Ctrl+Tab");
            narrow.testApp.render();

            const view = narrow.container.get(TabSwitcherComponentDIToken).view;
            // min(48, max(24, 40−4)) = 36; center: (40−36)/2 = 2.
            expect(view.layoutSize.width).toBe(36);
            expect(view.globalPosition.x).toBe(2);
        } finally {
            narrow.dispose();
            narrowWs.dispose();
        }
    });

    it("визуальный шаг во время серии Ctrl+Tab гасит оверлей", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(true);

        h.testApp.sendKey("Ctrl+PageDown");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(false);
    });
});

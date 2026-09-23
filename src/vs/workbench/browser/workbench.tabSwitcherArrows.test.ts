import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import {
    type ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../platform/keybinding/common/modifierReleaseArmory.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import type { TabSwitcherComponent } from "./parts/editor/tabSwitcherComponent.ts";
import { TabSwitcherComponentDIToken } from "./parts/editor/tabSwitcherComponent.ts";

/** Длинный файл — чтобы у редактора было куда скроллиться (сценарии «стрелка не протекла»). */
const LONG_TEXT = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");

describe("Workbench — стрелки Вверх/Вниз в видимом списке Ctrl+Tab", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let switcher: TabSwitcherComponent;
    let armory: ModifierReleaseArmory;
    let editorService: EditorService;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-tabswitcher-arrows-",
            files: { "a.ts": LONG_TEXT, "b.ts": LONG_TEXT, "c.ts": LONG_TEXT },
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

    /** Позиция цикла в оверлее — номер подсвеченной строки списка. */
    function pointer(): number {
        return (switcher.view.inspectState() as { currentIndex: number }).currentIndex;
    }

    it("Ctrl+Вниз шагает вглубь, как Tab: список жив, вкладка под ним сменилась", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(pointer()).toBe(1);
        expect(activeName()).toBe("b.ts");

        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(true);
        expect(pointer()).toBe(2);
        expect(activeName()).toBe("a.ts");
        // Состав списка при этом заморожен — стрелка двигает только позицию.
        expect(switcher.view.inspectState()).toMatchObject({ items: ["c.ts", "b.ts", "a.ts"], currentIndex: 2 });
    });

    it("Ctrl+Вверх возвращает назад, как Shift+Tab", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(activeName()).toBe("a.ts");

        h.testApp.sendKey("Ctrl+ArrowUp");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(true);
        expect(pointer()).toBe(1);
        expect(activeName()).toBe("b.ts");
    });

    it("стрелки и Tab вперемешку — одна серия: список ни разу не гаснет", () => {
        const seen: (number | boolean)[] = [];
        for (const key of ["Ctrl+Tab", "Ctrl+ArrowDown", "Ctrl+Shift+Tab", "Ctrl+ArrowDown"]) {
            h.testApp.sendKey(key);
            h.testApp.render();
            seen.push(switcher.isOpen());
            seen.push(pointer());
        }

        expect(seen).toEqual([true, 1, true, 2, true, 1, true, 2]);
        expect(activeName()).toBe("a.ts");
    });

    it("отпускание Ctrl фиксирует выбранную стрелкой вкладку наверху MRU-стека", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(activeName()).toBe("a.ts");

        armory.fireRelease("Control");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(false);
        expect(activeName()).toBe("a.ts");
        // Выбранная стрелкой вкладка встала наверх MRU — ровно как если бы её
        // довели Tab'ом: следующая серия начинает отсчёт от неё.
        expect(editorService.getMruOrder().map((pane) => pane.label)).toEqual(["a.ts", "c.ts", "b.ts"]);

        h.testApp.sendKey("Ctrl+Tab");
        armory.fireRelease("Control");
        h.testApp.render();
        expect(activeName()).toBe("c.ts");
    });

    it("стрелки не протекают в редактор: курсор и прокрутка на месте", () => {
        const editor = h.activeEditor();
        editor.viewState.goToPosition(4, 0); // 0-based: Ln 5, Col 1 в статус-баре
        editor.viewState.scrollTop = 0;
        h.testApp.render();

        h.testApp.sendKey("Ctrl+Tab");
        for (let i = 0; i < 3; i++) h.testApp.sendKey("Ctrl+ArrowDown");
        for (let i = 0; i < 3; i++) h.testApp.sendKey("Ctrl+ArrowUp");
        h.testApp.render();

        // Tab + 3×Вниз + 3×Вверх = тот же шаг, что дал один Tab: позиция 1 (b.ts).
        expect(activeName()).toBe("b.ts");
        expect(switcher.isOpen()).toBe(true);
        expect(editor.viewState.scrollTop).toBe(0);
        expect(editor.viewState.primaryCursorLine).toBe(4);
        expect(editor.viewState.primaryCursorColumn).toBe(0);
        expect(editor.model.getText()).toBe(LONG_TEXT);
    });

    it("на концах списка стрелка заворачивает, список остаётся виден", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(pointer()).toBe(2); // последняя строка

        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(pointer()).toBe(0); // завернулись на первую
        expect(switcher.isOpen()).toBe(true);

        h.testApp.sendKey("Ctrl+ArrowUp");
        h.testApp.render();
        expect(pointer()).toBe(2); // и обратно с первой на последнюю
        expect(switcher.isOpen()).toBe(true);
    });

    it("серия, начатая с Ctrl+Shift+Tab: направление стрелок привязано к списку", () => {
        h.testApp.sendKey("Ctrl+Shift+Tab");
        h.testApp.render();
        expect(pointer()).toBe(2); // подсветка на последней строке

        // Shift пользователь обычно не отпускает — стрелка обязана работать и с ним.
        h.testApp.sendKey("Ctrl+Shift+ArrowDown");
        h.testApp.render();
        expect(pointer()).toBe(0);
        expect(switcher.isOpen()).toBe(true);

        h.testApp.sendKey("Ctrl+Shift+ArrowUp");
        h.testApp.render();
        expect(pointer()).toBe(2);
        expect(switcher.isOpen()).toBe(true);
    });

    it("Escape при удержанном Ctrl гасит список и оставляет подсвеченную вкладку", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(activeName()).toBe("a.ts");

        h.testApp.sendKey("Escape");
        h.testApp.render();

        expect(switcher.isOpen()).toBe(false);
        expect(activeName()).toBe("a.ts");
        expect(editorService.getMruOrder()[0]?.label).toBe("a.ts");
    });

    it("после того как список погас, Ctrl+Вниз снова прокручивает редактор", () => {
        // До всякой серии: прокрутка работает, списка нет.
        const before = h.activeEditor();
        before.viewState.scrollTop = 0;
        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(before.viewState.scrollTop).toBe(1);
        expect(switcher.isOpen()).toBe(false);

        // Серия открылась и погасла — прокрутка вернулась, список не всплывает.
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(true);
        armory.fireRelease("Control");
        h.testApp.render();
        expect(switcher.isOpen()).toBe(false);

        const after = h.activeEditor();
        after.viewState.scrollTop = 0;
        h.testApp.sendKey("Ctrl+ArrowDown");
        h.testApp.render();
        expect(after.viewState.scrollTop).toBe(1);
        expect(switcher.isOpen()).toBe(false);

        h.testApp.sendKey("Ctrl+ArrowUp");
        h.testApp.render();
        expect(after.viewState.scrollTop).toBe(0);
        expect(switcher.isOpen()).toBe(false);
    });

    it("стрелки без модификаторов не изменились: курсор идёт по строкам, списка нет", () => {
        const editor = h.activeEditor();
        editor.viewState.goToPosition(4, 0);

        h.testApp.sendKey("ArrowDown");
        h.testApp.render();
        expect(editor.viewState.primaryCursorLine).toBe(5);
        expect(switcher.isOpen()).toBe(false);

        h.testApp.sendKey("ArrowUp");
        h.testApp.render();
        expect(editor.viewState.primaryCursorLine).toBe(4);
        expect(switcher.isOpen()).toBe(false);
    });

    it("список длиннее окна: окно едет за подсветкой и возвращается назад", () => {
        const manyWs = createTempWorkspace({
            prefix: "diode-tabswitcher-arrows-many-",
            files: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.ts`, `// ${i}`])),
        });
        const many = createAppTestHarness({ workspaceFolder: manyWs.dir });
        try {
            for (let i = 0; i < 12; i++) many.workbench.openFile(manyWs.path(`f${i}.ts`));
            many.workbench.focusEditor();
            many.testApp.render();
            const view = many.container.get(TabSwitcherComponentDIToken).view;

            many.testApp.sendKey("Ctrl+Tab");
            many.testApp.render();
            // Показано не больше maxVisibleItems строк, окно стоит у начала.
            expect(view.inspectState()).toMatchObject({ currentIndex: 1, windowStart: 0 });

            // Шагаем вниз до нижнего края окна и дальше — окно едет за подсветкой.
            for (let i = 0; i < 10; i++) many.testApp.sendKey("Ctrl+ArrowDown");
            many.testApp.render();
            expect(view.inspectState()).toMatchObject({ currentIndex: 11, windowStart: 2 });

            // Вверх — окно едет обратно.
            for (let i = 0; i < 11; i++) many.testApp.sendKey("Ctrl+ArrowUp");
            many.testApp.render();
            expect(view.inspectState()).toMatchObject({ currentIndex: 0, windowStart: 0 });
        } finally {
            many.dispose();
            manyWs.dispose();
        }
    });

    it("одна открытая вкладка: списка нет, Ctrl+Вниз прокручивает редактор", () => {
        const oneWs = createTempWorkspace({ prefix: "diode-tabswitcher-arrows-one-", files: { "only.ts": LONG_TEXT } });
        const one = createAppTestHarness({ workspaceFolder: oneWs.dir });
        try {
            one.workbench.openFile(oneWs.path("only.ts"));
            one.workbench.focusEditor();
            one.testApp.render();
            const switcherOne = one.container.get(TabSwitcherComponentDIToken);

            one.testApp.sendKey("Ctrl+Tab");
            one.testApp.render();
            expect(switcherOne.isOpen()).toBe(false);

            // Ctrl+Tab при одной вкладке не резолвится (`editorTabsMultiple`),
            // значит никто не зовёт preventDefault — и движок крутит кольцо
            // фокуса по Tab, не глядя на модификаторы, уводя фокус в меню-бар.
            // Это не наш код и не регресс этой задачи (на main то же самое);
            // починено в tuidom (`fix(core)`, PR tuidom#5, релиз 0.2.2) — когда
            // версия выйдет и пин поднимется, обход ниже можно снять и проверять
            // сценарий 12 напрямую. Пока возвращаем фокус в текст и проверяем
            // то, что относится к стрелкам: без видимого списка Ctrl+Вниз — это
            // прокрутка.
            one.workbench.focusEditor();
            one.activeEditor().viewState.scrollTop = 0;
            one.testApp.sendKey("Ctrl+ArrowDown");
            one.testApp.render();
            expect(one.activeEditor().viewState.scrollTop).toBe(1);
            expect(switcherOne.isOpen()).toBe(false);
        } finally {
            one.dispose();
            oneWs.dispose();
        }
    });
});

import { describe, expect, it, vi } from "vitest";

import { TUIElement } from "@tuidom/all/dom/tuiElement";
import { PanelContainerElement } from "@tuidom/all/ui/panel/panelContainerElement";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { PanelComponent } from "./panelComponent.ts";
import { PanelService } from "./panelService.ts";

function makeHarness() {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const service = new PanelService();
    const component = new PanelComponent(service);
    return { themeService, service, component };
}

describe("PanelComponent", () => {
    it("reflects views registered before and after construction", () => {
        const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const service = new PanelService();
        service.addView({ id: "problems", title: "PROBLEMS", content: null, placeholder: "empty" });

        const component = new PanelComponent(service);
        // Вкладка, зарегистрированная ДО компонента, подхвачена начальным sync'ом.
        expect(component.view.getViewIds()).toEqual(["problems"]);
        expect(component.view.getActiveViewId()).toBe("problems");

        service.addView({ id: "terminal", title: "TERMINAL", content: null });
        expect(component.view.getViewIds()).toEqual(["problems", "terminal"]);
        component.dispose();
    });

    it("follows the service's active view", () => {
        const { service, component } = makeHarness();
        service.addView({ id: "problems", title: "PROBLEMS" });
        service.addView({ id: "terminal", title: "TERMINAL" });
        expect(component.view.getActiveViewId()).toBe("problems");

        service.setActiveView("terminal");
        expect(component.view.getActiveViewId()).toBe("terminal");
        component.dispose();
    });

    it("routes a tab click back into the service as a user activation", () => {
        const { service, component } = makeHarness();
        service.addView({ id: "problems", title: "PROBLEMS" });
        service.addView({ id: "terminal", title: "TERMINAL" });
        const onActivate = vi.fn();
        service.onDidActivateView(onActivate);

        // Контрол уже переключил вкладку у себя и зовёт onActivateView — компонент
        // синхронизирует сервис и будит подписчиков активации (ленивые фичи).
        component.view.setActiveView("terminal");
        component.view.onActivateView?.("terminal");

        expect(service.getActiveViewId()).toBe("terminal");
        expect(onActivate).toHaveBeenCalledWith("terminal");
        component.dispose();
    });

    it("pushes content swaps into the control, leaving untouched views alone", () => {
        const { service, component } = makeHarness();
        service.addView({ id: "problems", title: "PROBLEMS", placeholder: "empty" });
        service.addView({ id: "terminal", title: "TERMINAL" });

        const tree = new TUIElement();
        service.setViewContent("problems", tree);
        // Активная вкладка — problems: её контент в детях контрола и не скрыт.
        expect(component.view.getChildren()).toContain(tree);
        expect(tree.hidden).toBe(false);

        // Смена контента другой вкладки не перевешивает контент problems.
        const setViewContent = vi.spyOn(component.view, "setViewContent");
        const widget = new TUIElement();
        service.setViewContent("terminal", widget);
        expect(setViewContent).toHaveBeenCalledTimes(1);
        expect(setViewContent).toHaveBeenCalledWith("terminal", widget);
        setViewContent.mockRestore();

        service.setViewContent("problems", null);
        // Контент problems отцеплен; виджет terminal остаётся скрытым ребёнком.
        expect(component.view.getChildren()).not.toContain(tree);
        expect(tree.getParent()).toBeNull();
        expect(component.view.getChildren()).toContain(widget);
        expect(widget.hidden).toBe(true);
        component.dispose();
    });
});

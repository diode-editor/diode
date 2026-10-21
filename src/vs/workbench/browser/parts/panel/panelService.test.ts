import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { describe, expect, it, vi } from "vitest";

import { PanelService } from "./panelService.ts";

describe("PanelService — view registry", () => {
    it("registers views in order; the first one becomes active", () => {
        const service = new PanelService();
        expect(service.getActiveViewId()).toBeNull();

        service.addView({ id: "problems", title: "PROBLEMS", content: null, placeholder: "no problems" });
        service.addView({ id: "terminal", title: "TERMINAL", content: null, placeholder: "no terminal" });

        expect(service.getViews().map((v) => v.id)).toEqual(["problems", "terminal"]);
        expect(service.getViews()[0].placeholder).toBe("no problems");
        expect(service.getActiveViewId()).toBe("problems");
    });

    it("fires onDidChangeViews on registration and content swap", () => {
        const service = new PanelService();
        const onViews = vi.fn();
        service.onDidChangeViews(onViews);

        service.addView({ id: "problems", title: "PROBLEMS" });
        expect(onViews).toHaveBeenCalledTimes(1);
        expect(service.getViews()[0].content).toBeNull();

        const content = new TUIElement();
        service.setViewContent("problems", content);
        expect(onViews).toHaveBeenCalledTimes(2);
        expect(service.getViews()[0].content).toBe(content);

        service.setViewContent("problems", null);
        expect(service.getViews()[0].content).toBeNull();
    });

    it("ignores content for an unknown view id", () => {
        const service = new PanelService();
        const onViews = vi.fn();
        service.onDidChangeViews(onViews);

        service.setViewContent("missing", new TUIElement());
        expect(onViews).not.toHaveBeenCalled();
    });

    it("switches the active view and notifies; unknown or same id is a no-op", () => {
        const service = new PanelService();
        service.addView({ id: "problems", title: "PROBLEMS" });
        service.addView({ id: "terminal", title: "TERMINAL" });
        const onActive = vi.fn();
        service.onDidChangeActiveView(onActive);

        service.setActiveView("terminal");
        expect(service.getActiveViewId()).toBe("terminal");
        expect(onActive).toHaveBeenCalledWith("terminal");

        service.setActiveView("terminal");
        service.setActiveView("missing");
        expect(onActive).toHaveBeenCalledTimes(1);
        expect(service.getActiveViewId()).toBe("terminal");
    });

    it("activateView switches the tab AND fires the user-activation event", () => {
        // Lazy features (terminal spawn) listen to the activation event; only a "click" should wake them.
        const service = new PanelService();
        service.addView({ id: "problems", title: "PROBLEMS" });
        service.addView({ id: "terminal", title: "TERMINAL" });
        const onActivate = vi.fn();
        service.onDidActivateView(onActivate);

        service.setActiveView("terminal");
        expect(onActivate).not.toHaveBeenCalled();

        service.activateView("problems");
        expect(service.getActiveViewId()).toBe("problems");
        expect(onActivate).toHaveBeenCalledWith("problems");

        service.activateView("problems");
        expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it("tracks visibility and notifies only on real changes", () => {
        const service = new PanelService();
        const onVisibility = vi.fn();
        service.onDidChangeVisibility(onVisibility);
        expect(service.visible).toBe(false);

        service.setVisible(true);
        expect(service.visible).toBe(true);
        expect(onVisibility).toHaveBeenCalledWith(true);

        service.setVisible(true);
        expect(onVisibility).toHaveBeenCalledTimes(1);

        service.setVisible(false);
        expect(onVisibility).toHaveBeenCalledWith(false);
    });

    it("subscription dispose unhooks the listener", () => {
        const service = new PanelService();
        const onViews = vi.fn();
        const subscription = service.onDidChangeViews(onViews);
        subscription.dispose();

        service.addView({ id: "problems", title: "PROBLEMS" });
        expect(onViews).not.toHaveBeenCalled();
    });

    it("setViewActions for an unknown tab — no-op", () => {
        const service = new PanelService();
        service.addView({ id: "a", title: "A" });
        let fired = 0;
        service.onDidChangeViews(() => fired++);

        service.setViewActions("nope", null);

        expect(fired).toBe(0);
    });
});

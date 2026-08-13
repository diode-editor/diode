import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../testing/renderElement.ts";
import { Point } from "../../common/geometryPromitives.ts";
import { TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import type { RenderContext } from "../../dom/tuiElement.ts";
import { TUIElement } from "../../dom/tuiElement.ts";

import { PanelContainerElement } from "./panelContainerElement.ts";

/** Простейший контрол-заглушка вместо селектора: рисует свою метку. */
class LabelStub extends TUIElement {
    public constructor(private readonly label: string) {
        super();
    }

    public override getMinIntrinsicWidth(): number {
        return this.label.length;
    }

    public override getMaxIntrinsicWidth(): number {
        return this.label.length;
    }

    public override getMinIntrinsicHeight(): number {
        return 1;
    }

    public override getMaxIntrinsicHeight(): number {
        return 1;
    }

    public override render(context: RenderContext): void {
        for (let i = 0; i < this.label.length; i++) {
            context.setCell(i, 0, { char: this.label[i] });
        }
    }
}

function panelWithActions(actions: TUIElement | null, width = 60) {
    const panel = new PanelContainerElement();
    panel.addView({ id: "problems", title: "PROBLEMS", content: null });
    panel.addView({ id: "output", title: "OUTPUT", content: null, actions });
    panel.setActiveView("output");
    const backend = renderElement(panel, width, 8);
    return { panel, backend, text: backend.screenToString() };
}

describe("PanelContainerElement: контролы вкладки в шапке", () => {
    it("рисует контролы активной вкладки, прижав их вправо", () => {
        const { backend } = panelWithActions(new LabelStub("Bootstrap"));

        // Строка табов — вторая (после верхней рамки); метка должна кончаться у
        // правого края, а не идти сразу за табами.
        const row = backend.getTextAt(new Point(0, 1), 60);
        expect(row).toContain("PROBLEMS");
        expect(row.trimEnd().endsWith("Bootstrap")).toBe(true);
    });

    it("контролы неактивной вкладки не показываются", () => {
        const panel = new PanelContainerElement();
        panel.addView({ id: "output", title: "OUTPUT", content: null, actions: new LabelStub("Bootstrap") });
        panel.addView({ id: "problems", title: "PROBLEMS", content: null });
        panel.setActiveView("problems");

        const backend = renderElement(panel, 60, 8);

        expect(backend.screenToString()).not.toContain("Bootstrap");
    });

    it("setViewActions подменяет и снимает контролы", () => {
        const { panel } = panelWithActions(new LabelStub("Bootstrap"));

        panel.setViewActions("output", new LabelStub("Extensions"));
        expect(renderElement(panel, 60, 8).screenToString()).toContain("Extensions");

        panel.setViewActions("output", null);
        expect(renderElement(panel, 60, 8).screenToString()).not.toContain("Extensions");
    });

    it("setViewActions по неизвестной вкладке — no-op", () => {
        const { panel } = panelWithActions(null);
        expect(() => {
            panel.setViewActions("nope", new LabelStub("X"));
        }).not.toThrow();
    });

    it("контролы не заезжают на табы, когда места мало", () => {
        // Узкая панель: прижать вправо нельзя, но и перекрыть заголовки нельзя —
        // иначе вкладки стали бы нечитаемыми.
        const { backend } = panelWithActions(new LabelStub("VeryLongChannelName"), 30);

        const row = backend.getTextAt(new Point(0, 1), 30);
        expect(row).toContain("PROBLEMS");
        expect(row).toContain("OUTPUT");
    });

    it("контролы рисуются и когда вкладок ещё нет", () => {
        // Панель без табов: прижимать вправо не от чего, но контрол не должен
        // ни исчезнуть, ни уехать за границу.
        const panel = new PanelContainerElement();
        panel.addView({ id: "output", title: "", content: null, actions: new LabelStub("Bootstrap") });

        expect(renderElement(panel, 40, 6).screenToString()).toContain("Bootstrap");
    });

    it("клик по контролам не переключает вкладку", () => {
        // Хендлер панели ловит любой клик по строке табов; без проверки источника
        // клик по селектору ещё и менял бы активную вкладку под ним.
        const actions = new LabelStub("Bootstrap");
        const { panel } = panelWithActions(actions);
        const onActivate = vi.fn();
        panel.onActivateView = onActivate;

        actions.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 50, screenY: 1, localX: 0, localY: 0 }),
        );

        expect(onActivate).not.toHaveBeenCalled();
        expect(panel.getActiveViewId()).toBe("output");
    });

    it("клик по самому табу вкладку переключает", () => {
        const { panel } = panelWithActions(new LabelStub("Bootstrap"));
        const onActivate = vi.fn();
        panel.onActivateView = onActivate;

        panel.dispatchEvent(
            new TUIMouseEvent("mousedown", { button: "left", screenX: 3, screenY: 1, localX: 3, localY: 1 }),
        );

        expect(onActivate).toHaveBeenCalledWith("problems");
        expect(panel.getActiveViewId()).toBe("problems");
    });
});

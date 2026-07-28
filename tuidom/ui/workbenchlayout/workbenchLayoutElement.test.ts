import { describe, expect, it } from "vitest";

import { MockTerminalBackend } from "../../backend/mockTerminalBackend.ts";
import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import { TerminalScreen } from "../../rendering/terminalScreen.ts";
import { SashElement } from "../sash/sashElement.ts";

import { WorkbenchLayoutElement } from "./workbenchLayoutElement.ts";

function createPanel(): TUIElement {
    return new TUIElement();
}

/** A panel that paints a single marker char at its top-left, so we can assert it was rendered. */
class MarkerPanel extends TUIElement {
    private readonly marker: string;

    public constructor(marker: string) {
        super();
        this.marker = marker;
    }

    public override render(context: RenderContext): void {
        context.setCell(0, 0, { char: this.marker, fg: 0, bg: 0 });
    }
}

describe("WorkbenchLayoutElement", () => {
    describe("layout with left panel visible", () => {
        it("positions left panel at (0,0) with configured width", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelWidth(25);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(leftPanel.layoutSize).toEqual(new Size(25, 24));
            expect(leftPanel.localPosition).toEqual(new Offset(0, 0));
            expect(leftPanel.globalPosition).toEqual(new Point(0, 0));
        });

        it("positions center content after left panel", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelWidth(25);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(center.layoutSize).toEqual(new Size(55, 24));
            expect(center.localPosition).toEqual(new Offset(25, 0));
            expect(center.globalPosition).toEqual(new Point(25, 0));
        });

        it("respects parent globalPosition", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelWidth(30);

            layout.localPosition = new Offset(0, 1);
            layout.layout(BoxConstraints.tight(new Size(80, 22)));

            expect(leftPanel.globalPosition).toEqual(new Point(0, 1));
            expect(center.globalPosition).toEqual(new Point(30, 1));
        });
    });

    describe("layout with left panel hidden", () => {
        it("center content takes full width when left panel hidden", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelVisible(false);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(center.layoutSize).toEqual(new Size(80, 24));
            expect(center.localPosition).toEqual(new Offset(0, 0));
            expect(center.globalPosition).toEqual(new Point(0, 0));
        });

        it("does not layout hidden left panel", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelVisible(false);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(leftPanel.isLayoutDirty).toBe(true);
        });
    });

    describe("toggle visibility", () => {
        it("toggling left panel visibility changes layout", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelWidth(30);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));
            expect(center.layoutSize.width).toBe(50);

            layout.setLeftPanelVisible(false);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));
            expect(center.layoutSize.width).toBe(80);

            layout.setLeftPanelVisible(true);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));
            expect(center.layoutSize.width).toBe(50);
        });
    });

    describe("without left panel", () => {
        it("center content takes full width when no left panel set", () => {
            const layout = new WorkbenchLayoutElement();
            const center = createPanel();

            layout.setCenterContent(center);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));

            expect(center.layoutSize).toEqual(new Size(80, 24));
            expect(center.localPosition).toEqual(new Offset(0, 0));
        });
    });

    describe("getChildren", () => {
        // Структура ≠ видимость: скрытые панели остаются детьми с hidden=true
        // (root/стили доходят), сашы присутствуют всегда и скрыты вместе со
        // своей панелью. Видимость проверяем флагом, состав — списком.
        it("панели и сашы в списке, sash идёт после панелей (hit-test поверх)", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);

            const children = layout.getChildren();
            expect(children.slice(0, 2)).toEqual([leftPanel, center]);
            expect(children[2]).toBeInstanceOf(SashElement);
            expect(children[2].hidden).toBe(false);
            expect(leftPanel.hidden).toBe(false);
        });

        it("скрытая левая панель остаётся ребёнком с hidden=true (и её саш тоже)", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelVisible(false);

            expect(layout.getChildren()).toContain(leftPanel);
            expect(leftPanel.hidden).toBe(true);
            expect(center.hidden).toBe(false);
            const sashes = layout.getChildren().filter((c) => c instanceof SashElement);
            expect(sashes.every((s) => s.hidden)).toBe(true);
        });

        it("без панелей — только скрытые сашы", () => {
            const layout = new WorkbenchLayoutElement();

            const children = layout.getChildren();
            expect(children).toHaveLength(2);
            expect(children.every((c) => c instanceof SashElement && c.hidden)).toBe(true);
        });

        it("центр без левой панели: сашы скрыты", () => {
            const layout = new WorkbenchLayoutElement();
            const center = createPanel();

            layout.setCenterContent(center);

            expect(layout.getChildren()[0]).toBe(center);
            const sashes = layout.getChildren().filter((c) => c instanceof SashElement);
            expect(sashes.every((s) => s.hidden)).toBe(true);
        });
    });

    describe("setLeftPanel replaces previous panel", () => {
        it("replaces left panel and unparents old one", () => {
            const layout = new WorkbenchLayoutElement();
            const panel1 = createPanel();
            const panel2 = createPanel();

            layout.setLeftPanel(panel1);
            expect(panel1.getParent()).toBe(layout);

            layout.setLeftPanel(panel2);
            expect(panel1.getParent()).toBeNull();
            expect(panel2.getParent()).toBe(layout);
        });
    });

    describe("setCenterContent replaces previous content", () => {
        it("replaces center content and unparents old one", () => {
            const layout = new WorkbenchLayoutElement();
            const center1 = createPanel();
            const center2 = createPanel();

            layout.setCenterContent(center1);
            expect(center1.getParent()).toBe(layout);

            layout.setCenterContent(center2);
            expect(center1.getParent()).toBeNull();
            expect(center2.getParent()).toBe(layout);
            expect(layout.getCenterContent()).toBe(center2);
        });

        it("clears center content when set to null and unparents the old one", () => {
            const layout = new WorkbenchLayoutElement();
            const center = createPanel();

            layout.setCenterContent(center);
            layout.setCenterContent(null);

            expect(center.getParent()).toBeNull();
            expect(layout.getCenterContent()).toBeNull();
        });
    });

    describe("accessors", () => {
        it("getLeftPanel returns the configured left panel", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            expect(layout.getLeftPanel()).toBeNull();

            layout.setLeftPanel(leftPanel);
            expect(layout.getLeftPanel()).toBe(leftPanel);
        });

        it("getCenterContent returns the configured center content", () => {
            const layout = new WorkbenchLayoutElement();
            const center = createPanel();
            expect(layout.getCenterContent()).toBeNull();

            layout.setCenterContent(center);
            expect(layout.getCenterContent()).toBe(center);
        });
    });

    describe("left panel width clamped to reserve the editor", () => {
        it("clamps left panel width so the center keeps its minimum width", () => {
            const layout = new WorkbenchLayoutElement();
            const leftPanel = createPanel();
            const center = createPanel();

            layout.setLeftPanel(leftPanel);
            layout.setCenterContent(center);
            layout.setLeftPanelWidth(100);

            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));

            // 80 - MIN_CENTER_WIDTH(20) = 60 reserved for the panel, 20 for the editor.
            expect(leftPanel.layoutSize.width).toBe(60);
            expect(center.layoutSize.width).toBe(20);
        });

        it("does not mutate the stored width when the layout clamps it (resize keeps absolute size)", () => {
            const layout = new WorkbenchLayoutElement();
            layout.setLeftPanel(createPanel());
            layout.setCenterContent(createPanel());
            layout.setLeftPanelWidth(50);

            layout.localPosition = new Offset(0, 0);
            // Narrow terminal clamps the displayed width down...
            layout.layout(BoxConstraints.tight(new Size(40, 24)));
            expect(layout.getLeftPanelWidth()).toBe(50);

            // ...but widening restores the full absolute width.
            layout.layout(BoxConstraints.tight(new Size(120, 24)));
            expect(layout.getLeftPanel()?.layoutSize.width).toBe(50);
        });
    });

    describe("layout edge cases", () => {
        it("lays out the left panel even when no center content is set (line 82 false branch)", () => {
            const layout = new WorkbenchLayoutElement();
            const left = createPanel();

            layout.setLeftPanel(left);
            layout.setLeftPanelWidth(20);
            layout.localPosition = new Offset(0, 0);

            expect(() => layout.layout(BoxConstraints.tight(new Size(40, 10)))).not.toThrow();
            expect(left.layoutSize).toEqual(new Size(20, 10));
        });

        it("setLeftPanel(null) clears the panel without re-parenting (line 18 false branch)", () => {
            const layout = new WorkbenchLayoutElement();
            const left = createPanel();

            layout.setLeftPanel(left);
            expect(left.getParent()).toBe(layout);

            layout.setLeftPanel(null);
            expect(left.getParent()).toBeNull();
            expect(layout.getLeftPanel()).toBeNull();
        });
    });

    describe("render", () => {
        function renderLayout(layout: WorkbenchLayoutElement, size: Size): MockTerminalBackend {
            const backend = new MockTerminalBackend(size);
            const termScreen = new TerminalScreen(size);
            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(size));
            layout.render(new RenderContext(termScreen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
            termScreen.flush(backend);
            return backend;
        }

        it("renders the left panel and center content through the pipeline (lines 92-103)", () => {
            const layout = new WorkbenchLayoutElement();
            layout.setLeftPanel(new MarkerPanel("L"));
            layout.setCenterContent(new MarkerPanel("C"));
            layout.setLeftPanelWidth(12);

            const backend = renderLayout(layout, new Size(40, 5));

            expect(backend.getTextAt(new Point(0, 0), 1)).toBe("L"); // left panel at x=0
            expect(backend.getTextAt(new Point(12, 0), 1)).toBe("C"); // center after left panel
        });

        it("renders only the left panel when there is no center content (line 99 false branch)", () => {
            const layout = new WorkbenchLayoutElement();
            layout.setLeftPanel(new MarkerPanel("L"));
            layout.setLeftPanelWidth(10);

            const backend = renderLayout(layout, new Size(30, 5));

            expect(backend.getTextAt(new Point(0, 0), 1)).toBe("L");
        });

        it("skips the hidden left panel and renders center at the origin (line 99)", () => {
            const layout = new WorkbenchLayoutElement();
            layout.setLeftPanel(new MarkerPanel("L"));
            layout.setCenterContent(new MarkerPanel("C"));
            layout.setLeftPanelVisible(false);

            const backend = renderLayout(layout, new Size(30, 5));

            // Left panel suppressed; center occupies x=0.
            expect(backend.getTextAt(new Point(0, 0), 1)).toBe("C");
        });
    });

    describe("default values", () => {
        it("left panel is visible by default", () => {
            const layout = new WorkbenchLayoutElement();
            expect(layout.getLeftPanelVisible()).toBe(true);
        });

        it("default left panel width is 30", () => {
            const layout = new WorkbenchLayoutElement();
            expect(layout.getLeftPanelWidth()).toBe(30);
        });
    });

    describe("resize: nudge / reset", () => {
        function laidOut(containerWidth = 80): WorkbenchLayoutElement {
            const layout = new WorkbenchLayoutElement();
            layout.setLeftPanel(createPanel());
            layout.setCenterContent(createPanel());
            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(containerWidth, 24)));
            return layout;
        }

        it("nudges the width by a delta", () => {
            const layout = laidOut();
            layout.nudgeLeftPanelWidth(3);
            expect(layout.getLeftPanelWidth()).toBe(33);
        });

        it("clamps to the minimum panel width", () => {
            const layout = laidOut();
            layout.nudgeLeftPanelWidth(-100);
            expect(layout.getLeftPanelWidth()).toBe(12);
        });

        it("clamps to the maximum that still leaves the editor its minimum", () => {
            const layout = laidOut(80);
            layout.nudgeLeftPanelWidth(1000);
            // 80 - MIN_CENTER_WIDTH(20) = 60.
            expect(layout.getLeftPanelWidth()).toBe(60);
        });

        it("resets to the default width", () => {
            const layout = laidOut();
            layout.nudgeLeftPanelWidth(20);
            layout.resetLeftPanelWidth();
            expect(layout.getLeftPanelWidth()).toBe(30);
        });
    });

    describe("resize: sash", () => {
        function laidOut(leftWidth: number): { layout: WorkbenchLayoutElement; sash: SashElement } {
            const layout = new WorkbenchLayoutElement();
            layout.setLeftPanel(createPanel());
            layout.setCenterContent(createPanel());
            layout.setLeftPanelWidth(leftWidth);
            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));
            const sash = layout.getChildren()[2] as SashElement;
            return { layout, sash };
        }

        it("positions the sash at the panel/editor boundary, 1 column wide", () => {
            const { sash } = laidOut(20);
            expect(sash.globalPosition).toEqual(new Point(20, 0));
            expect(sash.layoutSize).toEqual(new Size(1, 24));
        });

        it("dragging the sash updates the panel width", () => {
            const { layout, sash } = laidOut(20);
            sash.onDrag?.(50);
            expect(layout.getLeftPanelWidth()).toBe(50);
        });

        it("dragging past the maximum clamps the width", () => {
            const { layout, sash } = laidOut(20);
            sash.onDrag?.(200);
            expect(layout.getLeftPanelWidth()).toBe(60);
        });
    });

    describe("bottom panel", () => {
        function laidOut(options?: { withLeft?: boolean; height?: number }): {
            layout: WorkbenchLayoutElement;
            center: TUIElement;
            panel: MarkerPanel;
        } {
            const layout = new WorkbenchLayoutElement();
            const center = createPanel();
            const panel = new MarkerPanel("B");
            if (options?.withLeft) {
                layout.setLeftPanel(createPanel());
                layout.setLeftPanelWidth(20);
            }
            layout.setCenterContent(center);
            layout.setBottomPanel(panel);
            layout.setBottomPanelVisible(true);
            if (options?.height !== undefined) layout.setBottomPanelHeight(options.height);
            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));
            return { layout, center, panel };
        }

        it("is hidden by default", () => {
            const layout = new WorkbenchLayoutElement();
            const center = createPanel();
            layout.setCenterContent(center);
            layout.setBottomPanel(createPanel());
            expect(layout.getBottomPanelVisible()).toBe(false);
            layout.localPosition = new Offset(0, 0);
            layout.layout(BoxConstraints.tight(new Size(80, 24)));
            // Скрытая панель остаётся в дереве с hidden=true; центр во всю высоту.
            expect(layout.getBottomPanel()?.hidden).toBe(true);
            expect(center.layoutSize).toEqual(new Size(80, 24));
        });

        it("скрытая панель укоренена всегда — root производный от цепочки родителей", () => {
            const layout = new WorkbenchLayoutElement();
            const panel = createPanel();
            layout.setBottomPanel(panel); // прикрепление до укоренения layout
            layout.setAsRoot();
            // Раньше root был кэшем и у скрытой панели протухал (null) до
            // повторного показа; теперь выводится из живой цепочки родителей.
            expect(panel.getRoot()).toBe(layout);

            layout.setBottomPanelVisible(true);
            expect(panel.getRoot()).toBe(layout);
        });

        it("tolerates being shown with no bottom panel set", () => {
            const layout = new WorkbenchLayoutElement();
            expect(() => {
                layout.setBottomPanelVisible(true);
            }).not.toThrow();
            expect(layout.getBottomPanelVisible()).toBe(true);
        });

        it("exposes the configured panel and visibility/height", () => {
            const layout = new WorkbenchLayoutElement();
            const panel = createPanel();
            layout.setBottomPanel(panel);
            layout.setBottomPanelVisible(true);
            layout.setBottomPanelHeight(9);
            expect(layout.getBottomPanel()).toBe(panel);
            expect(layout.getBottomPanelVisible()).toBe(true);
            expect(layout.getBottomPanelHeight()).toBe(9);
        });

        it("replaces a previously set bottom panel", () => {
            const layout = new WorkbenchLayoutElement();
            const first = createPanel();
            const second = createPanel();
            layout.setBottomPanel(first);
            layout.setBottomPanel(second);
            expect(layout.getBottomPanel()).toBe(second);
            expect(first.getParent()).toBeNull();
        });

        it("clears the bottom panel when set to null", () => {
            const layout = new WorkbenchLayoutElement();
            const panel = createPanel();
            layout.setBottomPanel(panel);
            layout.setBottomPanel(null);
            expect(layout.getBottomPanel()).toBeNull();
            expect(panel.getParent()).toBeNull();
        });

        it("shrinks the editor and pins the panel to the bottom at the center width", () => {
            const { center, panel } = laidOut({ height: 8 });
            expect(center.layoutSize).toEqual(new Size(80, 16));
            expect(center.localPosition).toEqual(new Offset(0, 0));
            expect(panel.layoutSize).toEqual(new Size(80, 8));
            expect(panel.globalPosition).toEqual(new Point(0, 16));
        });

        it("aligns the panel to the editor width when the sidebar is shown", () => {
            const { center, panel } = laidOut({ withLeft: true, height: 6 });
            expect(center.layoutSize).toEqual(new Size(60, 18));
            expect(panel.layoutSize).toEqual(new Size(60, 6));
            expect(panel.globalPosition).toEqual(new Point(20, 18));
        });

        it("панель и горизонтальный саш в детях, саш последним (hit-test поверх)", () => {
            const { layout } = laidOut({ height: 8 });
            const children = layout.getChildren();
            // center, bottom panel, вертикальный саш (скрыт), горизонтальный саш.
            const sashes = children.filter((c) => c instanceof SashElement);
            expect(sashes).toHaveLength(2);
            expect(children.at(-1)).toBe(sashes.at(-1));
            expect((sashes.at(-1) as SashElement).hidden).toBe(false);
        });

        it("renders the visible bottom panel at its position", () => {
            const { layout } = laidOut({ height: 8 });
            const size = new Size(80, 24);
            const backend = new MockTerminalBackend(size);
            const screen = new TerminalScreen(size);
            layout.render(new RenderContext(screen, new Offset(0, 0), new Rect(new Point(0, 0), size)));
            screen.flush(backend);
            expect(backend.getTextAt(new Point(0, 16), 1)).toBe("B");
        });

        it("resizes the panel height by dragging the horizontal sash", () => {
            const { layout } = laidOut({ height: 8 });
            const sash = layout.getChildren().filter((c) => c instanceof SashElement).at(-1) as SashElement;
            // Panel bottom is pinned at row 24; dragging its top to row 14 → height 10.
            sash.onDrag?.(14);
            expect(layout.getBottomPanelHeight()).toBe(10);
        });

        it("clamps the panel height to its minimum and maximum", () => {
            const { layout } = laidOut({ height: 8 });
            const sash = layout.getChildren().filter((c) => c instanceof SashElement).at(-1) as SashElement;
            sash.onDrag?.(23); // height 1 → clamped up to MIN (3)
            expect(layout.getBottomPanelHeight()).toBe(3);
            sash.onDrag?.(-100); // height 124 → clamped to containerHeight - MIN_EDITOR_HEIGHT (21)
            expect(layout.getBottomPanelHeight()).toBe(21);
        });
    });
});

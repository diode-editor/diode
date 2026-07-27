import { describe, expect, it } from "vitest";

import { renderElement } from "../../../src/TestUtils/renderElement.ts";
import { TestApp } from "../../../src/TestUtils/TestApp.ts";
import { getFileIcon } from "../../../src/vs/base/common/fileIcons.ts";
import { packRgb } from "../../common/colorUtils.ts";
import { BoxConstraints, Offset, Point, Size } from "../../common/geometryPromitives.ts";
import { BodyElement } from "../body/bodyElement.ts";
import { BoxElement } from "../layout/boxElement.ts";

import { EditorGroupElement } from "./editorGroupElement.ts";

function layoutGroup(group: EditorGroupElement, width = 40, height = 10): void {
    group.localPosition = new Offset(0, 0);
    group.performLayout(BoxConstraints.tight(new Size(width, height)));
}

describe("EditorGroupElement", () => {
    describe("layout", () => {
        it("tab strip occupies 1 row at the top", () => {
            const group = new EditorGroupElement();
            layoutGroup(group, 40, 10);

            expect(group.tabStrip.localPosition.dy).toBe(0);
            expect(group.tabStrip.layoutSize.height).toBe(1);
            expect(group.tabStrip.layoutSize.width).toBe(40);
        });

        it("content occupies remaining height below tab strip", () => {
            const group = new EditorGroupElement();
            const content = new BoxElement();
            group.setContent(content);
            layoutGroup(group, 40, 10);

            expect(content.localPosition.dy).toBe(1);
            expect(content.layoutSize.height).toBe(9);
            expect(content.layoutSize.width).toBe(40);
        });

        it("content global position accounts for tab strip", () => {
            const group = new EditorGroupElement();
            const content = new BoxElement();
            group.setContent(content);
            layoutGroup(group, 40, 10);

            expect(content.globalPosition.y).toBe(1);
        });

        it("works without content", () => {
            const group = new EditorGroupElement();
            layoutGroup(group, 40, 10);
            // No error thrown
            expect(group.tabStrip.layoutSize.width).toBe(40);
        });
    });

    describe("children", () => {
        it("includes tab strip and overlay layer when no content", () => {
            const group = new EditorGroupElement();
            expect(group.getChildren()).toHaveLength(2);
            expect(group.getChildren()[0]).toBe(group.tabStrip);
            expect(group.getChildren()[1]).toBe(group.overlayLayer);
        });

        it("includes tab strip, content and overlay layer", () => {
            const group = new EditorGroupElement();
            const content = new BoxElement();
            group.setContent(content);
            expect(group.getChildren()).toHaveLength(3);
            expect(group.getChildren()).toContain(content);
        });
    });

    describe("setContent", () => {
        it("replaces content element", () => {
            const group = new EditorGroupElement();
            const content1 = new BoxElement();
            const content2 = new BoxElement();

            group.setContent(content1);
            expect(group.getContent()).toBe(content1);

            group.setContent(content2);
            expect(group.getContent()).toBe(content2);
        });

        it("unparents old content", () => {
            const group = new EditorGroupElement();
            const content1 = new BoxElement();
            const content2 = new BoxElement();

            group.setContent(content1);
            group.setContent(content2);

            expect(content1.getParent()).toBeNull();
        });

        it("setContent(null) removes content", () => {
            const group = new EditorGroupElement();
            const content = new BoxElement();

            group.setContent(content);
            group.setContent(null);

            expect(group.getContent()).toBeNull();
            expect(group.getChildren()).toHaveLength(2);
            expect(group.getChildren()).toContain(group.overlayLayer);
        });
    });

    describe("rendering", () => {
        it("renders tab strip on first row", () => {
            const group = new EditorGroupElement();
            const tsIcon = getFileIcon("file.ts");
            group.tabStrip.setTabs([
                { label: "file.ts", icon: tsIcon.icon, iconColor: tsIcon.color, isModified: false, isReadOnly: false },
            ]);
            group.tabStrip.activeIndex = 0;

            const backend = renderElement(group, 40, 10);
            const firstRow = backend.getTextAt(new Point(0, 0), 40);
            expect(firstRow).toContain("file.ts");
        });

        it("renders content below tab strip", () => {
            const group = new EditorGroupElement();
            const content = new BoxElement();
            group.setContent(content);

            const backend = renderElement(group, 10, 5);
            // BoxElement renders borders, check content area starts at row 1
            const row1 = backend.getTextAt(new Point(0, 1), 10);
            expect(row1.length).toBe(10);
        });

        it("fills content area with background color when no content is open", () => {
            const editorBg = packRgb(0x1e, 0x1e, 0x1e);
            const group = new EditorGroupElement();
            group.style = { bg: editorBg };

            const body = new BodyElement();
            body.setContent(group);
            const app = TestApp.create(body, new Size(10, 5));

            // Rows 1-4 (below tab strip) must all have the editor background color
            for (let y = 1; y < 5; y++) {
                for (let x = 0; x < 10; x++) {
                    expect(app.backend.getBgAt(new Point(x, y))).toBe(editorBg);
                }
            }
        });
    });
});

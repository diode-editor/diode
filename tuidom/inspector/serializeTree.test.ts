import { describe, expect, it } from "vitest";

import { TestApp } from "../../src/TestUtils/TestApp.ts";
import { Size } from "../common/geometryPromitives.ts";
import { BodyElement } from "../ui/body/bodyElement.ts";
import { BoxElement } from "../ui/layout/boxElement.ts";
import { InputElement } from "../ui/inputbox/inputElement.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

import type { NodeSnapshot } from "./protocol.ts";
import { serializeTree } from "./serializeTree.ts";

function findByType(node: NodeSnapshot, type: string): NodeSnapshot | undefined {
    if (node.type === type) return node;
    for (const child of node.children) {
        const found = findByType(child, type);
        if (found) return found;
    }
    return undefined;
}

describe("serializeTree", () => {
    it("returns null for a null root", () => {
        expect(serializeTree(null, null)).toBeNull();
    });

    it("скрытые поддеревья не сериализуются — инспектор видит то же, что пользователь", () => {
        const body = new BodyElement();
        const label = new TextLabelElement("visible");
        body.setContent(label);
        const app = TestApp.create(body, new Size(20, 5)).app;

        expect(findByType(serializeTree(app.root, null) as NodeSnapshot, "TextLabelElement")).toBeDefined();

        label.hidden = true;
        expect(findByType(serializeTree(app.root, null) as NodeSnapshot, "TextLabelElement")).toBeUndefined();
    });

    it("serializes type, box, id and text of a nested label", () => {
        const body = new BodyElement();
        const label = new TextLabelElement("hello");
        label.id = "greeting";
        label.role = "heading";
        label.tabIndex = 3;
        body.setContent(label);
        const app = TestApp.create(body, new Size(20, 5)).app;

        const snap = serializeTree(app.root, null);

        expect(snap?.type).toBe("BodyElement");
        expect(snap?.box).toEqual({ x: 0, y: 0, width: 20, height: 5 });

        const labelNode = findByType(snap!, "TextLabelElement");
        expect(labelNode?.id).toBe("greeting");
        expect(labelNode?.role).toBe("heading");
        expect(labelNode?.tabIndex).toBe(3);
        expect(labelNode?.text).toBe("hello");
        expect(labelNode?.focused).toBe(false);
    });

    it("marks the focused element", () => {
        const body = new BodyElement();
        const input = new InputElement();
        body.setContent(input);
        const app = TestApp.create(body, new Size(20, 5)).app;
        input.focus();

        const snap = serializeTree(app.root, app.focusManager?.activeElement ?? null);
        const inputNode = findByType(snap!, "InputElement");
        expect(inputNode?.focused).toBe(true);
    });

    it("includes inspectState() output as `state`, omits it when undefined", () => {
        const body = new BodyElement();
        // Элемент с самоописанием состояния.
        const stated = new BoxElement();
        (stated as unknown as { inspectState(): Record<string, unknown> }).inspectState = () => ({ answer: 42 });
        body.setContent(stated);
        const app = TestApp.create(body, new Size(10, 3)).app;

        const snap = serializeTree(app.root, null);
        // Дефолтный BodyElement состояния не отдаёт — поля нет.
        expect(snap?.state).toBeUndefined();
        expect(findByType(snap!, "BoxElement")?.state).toEqual({ answer: 42 });
    });

    it("assigns pre-order nodeIds (root is 0)", () => {
        const body = new BodyElement();
        body.setContent(new TextLabelElement("x"));
        const app = TestApp.create(body, new Size(10, 3)).app;

        const snap = serializeTree(app.root, null);
        expect(snap?.nodeId).toBe(0);
    });
});

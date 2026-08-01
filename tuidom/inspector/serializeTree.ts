import type { TUIElement } from "../dom/tuiElement.ts";
import { TextLabelElement } from "../ui/text/textLabelElement.ts";

import type { NodeSnapshot } from "./protocol.ts";

/**
 * Serialize a TUIDom subtree into a plain JSON snapshot, reading only public
 * accessors of TUIElement (no widget changes). `nodeId` is assigned pre-order.
 */
export function serializeTree(root: TUIElement | null, focused: TUIElement | null): NodeSnapshot | null {
    if (root === null) return null;
    return serializeNode(root, focused, { next: 0 });
}

function serializeNode(element: TUIElement, focused: TUIElement | null, counter: { next: number }): NodeSnapshot {
    const nodeId = counter.next++;
    const pos = element.globalPosition;
    const size = element.layoutSize;
    const style = element.resolvedStyle;

    const snapshot: NodeSnapshot = {
        nodeId,
        type: element.constructor.name,
        box: { x: pos.x, y: pos.y, width: size.width, height: size.height },
        style: { fg: style.fg, bg: style.bg },
        focused: element === focused,
        children: [],
    };

    if (element.id !== undefined) snapshot.id = element.id;
    if (element.role !== undefined) snapshot.role = element.role;
    if (element.focusable) snapshot.focusable = true;

    const states = element.activeStyleStates;
    if (states.length > 0) snapshot.styleStates = [...states];
    const applied = element.appliedStyle;
    if (typeof applied.fg === "string" || typeof applied.bg === "string") {
        snapshot.styleTokens = {};
        if (typeof applied.fg === "string") snapshot.styleTokens.fg = applied.fg;
        if (typeof applied.bg === "string") snapshot.styleTokens.bg = applied.bg;
    }
    if (element.hasOwnBackground) snapshot.ownBackground = true;
    if (element instanceof TextLabelElement) snapshot.text = element.getText();
    const state = element.inspectState();
    if (state !== undefined) snapshot.state = state;

    // Скрытые (hidden) поддеревья не сериализуются: инспектор — «глаз
    // пользователя», а скрытое не рисуется, не кликается и не участвует в
    // Tab-обходе. Структурно такие элементы остаются в дереве (стили/root
    // доходят) — но e2e-тест, ждущий исчезновения виджета со сцены
    // (waitForNoNode), должен видеть ровно то же, что видит пользователь.
    snapshot.children = element
        .getChildren()
        .filter((child) => !child.hidden)
        .map((child) => serializeNode(child, focused, counter));

    return snapshot;
}

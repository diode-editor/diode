import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { NodeSnapshot } from "@tuidom/all/inspector/protocol";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

// Проверяем `TUIDom.sendMouse` на настоящем бинаре: находим узел в дереве
// инспектора, целимся в его `box` и кликаем. Ровно так e2e покрывает мышь
// (вкладки панели, сэш, колесо). Запуск изолирован (`useHeadlessApp`): свой
// user-data-dir и HOME, уборка — на `onTestFinished`.
describe("SEA binary — mouse injection via the inspector", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    const isEditLabel = (n: NodeSnapshot): boolean => n.type === "TextLabelElement" && n.text?.trim() === "Edit";
    const isPopupMenu = (n: NodeSnapshot): boolean => n.type === "PopupMenuElement";

    it("opens the Edit menu when its menu-bar item is clicked", async () => {
        const { session } = await useHeadlessApp({ open: [fixturePath] });

        const root = await session.waitForDocument((r) => findNode(r, isEditLabel) !== null);
        expect(findNode(root, isPopupMenu)).toBeNull();

        const label = findNode(root, isEditLabel);
        expect(label).not.toBeNull();
        // Координаты протокола — 0-based экранные ячейки, ровно как в `box`.
        await session.click(label!.box.x, label!.box.y);

        const opened = await session.waitForDocument((r) => findNode(r, isPopupMenu) !== null);
        expect(findNode(opened, isPopupMenu)).not.toBeNull();
    }, 60_000);
});

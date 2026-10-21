import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

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
        // Protocol coordinates are 0-based screen cells, exactly as in `box`.
        await session.click(label!.box.x, label!.box.y);

        const opened = await session.waitForDocument((r) => findNode(r, isPopupMenu) !== null);
        expect(findNode(opened, isPopupMenu)).not.toBeNull();
    }, 60_000);
});

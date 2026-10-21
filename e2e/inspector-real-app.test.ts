import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { usePtyApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

// Assertions come from the inspector tree, not the ANSI screen, so the ConPTY clearing
// that gates the screen-content tests to Linux does not affect them (docs/TODO/E2E.md).
describe("SEA binary — inspector assertions on the real app", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("serves the real app's document tree, with an 'Edit' menu label", async () => {
        const { session } = await usePtyApp({ open: [fixturePath], inspect: true });

        // Label text is padded, e.g. " Edit ".
        const isEditLabel = (n: { type: string; text?: string }): boolean =>
            n.type === "TextLabelElement" && n.text?.trim() === "Edit";
        const root = await session.waitForDocument((r) => findNode(r, isEditLabel) !== null);

        expect(root.type).toBe("BodyElement");
        expect(findNode(root, isEditLabel)).not.toBeNull();
    });
});

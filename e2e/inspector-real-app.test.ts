import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { usePtyApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

// Launch the REAL diode through a PTY (like the sea-* e2e tests) but make the
// assertions from the TUIDom inspector's document tree instead of parsing the
// ANSI screen. Because the data comes from the tree (not rendered cells) it is
// unaffected by the ConPTY clearing that gates the screen-content tests to Linux
// (see docs/TODO/E2E.md). Isolated via `usePtyApp`: own user-data-dir + HOME.
describe("SEA binary — inspector assertions on the real app", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("serves the real app's document tree, with an 'Edit' menu label", async () => {
        const { session } = await usePtyApp({ open: [fixturePath], inspect: true });

        // Readiness + assertion, both via the inspector: wait until the menu bar
        // renders an "Edit" label (label text is padded, e.g. " Edit "). This is
        // the inspector-data analogue of sea-startup's screen `findText("Edit")`.
        const isEditLabel = (n: { type: string; text?: string }): boolean =>
            n.type === "TextLabelElement" && n.text?.trim() === "Edit";
        const root = await session.waitForDocument((r) => findNode(r, isEditLabel) !== null);

        expect(root.type).toBe("BodyElement");
        expect(findNode(root, isEditLabel)).not.toBeNull();
    });
});

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

describe("inspector — inspectState & locators end-to-end", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("EditorElement.state exposes readonly and the selection", async () => {
        const { session } = await useHeadlessApp({
            files: { "sample.ts": "const greeting = 42\nconst other = 7\n" },
            open: ["sample.ts"],
        });
        await session.waitForNode("EditorElement");

        const before = await session.node("EditorElement");
        expect(before?.state?.readOnly).toBe(false);
        expect(before?.state?.hasSelection).toBe(false);

        await session.key("Shift+ArrowRight");
        await session.key("Shift+ArrowRight");
        const editor = await session.waitForState("EditorElement", (s) => s?.hasSelection === true);
        const selections = editor.state?.selections as { collapsed: boolean }[];
        expect(selections[0].collapsed).toBe(false);
    }, 60_000);

    it("clickNode by locator opens a menu; the menu state is visible", async () => {
        const { session } = await useHeadlessApp({ files: { "a.txt": "hi\n" }, open: ["a.txt"] });
        await session.waitForNode("MenuBarElement");

        await session.key("Alt+E");
        const menu = await session.waitForNode("PopupMenuElement");
        expect(Array.isArray(menu.state?.items)).toBe(true);
        expect((menu.state?.items as unknown[]).length).toBeGreaterThan(0);
    }, 60_000);
});

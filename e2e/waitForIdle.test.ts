import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

describe("inspector — waitForIdle & settling verbs", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("waitForIdle возвращает idle и растущий счётчик кадров", async () => {
        const { session } = await useHeadlessApp({ files: { "a.txt": "hello world\n" }, open: ["a.txt"] });
        await session.waitForText((t) => t.includes("hello world"));

        const first = await session.waitForIdle();
        expect(first.idle).toBe(true);
        expect(first.frames).toBeGreaterThan(0);

        await session.key("Alt+E");
        const after = await session.waitForIdle();
        expect(after.frames).toBeGreaterThanOrEqual(first.frames);
        const { root } = await session.getDocument();
        expect(findNode(root, (n) => n.type === "PopupMenuElement")).not.toBeNull();
    }, 60_000);
});

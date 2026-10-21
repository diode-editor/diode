import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// On a legacy terminal Ctrl+Shift+F/G and Ctrl+Tab are indistinguishable from Ctrl+F, Ctrl+G and Tab —
// the fallback is Ctrl+K F / Ctrl+K G and Ctrl+6 (0x1e gets through everywhere). The e2e spawn
// is hermetic, the tier is exactly `legacy` — as for a user under tmux.

const files = {
    "alpha.ts": "const alpha = 1;\n",
    "bravo.ts": "const bravo = 2;\n",
};

async function frameText(session: HeadlessSession): Promise<string> {
    return frameToText(await session.captureFrame());
}

describe("Фоллбэки клавиш для legacy-терминала", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("Ctrl+6 тумблерит два последних редактора", async () => {
        const { session } = await useHeadlessApp({ files, open: ["alpha.ts", "bravo.ts"] });
        await session.waitForText((t) => t.includes("const bravo"));

        await session.key("Ctrl+6");
        await session.waitForText((t) => t.includes("const alpha"));
        expect(await frameText(session)).toContain("const alpha");

        // A second press goes back — it is a toggle, not a walk down the stack.
        await session.key("Ctrl+6");
        await session.waitForText((t) => t.includes("const bravo"));
    }, 120_000);

    // Sidebar viewlets exist only with an open folder, otherwise the command does nothing.
    it("Ctrl+K F открывает Search, Ctrl+K G — Source Control", async () => {
        const { session } = await useHeadlessApp({ files, open: [".", "alpha.ts"] });
        await session.waitForText((t) => t.includes("const alpha"));

        await session.key("Ctrl+K");
        await session.key("f");
        await session.waitForText((t) => t.includes("SEARCH"));

        await session.key("Ctrl+K");
        await session.key("g");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
    }, 120_000);
});

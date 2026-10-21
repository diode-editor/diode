import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Lines of ~140 characters at cols: 80. The bar is the lower half-block `▄`, not `▀`; the row background is the
// editor background (`setCell` passes bg rather than relying on Grid's patch semantics).

const wideFile = resolve(repoRoot, "e2e", "fixtures", "wide.ts");

export default defineScenario({
    name: "horizontal-scrollbar",
    title: "Editor horizontal scrollbar (bottom edge, opaque, themed)",
    open: [repoRoot, wideFile],
    cols: 80,
    rows: 16,
    async run(editor) {
        await editor.waitForText((t) => t.includes("veryLongLine"));
        await editor.capture("at-start");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.waitForText((t) => t.includes("mu: 12"));
        await editor.capture("scrolled-right");
    },
});

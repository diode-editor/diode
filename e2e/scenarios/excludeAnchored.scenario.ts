import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Exclude patterns are anchored at the root in search too: rg on its own would read `common` as "at any depth".
// The token is in `common/RootOnly.java` (matched) and `nci/common/TopicStreamConsumer.java` (not matched).

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeAnchored");

export default defineScenario({
    name: "exclude-anchored",
    title: "files.exclude: `common` прячет только корневой каталог — вложенный `nci/common` ищется",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    settings: {
        "files.exclude": { common: true },
    },
    // The key DSL can't express Ctrl+Shift+F, so the command is bound to F6.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        // Don't wait for the compressed `nci/common` chain: it appears only once the children load, and the Windows
        // runner captures the frame earlier. A tree row is the name, trailing spaces and possibly `│` before the
        // adjacent part.
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("nci") && !/^\s*common\s*(│|$)/mu.test(t));
        await editor.capture("tree");

        // The sidebar truncates the file name ("nci/common/TopicStreamConsum…"), so match by path prefix.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "quietHarborLantern") {
            await editor.sendKey(ch);
        }
        await editor.waitForText(
            (t) => t.includes("in 1 file") && t.includes("nci/common/TopicStream") && !t.includes("RootOnly"),
        );
        await editor.capture("search");
    },
});

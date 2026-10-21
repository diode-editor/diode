import { resolve } from "node:path";

import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The target is the tab UNDER THE MOUSE POINTER: a right click does not change the active tab, so the menu opens on an
// inactive tab.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");
const fileC = resolve(repoRoot, "e2e", "fixtures", "longLine.ts");

interface TabState {
    label: string;
    active: boolean;
}

function tabsOf(strip: NodeSnapshot): TabState[] {
    return (strip.state?.tabs ?? []) as TabState[];
}

async function waitForTabs(
    editor: ScenarioDriver,
    count: number,
): Promise<{ strip: NodeSnapshot; tabs: TabState[] }> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const strip = await editor.waitForNode("EditorTabStripElement");
        const tabs = tabsOf(strip);
        if (tabs.length === count) return { strip, tabs };
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`в полосе так и не оказалось ${String(count)} вкладок`);
}

export default defineScenario({
    name: "tab-context-menu",
    title: "Editor tab context menu (right click)",
    open: [repoRoot, fileA, fileB, fileC],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("sample.ts") && t.includes("longLine.ts"));

        // The third tab is active (opened last) — open the menu on the FIRST one.
        const { strip, tabs } = await waitForTabs(editor, 3);
        if (!tabs[2].active) throw new Error("активной ожидалась последняя вкладка");
        const x = strip.box.x + 2;
        const y = strip.box.y;
        await editor.sendMouse({ action: "press", button: "right", x, y });
        await editor.sendMouse({ action: "release", button: "right", x, y });
        await editor.waitForText((t) => t.includes("Close Others") && t.includes("Copy Path"));
        await editor.capture("menu");

        // The right click did not change the active tab — the third one is still active.
        const opened = tabsOf(await editor.waitForNode("EditorTabStripElement"));
        if (!opened[2].active) throw new Error("правый клик увёл активную вкладку");

        // "Close Others" is the second menu item (selection starts on the first).
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");

        // Exactly the tab the menu was opened on remains — not the active one.
        const { tabs: remaining } = await waitForTabs(editor, 1);
        if (!remaining[0].label.includes("sample.ts")) {
            throw new Error(`осталась не та вкладка: ${remaining[0].label}`);
        }
        await editor.capture("after-close-others");
    },
});

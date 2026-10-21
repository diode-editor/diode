import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "view-locations",
    title: "Перенос видов между панелью и вторичной боковой панелью",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // У Move View нет дефолтного бинда (как у эталона), а палитра ранжирует
    // точное «View: Move View» ниже «View: Move Editor…» — бинд убирает шум.
    userKeybindings: [{ key: "ctrl+alt+m", command: "workbench.action.moveView" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+Alt+M");
        await editor.waitForText((t) => t.includes("Select a View to Move"));
        await editor.sendText("PROBLEMS");
        await editor.waitForText((t) => t.includes("Panel / PROBLEMS"));
        await editor.capture("pick-view");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("View: Move PROBLEMS"));
        await editor.sendText("New Secondary");
        await editor.waitForText((t) => t.includes("New Secondary Side Bar Entry"));
        await editor.capture("pick-destination");
        await editor.sendKey("Enter");

        const part = await editor.waitForNode("#auxiliarybar");
        await editor.waitForText((t) => t.split("\n")[1].slice(part.box.x).includes("PROBLEMS"));
        await editor.capture("moved");

        const tabs = part.state?.tabs as { centerX: number }[];
        const tabRow = part.state?.tabRow as number;
        await editor.sendMouse({ action: "press", button: "right", x: tabs[0].centerX, y: tabRow });
        await editor.sendMouse({ action: "release", button: "right", x: tabs[0].centerX, y: tabRow });
        await editor.waitForText((t) => t.includes("Reset Location"));
        await editor.capture("tab-menu");
    },
});

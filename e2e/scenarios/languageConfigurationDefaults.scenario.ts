import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `[makefile]` from the builtin make extension's configurationDefaults: the Makefile has no indentation yet, so
// detection has nothing to go on and the language setting decides.

const makefile = resolve(repoRoot, "e2e", "fixtures", "makefileDefaults", "Makefile");

export default defineScenario({
    name: "language-configuration-defaults",
    title: "configurationDefaults [makefile]: Makefile открывается с табами",
    open: [makefile],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("build:"));
        const frame = await editor.waitForText((t) => t.includes("Tab Size: 4"));
        if (frameToText(frame).includes("Spaces:")) {
            throw new Error("language-configuration-defaults: Makefile открылся с пробелами");
        }
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendKey("Tab");
        await editor.sendText("echo ok");
        await editor.waitForText((t) => t.includes("echo ok"));
        await editor.capture("makefile-tabs");
    },
});

import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-uri-handler");
const URL = "diode://test.uri-handler-demo/install-plugin?name=demo";

export default defineScenario({
    name: "extension-uri-handler",
    title: "window.registerUriHandler: a URL to the extension via Developer: Open URL",
    seedUserData: userData,
    cols: 120,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Developer: Open URL");
        await editor.waitForText((t) => t.includes("Developer: Open URL"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("URL to open"));
        await editor.sendText(URL);
        await editor.capture("input");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("Allow 'URI Handler Demo' extension to open this URI?"));
        await editor.capture("confirm");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("URI handled: /install-plugin?name=demo"), { timeoutMs: 20_000 });
        await editor.capture("handled");
    },
});

import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-env-collection");

export default defineScenario({
    name: "extension-environment-collection",
    title: "environmentVariableCollection: переменные расширения в окружении терминала",
    seedUserData: userData,
    cols: 120,
    rows: 24,
    // Настоящий шелл.
    skipOn: ["win32"],
    async run(editor) {
        // Коллекция записана — первый шелл после этого уже с ней.
        await editor.waitForText((t) => t.includes("Env demo ready"), { timeoutMs: 20_000 });
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Terminal: Create New Terminal");
        await editor.waitForText((t) => t.includes("Terminal: Create New Terminal"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("TERMINAL"), { timeoutMs: 15_000 });
        await editor.sendText('echo "port=$DEMO_SERVER_PORT path=${PATH%%:*}"');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("port=4242 path=/opt/demo-tools"), { timeoutMs: 15_000 });
        await editor.capture("terminal");
    },
});

import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Two content providers on one scheme: the document comes from the one that answers. The language an extension
// sets, before the tab exists and on the open tab, shows in the status bar. Then the workspace folder pick.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-content-provider-probe");

export default defineScenario({
    name: "content-provider-language",
    title: "Several content providers on a scheme, setTextDocumentLanguage in the status bar, folder pick",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 110,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("TypeScript"), { timeoutMs: 30000 });
        const probe = async (title: string): Promise<void> => {
            await editor.sendKey("F1");
            await editor.waitForNode("#quickInput");
            await editor.sendText(title);
            await editor.waitForText((t) => t.includes(title), { timeoutMs: 20000 });
            await editor.sendKey("Enter");
        };

        await probe("Open Virtual Document");
        await editor.waitForText((t) => t.includes("from the first provider") && t.includes("JSON"), {
            timeoutMs: 20000,
        });
        await editor.capture("virtual-document-json");

        await probe("Set Language To Python");
        await editor.waitForText((t) => t.includes("Python") && t.includes("Language now python, known true, listed true"), {
            timeoutMs: 20000,
        });
        await editor.capture("language-python");

        await probe("Pick Folder");
        await editor.waitForText((t) => t.includes("Select workspace folder"), { timeoutMs: 20000 });
        await editor.capture("folder-pick");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("root true"), { timeoutMs: 20000 });
        await editor.capture("folder-picked");
    },
});

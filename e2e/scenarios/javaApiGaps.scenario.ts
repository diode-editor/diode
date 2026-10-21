import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A custom fixture rather than the stock redhat.java extension: the marketplace registry has no entry for it yet,
// and it requires JDK 21.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "javaApiSample");
const sampleFile = resolve(sampleDir, "src", "main", "java", "com", "example", "App.java");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-java-api-probe");

export default defineScenario({
    name: "java-api-gaps",
    title: "env.uiKind, workspace.fs, findFiles и заглушка custom editor в одном activate()",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 120,
    rows: 26,
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+b", command: "workbench.action.toggleSidebarVisibility" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Java API sample"), { timeoutMs: 20_000 });

        // A failure word in the marker means some step failed.
        await editor.waitForText((t) => t.includes("java api: готово"), { timeoutMs: 30_000 });
        await editor.capture("activated");

        // Hide the sidebar: the panel does not wrap, so with the explorer open the tail of a long line falls
        // outside the frame.
        await editor.sendKey("Alt+B");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Java API Probe: Show Report");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("uiKind=Desktop") && t.includes("telemetry=off"), {
            timeoutMs: 15_000,
        });
        await editor.waitForText((t) => t.includes("readDirectory=[pom.bak, pom.xml]"), { timeoutMs: 15_000 });
        // A foreign scheme yields `undefined`, not "not writable".
        await editor.waitForText((t) => t.includes("isWritableFileSystem file=true jdt=undefined"), {
            timeoutMs: 15_000,
        });
        // `exclude: undefined` applies `files.exclude` and drops the other pom, while `exclude: null` finds it: so the
        // file exists and it is our filtering that drops it.
        await editor.waitForText(
            (t) => t.includes("по умолчанию=[pom.xml]") && t.includes("без исключений=2") && t.includes("maxResults1=1"),
            { timeoutMs: 15_000 },
        );
        await editor.waitForText((t) => t.includes("итог: все шаги прошли"), { timeoutMs: 15_000 });
        await editor.capture("report");
    },
});

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The directory is populated in prepare since the scenario writes to disk. pom.xml is the same as java-lsp's.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-java-move-demo-"));
const packageDir = join(sampleDir, "src", "main", "java", "demo");
const appFile = join(packageDir, "App.java");
const helperFile = join(packageDir, "Helper.java");

const APP_JAVA = [
    "package demo;",
    "",
    "public class App {",
    "    public static void main(String[] args) {",
    "        System.out.println(new Helper().name());",
    "    }",
    "}",
    "",
    "class Helper {",
    "    String name() {",
    '        return "helper";',
    "    }",
    "}",
    "",
].join("\n");

export default defineScenario({
    name: "java-move-type-undo",
    title: "Java: Move type to new file (jdt.ls) and Ctrl+Z from any affected tab",
    open: [sampleDir, appFile],
    installVsix: ["redhat.java"],
    network: true,
    settings: { "redhat.telemetry.enabled": false },
    userKeybindings: [{ key: "f6", command: "editor.action.refactor" }],
    // Installing a 139 MB vsix, importing the maven project and two JVMs, as in java-lsp.
    timeoutMs: 900_000,
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(packageDir, { recursive: true });
        copyFileSync(resolve(repoRoot, "e2e", "fixtures", "javaSample", "pom.xml"), join(sampleDir, "pom.xml"));
        writeFileSync(appFile, APP_JAVA);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("class Helper {"));

        // `Helper` in the declaration: line 9, column 6.
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowDown");
        for (let i = 0; i < 6; i++) await editor.sendKey("ArrowRight");
        // jdt.ls serves refactorings only after the project import, so reopen the menu until the item appears.
        const deadline = Date.now() + 400_000;
        for (;;) {
            await editor.sendKey("F6");
            try {
                await editor.waitForText((t) => t.includes("Move..."), { timeoutMs: 15_000 });
                break;
            } catch (error) {
                if (Date.now() > deadline) throw error;
                await editor.sendKey("Escape");
            }
        }
        await editor.capture("menu");
        await editor.sendText("Move...");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Move type Helper to new file"), { timeoutMs: 60_000 });
        await editor.sendText("new file");
        await editor.sendKey("Enter");

        // Not a refactoring for `workspace.applyEdit`: the file is created, its text stays in a dirty model, as upstream.
        await waitUntil(
            () => Promise.resolve(existsSync(helperFile)),
            (exists) => exists,
            { describe: "new Helper.java on disk", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.includes("public class App {") && !t.includes("class Helper {"), {
            timeoutMs: 60_000,
        });
        await editor.capture("moved");

        await editor.sendKey("Ctrl+Z");
        await waitUntil(
            () => Promise.resolve(existsSync(helperFile)),
            (exists) => !exists,
            { describe: "Helper.java removed by undo", timeoutMs: 30_000, intervalMs: 250 },
        );
        await editor.waitForText((t) => t.includes("class Helper {"));
        await editor.capture("undone");
    },
});

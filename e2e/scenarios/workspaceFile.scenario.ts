import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `web.code-workspace` hides `backend`, `backend.code-workspace` hides `web`; the directory's `.diode/settings.json`
// hides `generated` and applies on top of the workspace file (folder layer, as upstream).

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");

/** A chevron (one character in the frame text) and the name, nothing after; root files don't match the pattern. */
function hasTopDir(screen: string, name: string): boolean {
    return new RegExp(`^\\s*\\S?\\s*${name}$`, "m").test(screen);
}

export default defineScenario({
    name: "workspace-file",
    title: "Workspace file: two .code-workspace files over one folder — two sets of settings",
    open: [resolve(fixture, "web.code-workspace")],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes(explorerTitle(resolve(fixture, "web.code-workspace"))) &&
                t.includes("backend.code-workspace") &&
                hasTopDir(t, "web") &&
                !hasTopDir(t, "backend") &&
                !hasTopDir(t, "generated"),
        );
        await editor.capture("web");

        await editor.sendKey("F1");
        await editor.sendText("Open Workspace from File");
        await editor.waitForText((t) => t.includes("File: Open Workspace from File..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Enter a .code-workspace file path"));
        await editor.sendText(resolve(fixture, "backend.code-workspace"));
        await editor.sendKey("Enter");

        await editor.waitForText(
            (t) => hasTopDir(t, "backend") && !hasTopDir(t, "web") && !hasTopDir(t, "generated"),
        );
        await editor.capture("backend");
    },
});

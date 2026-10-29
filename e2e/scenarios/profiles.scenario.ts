import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { frameToText } from "../helpers/frame.ts";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The seed carries `User/profiles/work/` without a registry — migration registers it as profile `work`. `work` has
// a light theme, so a profile switch shows in the frame (Dark Modern has no white cells at all).

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-profiles");

const WHITE = 0xffffff;

function countBackground(frame: GridSnapshot, bg: number): number {
    return frame.cells.filter((cell) => cell.bg === bg).length;
}

async function expectTheme(editor: ScenarioDriver, light: boolean): Promise<void> {
    const frame = await editor.captureFrame();
    const white = countBackground(frame, WHITE);
    if (light && white < 100) throw new Error(`expected a light theme, white cells: ${String(white)}`);
    if (!light && white > 0) throw new Error(`expected a dark theme, white cells: ${String(white)}`);
}

/**
 * Picker cell labelled `label`: frame lines are split at the border (`│`), so
 * neighbouring explorer text does not interfere. The label is either bare or
 * after a single character (the `$(check)` glyph of the current profile); the
 * status bar line with the repository branch name never matches.
 */
function pickerCell(text: string, label: string): string | undefined {
    return text
        .split("\n")
        .flatMap((line) => line.split("│"))
        .map((cell) => cell.trim())
        .find((cell) => cell === label || (cell.endsWith(` ${label}`) && cell.length <= label.length + 2));
}

/** The picker row for profile `name` is marked with the `$(check)` glyph before the name. */
function expectCurrentMark(frame: GridSnapshot, name: string): void {
    const cell = pickerCell(frameToText(frame), name);
    if (cell === undefined || cell === name) {
        throw new Error(`picker row \`${name}\` has no current-profile mark: ${cell ?? "no such row"}`);
    }
}

/** Matches the label bare or after the current-profile glyph. */
function hasRow(text: string, label: string): boolean {
    return pickerCell(text, label) !== undefined;
}

/** Runs a command palette command by its full title. */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

/** Window reload after a profile command: the old socket closes, a new one comes up on the same port. */
async function reloaded(editor: ScenarioDriver): Promise<void> {
    await editor.reconnect();
    // Web or backend, whichever workspace file the window came back on.
    await editor.waitForText((t) => t.includes(" (WORKSPACE)"), { timeoutMs: 60_000 });
}

export default defineScenario({
    name: "profiles",
    title: "Profiles: picker, switching with reload, binding to .code-workspace, New/Delete Profile",
    seedUserData: userData,
    open: [resolve(fixture, "web.code-workspace")],
    cols: 120,
    rows: 30,
    // On Windows, Reload Window from a scenario brings the window up without the sidebar (docs/TODO/E2E.md).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes(explorerTitle(resolve(fixture, "web.code-workspace"))));
        await expectTheme(editor, false);
        await editor.capture("default");

        // Picker: Default is checked, `work` comes from the migrated directory.
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile") && t.includes("work") && t.includes("Default"));
        await editor.capture("switch-picker");
        await editor.sendText("work");
        await editor.waitForText((t) => t.includes("work") && !t.includes("Default"));
        // Enter → binds `web.code-workspace` to `work` → window reload.
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await expectTheme(editor, true);
        await editor.capture("work");

        // In the new window the check mark is on `work`.
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile"));
        expectCurrentMark(await editor.captureFrame(), "work");
        await editor.sendKey("Escape");

        // Another workspace file over the same folder has no binding → Default.
        await runCommand(editor, "File: Open Workspace from File...");
        await editor.waitForText((t) => t.includes("Enter a .code-workspace file path"));
        await editor.sendText(resolve(fixture, "backend.code-workspace"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await expectTheme(editor, false);
        await editor.capture("backend-default");

        // New Profile: name → Empty → the window reloads straight into `scratch`.
        await runCommand(editor, "Profiles: New Profile...");
        await editor.waitForText((t) => t.includes("Profile name"));
        await editor.sendText("scratch");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Empty") && t.includes("Copy from current"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile") && hasRow(t, "scratch"));
        await editor.capture("new-profile-picker");
        await editor.sendKey("Escape");

        // Delete Profile on the current `scratch`: the window returns to Default.
        await runCommand(editor, "Profiles: Delete Profile...");
        await editor.waitForText((t) => t.includes("Select Profiles to Delete") && t.includes("Current"));
        await editor.sendText("scratch");
        // The status bar shows the repository branch (the fixture lives inside the
        // repo), and its name may contain anything — so wait for the row checkbox.
        await editor.waitForText((t) => t.includes("[ ] scratch"));
        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[✓] scratch"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile") && hasRow(t, "work") && !hasRow(t, "scratch"));
        await editor.capture("deleted");
        await editor.sendKey("Escape");
    },
});

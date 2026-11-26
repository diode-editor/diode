import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The debug toolbar and the status bar while debugging, on the Debug Demo extension's adapter (it stops on entry):
// F5 puts the toolbar in the top right corner of the editor group, Ctrl+F opens find under it, Shift+F5 takes the
// toolbar away and find moves up; the status bar is `statusBar.debuggingBackground` of Dark Modern meanwhile.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");
const sourceFile = resolve(folder, "hello.c");

const DARK_MODERN_STATUS_BAR = 0x181818;
const DARK_MODERN_STATUS_BAR_DEBUGGING = 0x0078d4;

function statusBarBackground(frame: GridSnapshot): number | undefined {
    return frame.cells[(frame.rows - 1) * frame.cols]?.bg;
}

function rowOf(frame: GridSnapshot, text: string): number {
    const cell = findTextCell(frame, text);
    if (cell === null) throw new Error(`"${text}" is not on screen`);
    return cell.y;
}

export default defineScenario({
    name: "debug-toolbar",
    title: "Debug toolbar over the editor group, find stacked under it, the status bar in debugging colors",
    seedUserData: userData,
    open: [folder, sourceFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("hello.c"));
        await editor.waitForReady();
        if (statusBarBackground(await editor.captureFrame()) !== DARK_MODERN_STATUS_BAR) {
            throw new Error("the status bar should have its own color before debugging");
        }

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped"));
        await editor.waitForText((t) => t.includes("Continue") && t.includes("Restart"));
        const toolbarRow = rowOf(await editor.captureFrame(), "Continue");
        if (statusBarBackground(await editor.captureFrame()) !== DARK_MODERN_STATUS_BAR_DEBUGGING) {
            throw new Error("the status bar should take statusBar.debuggingBackground while debugging");
        }
        await editor.capture("toolbar");

        await editor.sendKey("Ctrl+f");
        await editor.waitForNode("#findWidget");
        await editor.sendText("zzz");
        await editor.waitForText((t) => t.includes("No results"));
        if (rowOf(await editor.captureFrame(), "No results") !== toolbarRow + 3) {
            throw new Error("find should open under the toolbar");
        }
        await editor.capture("find-under-toolbar");

        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated") && !t.includes("Continue"));
        await editor.waitForText((t) => t.split("\n").findIndex((line) => line.includes("No results")) === toolbarRow);
        if (statusBarBackground(await editor.captureFrame()) !== DARK_MODERN_STATUS_BAR) {
            throw new Error("the status bar should get its own color back after the session");
        }
        await editor.capture("find-moved-up");
    },
});

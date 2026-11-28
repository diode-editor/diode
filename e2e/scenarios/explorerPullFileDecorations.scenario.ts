import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell, frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `pull-decorations` registers a file decoration provider without `onDidChangeFileDecorations` (as
// `vscjava.vscode-maven`): it tells nobody about any file, so the explorer has to ask it about the rows it shows.
// `src/deep/a.pull` starts collapsed; opening `src/deep/b.txt` reveals it, the explorer asks about the new rows,
// and `a.pull` gets the red `P` while `deep` and `src` get "●".

const workspace = mkdtempSync(join(tmpdir(), "diode-pull-decorations-"));
mkdirSync(join(workspace, "src", "deep"), { recursive: true });
writeFileSync(join(workspace, "src", "deep", "a.pull"), "pulled\n");
writeFileSync(join(workspace, "src", "deep", "b.txt"), "plain\n");
writeFileSync(join(workspace, "src", "main.ts"), "export {};\n");
writeFileSync(join(workspace, "README.md"), "# demo\n");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-file-decorations");

function rowFor(text: string, name: string): string | undefined {
    return text.split("\n").find((line) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(line));
}

/** The badge after the row's label: the tree pins it to the right edge, before the sidebar's border. */
function badgeOf(text: string, name: string): string | undefined {
    const row = rowFor(text, name);
    return row?.slice(row.indexOf(name) + name.length).split("│")[0].trim();
}

function fgOf(frame: GridSnapshot, name: string): number {
    const cell = findTextCell(frame, name);
    if (cell === null) throw new Error(`"${name}" is not on screen`);
    return frame.cells[cell.y * frame.cols + cell.x].fg;
}

export default defineScenario({
    name: "explorer-pull-file-decorations",
    title: "A provider without a change event decorates the files the explorer shows: 'P' on the file, '●' up the tree",
    seedUserData: userData,
    open: [workspace, join(workspace, "src", "deep", "b.txt")],
    cols: 100,
    rows: 16,
    // Needs the extension host; like other extension scenarios, runs on Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        const frame = await editor.waitForText(
            (t) =>
                badgeOf(t, "a.pull") === "P" && badgeOf(t, "deep") === "●" && badgeOf(t, "src") === "●",
            { timeoutMs: 20_000 },
        );
        const text = Array.from({ length: frame.rows }, (_, y) => frameLine(frame, y)).join("\n");
        if (badgeOf(text, "main.ts") !== "" || badgeOf(text, "README.md") !== "") {
            throw new Error(`only a.pull and its folders are decorated:\n${text}`);
        }
        if (fgOf(frame, "a.pull") === fgOf(frame, "README.md")) {
            throw new Error("a.pull is not colored by its decoration");
        }
        await editor.capture("pulled");
    },
});

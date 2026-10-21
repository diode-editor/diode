import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NodeSnapshot } from "@tuidom/inspector/protocol";
import { resolveUserDataPaths, resolveWorkspaceStatePath } from "../src/vs/platform/environment/node/userDataPaths.ts";

import { readFileSync } from "node:fs";

import { type AppEnvOptions, type HeadlessApp, startHeadlessApp } from "./helpers/appSession.ts";
import { frameLine } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { focusedLeaf } from "./helpers/query.ts";


const here = fileURLToPath(new URL(".", import.meta.url));
export const repoRoot = resolve(here, "..");
export const sampleFixture = resolve(here, "fixtures", "sample.ts");

/** These commands have no default keybinding. */
export const OUTPUT_KEYBINDINGS: readonly { key: string; command: string }[] = [
    { key: "alt+u", command: "workbench.action.output.toggleOutput" },
    { key: "alt+j", command: "workbench.action.output.show.extensions" },
    { key: "alt+r", command: "workbench.action.files.toggleActiveEditorReadonlyInSession" },
];

/** Workspace = repoRoot, so the workspace-scoped panel state survives a restart. */
export function startOutputApp(over: Partial<AppEnvOptions> = {}): Promise<HeadlessApp> {
    return startHeadlessApp({
        cols: 120,
        rows: 32,
        keybindings: OUTPUT_KEYBINDINGS,
        open: [repoRoot, sampleFixture],
        cwd: repoRoot,
        ...over,
    });
}

export async function openOutput(session: HeadlessSession): Promise<void> {
    await session.waitForText((t) => t.includes("greeting"));
    await session.key("Alt+U");
    await session.waitForNode("SelectBoxElement");
    await session.waitForText((t) => t.includes("[info] diode starting"));
}

export async function pickChannel(session: HeadlessSession, label: string): Promise<void> {
    await session.clickNode("SelectBoxElement");
    const popup = await session.waitForNode("PopupMenuElement");
    const items = (popup.state?.items ?? []) as (string | null)[];
    const index = items.findIndex((it) => it !== null && it.includes(label));
    if (index < 0) throw new Error(`channel "${label}" not in popup: ${JSON.stringify(items)}`);
    // The first popup row is below the top border (dy = 1 + index).
    await session.clickNode("PopupMenuElement", { dx: 4, dy: 1 + index });
    await session.waitForNoNode("PopupMenuElement");
}

/**
 * Aims at the first visible line: the log autoscrolls to the tail, so the bottom lines may
 * be empty — a click there puts the cursor at the end with no text to the right. The X offset skips the gutter.
 */
export async function focusLogBody(session: HeadlessSession): Promise<NodeSnapshot> {
    const editor = await outputEditor(session);
    await session.click(editor.box.x + 12, editor.box.y);
    return session.waitForFocus("EditorElement");
}

/** The bottom-most EditorElement — the main editor is above it. */
export async function outputEditor(session: HeadlessSession): Promise<NodeSnapshot> {
    const editors = await session.nodes("EditorElement");
    if (editors.length === 0) throw new Error("no EditorElement in tree");
    return editors.reduce((lowest, e) => (e.box.y > lowest.box.y ? e : lowest));
}

export async function focusedEditorState(session: HeadlessSession): Promise<Record<string, unknown> | undefined> {
    return focusedLeaf((await session.getDocument()).root)?.state;
}

export async function focusedType(session: HeadlessSession): Promise<string | undefined> {
    return focusedLeaf((await session.getDocument()).root)?.type;
}

/**
 * `dx` is the click offset from the start of the substring; `maxX` is a column bound (sidebar
 * only, so as not to hit a same-named tab at the top).
 */
export async function clickText(
    session: HeadlessSession,
    needle: string,
    opts: { dx?: number; maxX?: number } = {},
): Promise<void> {
    const frame = await session.captureFrame();
    const maxX = opts.maxX ?? Number.POSITIVE_INFINITY;
    let cell: { x: number; y: number } | null = null;
    for (let y = 0; y < frame.rows && cell === null; y++) {
        const x = frameLine(frame, y).indexOf(needle);
        if (x >= 0 && x <= maxX) cell = { x, y };
    }
    if (cell === null) throw new Error(`clickText: "${needle}" not on screen (maxX=${String(maxX)})`);
    await session.click(cell.x + (opts.dx ?? 0), cell.y);
}

/** The find widget line (the one with the `[ ↑ ]` navigation arrows), or an empty string. */
export function findWidgetLine(frame: import("@tuidom/core/rendering/gridSnapshot").GridSnapshot): string {
    for (let y = 0; y < frame.rows; y++) if (frameLine(frame, y).includes("[ ↑ ]")) return frameLine(frame, y);
    return "";
}

/**
 * waitForIdle does not catch the workspace-state write debounce (500 ms); without this wait
 * a restart would depend on the race of flushSync-on-exit against SIGKILL. If the file is not found
 * (path normalization on another platform), don't throw — wait longer than the debounce.
 */
export async function waitForPanelPersisted(root: string): Promise<void> {
    const paths = resolveUserDataPaths({ userDataDir: join(root, "user-data-dir"), homedir: homedir() });
    const stateFile = resolveWorkspaceStatePath(paths.workspaceStorageDir, repoRoot);
    const deadline = Date.now() + 3_000;
    const debounceCovered = Date.now() + 1_200; // > WRITE_DEBOUNCE_MS (500)
    while (Date.now() < deadline) {
        let body = "";
        try {
            body = readFileSync(stateFile, "utf-8");
        } catch {
            // the file does not exist yet
        }
        if (/workbench\.panel\.visible[^,}]*true/u.test(body)) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    while (Date.now() < debounceCovered) await new Promise((r) => setTimeout(r, 100));
}

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

/** У этих команд нет дефолтного шортката. */
export const OUTPUT_KEYBINDINGS: readonly { key: string; command: string }[] = [
    { key: "alt+u", command: "workbench.action.output.toggleOutput" },
    { key: "alt+j", command: "workbench.action.output.show.extensions" },
    { key: "alt+r", command: "workbench.action.files.toggleActiveEditorReadonlyInSession" },
];

/** Workspace = repoRoot, чтобы workspace-scoped состояние панели переживало рестарт. */
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
    // Первая строка попапа — под верхней рамкой (dy = 1 + index).
    await session.clickNode("PopupMenuElement", { dx: 4, dy: 1 + index });
    await session.waitForNoNode("PopupMenuElement");
}

/**
 * Целимся в первую видимую строку: лог автоскроллится к хвосту, нижние строки могут
 * быть пустыми — клик туда ставит курсор в конец без текста справа. Отступ по X — за гуттер.
 */
export async function focusLogBody(session: HeadlessSession): Promise<NodeSnapshot> {
    const editor = await outputEditor(session);
    await session.click(editor.box.x + 12, editor.box.y);
    return session.waitForFocus("EditorElement");
}

/** Самый нижний EditorElement — главный редактор выше. */
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
 * `dx` — смещение клика от начала подстроки; `maxX` — граница по столбцу (только
 * сайдбар, чтобы не попасть в одноимённую вкладку сверху).
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

/** Строка find-виджета (та, где стрелки навигации `[ ↑ ]`), или пустая строка. */
export function findWidgetLine(frame: import("@tuidom/core/rendering/gridSnapshot").GridSnapshot): string {
    for (let y = 0; y < frame.rows; y++) if (frameLine(frame, y).includes("[ ↑ ]")) return frameLine(frame, y);
    return "";
}

/**
 * Debounce записи workspace-состояния (500 мс) waitForIdle не ловит; без ожидания
 * рестарт зависел бы от гонки flushSync-на-выходе против SIGKILL. Файл не нашёлся
 * (нормализация пути на другой платформе) — не бросаем, а выжидаем > debounce.
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
            // файла ещё нет
        }
        if (/workbench\.panel\.visible[^,}]*true/u.test(body)) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    while (Date.now() < debounceCovered) await new Promise((r) => setTimeout(r, 100));
}

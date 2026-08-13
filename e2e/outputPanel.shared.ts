import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { NodeSnapshot } from "@tuidom/all/inspector/protocol";
import { resolveUserDataPaths, resolveWorkspaceStatePath } from "../src/vs/platform/environment/node/userDataPaths.ts";

import { readFileSync } from "node:fs";

import { type AppEnvOptions, type HeadlessApp, startHeadlessApp } from "./helpers/appSession.ts";
import { frameLine } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { focusedLeaf } from "./helpers/query.ts";

// Общая обвязка функциональных тестов панели Output (бывшие пробы PR #197,
// переписанные на общие хелперы: ни одного sleep, ни одной координаты-литерала).

const here = fileURLToPath(new URL(".", import.meta.url));
/** Корень репозитория — открываем его как workspace-папку (как исходные пробы). */
export const repoRoot = resolve(here, "..");
/** Репозиторная фикстура с «greeting» — открываем её активным редактором. */
export const sampleFixture = resolve(here, "fixtures", "sample.ts");

/** Кейбинды панели Output и смежных команд (команды без дефолтного шортката). */
export const OUTPUT_KEYBINDINGS: readonly { key: string; command: string }[] = [
    { key: "alt+u", command: "workbench.action.output.toggleOutput" },
    { key: "alt+j", command: "workbench.action.output.show.extensions" },
    { key: "alt+r", command: "workbench.action.files.toggleActiveEditorReadonlyInSession" },
];

/**
 * Запуск с кейбиндами панели, открытым repoRoot-workspace и repo-фикстурой
 * (user-data/HOME изолированы). Workspace = repoRoot, чтобы workspace-scoped
 * состояние панели (видимость/активная вкладка) переживало рестарт.
 */
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

/** Открывает панель Output (Alt+U) и ждёт селектор канала + непустой лог. */
export async function openOutput(session: HeadlessSession): Promise<void> {
    await session.waitForText((t) => t.includes("greeting"));
    await session.key("Alt+U");
    await session.waitForNode("SelectBoxElement");
    await session.waitForText((t) => t.includes("[info] vexx starting"));
}

/**
 * Меняет канал мышью: раскрывает селектор, кликает по строке с подписью,
 * содержащей `label`. Индекс — из состояния попапа, не из магической координаты.
 */
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
 * Кликает в тело лога, чтобы сфокусировать редактор панели Output; ждёт фокус.
 * Целимся в первую видимую строку (`box.y`): лог автоскроллится к хвосту, и
 * нижние строки могут быть пустыми (клик туда ставит курсор в конец без текста
 * справа — навигация «не двигается»). Первая же видимая строка — настоящая
 * строка лога с текстом. Небольшой отступ по X уводит клик за гуттер.
 */
export async function focusLogBody(session: HeadlessSession): Promise<NodeSnapshot> {
    const editor = await outputEditor(session);
    await session.click(editor.box.x + 12, editor.box.y);
    return session.waitForFocus("EditorElement");
}

/**
 * Редактор панели Output — самый нижний EditorElement (главный редактор выше).
 */
export async function outputEditor(session: HeadlessSession): Promise<NodeSnapshot> {
    const editors = await session.nodes("EditorElement");
    if (editors.length === 0) throw new Error("no EditorElement in tree");
    return editors.reduce((lowest, e) => (e.box.y > lowest.box.y ? e : lowest));
}

/** Состояние сфокусированного редактора (для проверок выделения/курсора). */
export async function focusedEditorState(session: HeadlessSession): Promise<Record<string, unknown> | undefined> {
    return focusedLeaf((await session.getDocument()).root)?.state;
}

/** Тип сфокусированного листа (для проверок «фокус не потерялся»). */
export async function focusedType(session: HeadlessSession): Promise<string | undefined> {
    return focusedLeaf((await session.getDocument()).root)?.type;
}

/**
 * Кликает по первому вхождению текста `needle` в кадр, затем settle. `dx` —
 * смещение точки клика от начала подстроки; `maxX` — ограничение по столбцу
 * (например только сайдбар, чтобы не попасть в одноимённую вкладку сверху).
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
export function findWidgetLine(frame: import("@tuidom/all/rendering/gridSnapshot").GridSnapshot): string {
    for (let y = 0; y < frame.rows; y++) if (frameLine(frame, y).includes("[ ↑ ]")) return frameLine(frame, y);
    return "";
}

/**
 * Ждёт, пока StateService сдебаунсит запись workspace-состояния панели на диск
 * (видимость панели → true) — async-хвост (debounce 500 мс), который не ловит
 * waitForIdle. Предикат по файлу состояния гарантирует, что рестарт увидит панель
 * открытой, не полагаясь на гонку flushSync-на-выходе против SIGKILL.
 *
 * Best-effort: если файл найден и панель открыта — возвращаемся сразу; если путь
 * почему-то не совпал (нормализация на другой платформе), не бросаем, а всё равно
 * выжидаем > debounce — асинхронная запись к этому моменту точно прошла.
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
    // Файл по вычисленному пути не подтвердил панель — добираем окно debounce.
    while (Date.now() < debounceCovered) await new Promise((r) => setTimeout(r, 100));
}

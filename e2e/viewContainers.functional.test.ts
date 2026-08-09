import { beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональный e2e общей модели view-контейнеров: чёрным ящиком через
// инспектор настоящего бинаря. Здесь важна не картинка, а наблюдаемые
// инварианты модели — состав секций (`PaneViewElement.inspectState`), слияние
// заголовков и стабильность корня контейнера при смене корня воркспейса.

const FILES = {
    "alpha.ts": "export const a = 1;\n",
    "beta.ts": "export const b = 2;\n",
} as const;

const KEYS = [
    { key: "f6", command: "workbench.view.search" },
    { key: "f7", command: "workbench.view.explorer" },
    // Настоящая клавиша — Ctrl+J, e2e-DSL её не кодирует.
    { key: "f8", command: "workbench.action.togglePanel" },
];

const PROBLEMS_CONTAINER = "workbench.panel.markers.view";

async function openApp(): Promise<HeadlessApp> {
    const app = await useHeadlessApp({ files: FILES, keybindings: KEYS, cols: 100, rows: 30 });
    await app.session.waitForText((t) => t.includes("EXPLORER"));
    return app;
}

/** Id секций контейнера — из inspectState его PaneViewElement. */
async function paneIds(app: HeadlessApp, containerId: string): Promise<string[]> {
    const node = await app.session.node(`#viewContainer-${containerId.replaceAll(".", "-")}`);
    const state = node?.state as { panes?: { id: string }[] } | undefined;
    return (state?.panes ?? []).map((p) => p.id);
}

describe("View containers (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("Explorer — контейнер сайдбара с одной секцией, заголовки слиты", async () => {
        const app = await openApp();
        const { session } = app;

        // Корень контейнера — стабильный селектор места.
        expect(await session.node("#explorer")).not.toBeNull();
        expect(await paneIds(app, "explorer")).toEqual(["workbench.explorer.fileView"]);

        // Одна секция → своего заголовка у контейнера нет, а секция несёт его
        // название и не сворачивается.
        expect(await session.node("#viewContainerHeader-explorer")).toBeNull();
        const header = await session.node("#paneHeader-workbench-explorer-fileView");
        expect(header?.state).toMatchObject({ title: "EXPLORER", collapsible: false });
    });

    it("заголовок Explorer'а несёт кнопки создания и обновления", async () => {
        const app = await openApp();
        const { session } = app;
        const header = await session.node("#paneHeader-workbench-explorer-fileView");
        expect(header).not.toBeNull();

        // Кнопки — правые колонки строки заголовка: три действия по 3 колонки
        // плюс «⋯». Проверяем через кадр: строка заголовка не пустая справа.
        const text = frameToText(await session.captureFrame());
        const titleRow = text.split("\n").find((line) => line.includes("EXPLORER"))!;
        expect(titleRow.trimEnd().length).toBeGreaterThan(" EXPLORER".length);
    });

    it("Search — тоже один контейнер одной секции, переключение места не ломает корень", async () => {
        const app = await openApp();
        const { session } = app;

        await session.key("F6");
        await session.waitForText((t) => t.includes("SEARCH"));
        expect(await paneIds(app, "search")).toEqual(["workbench.search.results"]);
        expect(await session.node("#searchView")).not.toBeNull();

        await session.key("F7");
        await session.waitForText((t) => t.includes("EXPLORER"));
        expect(await session.node("#explorer")).not.toBeNull();
    });

    it("вкладка нижней панели — контейнер того же реестра, без своего заголовка", async () => {
        const app = await openApp();
        const { session } = app;

        // Панель монтируется только видимой — сперва показываем её.
        await session.key("F8");
        await session.waitForText((t) => t.includes("PROBLEMS") && t.includes("TERMINAL"));

        // Вкладка PROBLEMS — контейнер с единственной секцией; её заголовок скрыт,
        // роль заголовка играет таб.
        expect(await paneIds(app, PROBLEMS_CONTAINER)).toEqual([PROBLEMS_CONTAINER]);

        // Пустое состояние рисует сама секция, а не таб-строка; строки заголовка
        // у секции нет — подсказка стоит первой строкой контента вкладки.
        const placeholder = await session.node("#viewPlaceholder-workbench-panel-markers-view");
        const tabs = await session.node("#panel");
        expect(placeholder).not.toBeNull();
        expect(placeholder!.box.y).toBe(tabs!.box.y + 2);
    });
});

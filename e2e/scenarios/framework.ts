import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import type { GetDocumentResult, NodeSnapshot, SendMouseParams } from "@tuidom/inspector/protocol";
import { startHeadlessApp } from "../helpers/appSession.ts";
import type { MouseModifiers, NodeClickOffset, SettleOption } from "../helpers/headlessSession.ts";
import { saveScreenshot } from "../helpers/renderScreenshot.ts";

// ── Screenshot scenarios ────────────────────────────────────────────────────
// A scenario is the demo code for a visual feature: it launches the real editor
// headless, drives it (open files, send keys), and captures named screenshots.
// One `*.scenario.ts` file per feature/flow lives next to this module. Two
// consumers share `runScenario`: `generate.ts` (npm run screenshots → PNGs for a
// PR) and `scenarios.test.ts` (CI, keeps scenarios from rotting).

const here = fileURLToPath(new URL(".", import.meta.url));
const scenariosDir = here;
/** Repo root — scenarios open paths relative to it and run with it as cwd. */
export const repoRoot = resolve(here, "..", "..");

/** Driver handed to a scenario's `run` — the editor plus a `capture` verb. */
export interface ScenarioDriver {
    /** Inject a key by DSL name (`"a"`, `"Enter"`, `"Ctrl+P"`). */
    sendKey(name: string): Promise<void>;
    /** Inject literal text as a single paste. */
    sendText(text: string): Promise<void>;
    /** Resize the virtual terminal. */
    resize(cols: number, rows: number): Promise<void>;
    /** Poll the screen until `predicate(text)` holds; returns the matching frame. */
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<GridSnapshot>;
    /** Capture the current screen. */
    captureFrame(): Promise<GridSnapshot>;
    /** Snapshot of the element tree (node boxes are the {@link click} coordinates). */
    getDocument(): Promise<GetDocumentResult>;
    /** Poll the tree until a node matches `selector`; returns it. */
    waitForNode(selector: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<NodeSnapshot>;
    /** Inject a raw mouse event at 0-based screen cells. */
    sendMouse(params: SendMouseParams): Promise<void>;
    /** Click a cell (0-based), then settle. */
    click(x: number, y: number, opts?: MouseModifiers & SettleOption): Promise<void>;
    /** Click the centre (or `dx`/`dy` offset) of the first `selector` match, then settle. */
    clickNode(selector: string, opts?: MouseModifiers & SettleOption & NodeClickOffset): Promise<void>;
    /** Spin the wheel over a cell, then settle. */
    wheel(x: number, y: number, direction: "up" | "down" | "left" | "right"): Promise<void>;
    /** Capture and save `screenshots/<scenario>-<shot>.png`; returns the path. */
    capture(shot: string): Promise<string>;
}

export interface ScenarioSpec {
    /** Kebab-case id; prefixes every screenshot file. */
    name: string;
    /** Human-readable title for the screenshots index. */
    title?: string;
    /** Files/dirs the editor opens (a dir becomes the workspace folder). */
    open?: string[];
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    /**
     * Платформы (`process.platform`), на которых CI-safety-net (`scenarios.test.ts`)
     * пропускает сценарий. Скриншоты (`npm run screenshots`) генерируются как обычно.
     * Нужно для extension-host сценариев: субпроцесс-расширения в e2e гоняем только
     * на Linux (как `editorconfig-stock`/`sea-git`).
     */
    skipOn?: readonly NodeJS.Platform[];
    /**
     * Что ставится в hermetic user-data-dir сценария перед запуском (тот же путь,
     * что `--install-extension` у пользователя): путь к `.vsix` либо id записи из
     * публичного магазина — различение как у CLI, по суффиксу `.vsix`. Нужно
     * демонстрировать фичи, которые видны только со стоковым расширением —
     * например folding-провайдер (#194). Сценарий с установкой по id помечается
     * `network: true`.
     */
    installVsix?: readonly string[];
    /**
     * Сценарий ходит в сеть (ставит расширение из магазина): CI-safety-net
     * (`scenarios.test.ts`) пропускает его при `DIODE_E2E_OFFLINE=1` — та же
     * договорённость, что у сетевых e2e (docs/TESTING.md).
     */
    network?: boolean;
    /**
     * settings.json активного профиля в hermetic user-data-dir сценария. Нужно
     * фичам, которым требуется конфигурация (напр. путь к language-серверу для
     * LSP-сценария — сервер живёт в devDeps репозитория, не в PATH).
     */
    settings?: Readonly<Record<string, unknown>>;
    /**
     * Пользовательские кейбинды (`keybindings.json`) в hermetic user-data-dir
     * сценария. Нужны, когда команду важно исполнить, НЕ уводя фокус: палитра
     * возвращает фокус тому, у кого он был на момент открытия, а маршрут к ней
     * через меню-бар оставляет фокус в меню — и последующий ввод не доходит до
     * редактора. Привязка команды к клавише убирает этот шум из сценария.
     */
    userKeybindings?: readonly { key: string; command: string }[];
    /**
     * Дополнительные аргументы CLI (перед списком открываемых путей). Нужны
     * сценариям, которым важен источник данных, а не только содержимое
     * воркспейса: магазин расширений показывает `--registry <фикстура>`, иначе
     * демо зависело бы от сети и от того, что сейчас опубликовано.
     */
    extraArgs?: readonly string[];
    /**
     * Каталог, который копируется в hermetic user-data-dir сценария (расширения,
     * настройки). Нужен демо, где важно НЕ пустое состояние: магазин без единого
     * установленного расширения не показывает ни секции INSTALLED, ни бейджей.
     */
    seedUserData?: string;
    run(driver: ScenarioDriver): Promise<void>;
}

/** One captured screenshot with its metadata. */
export interface CapturedShot {
    scenario: string;
    shot: string;
    title: string;
    path: string;
}

/** Identity helper — gives a scenario file its typed `default` export. */
export function defineScenario(spec: ScenarioSpec): ScenarioSpec {
    return spec;
}

/**
 * Launch the real binary headless, run the scenario, capture its screenshots,
 * and tear the session down. Returns the shots it produced.
 *
 * Изоляция (временный user-data-dir + HOME, keybindings, установка `.vsix`) —
 * общая с e2e-сьютами через {@link startHeadlessApp}. Сценарии открывают
 * `repoRoot` абсолютными путями и должны стартовать из него (bundle/расширения
 * рядом), поэтому `cwd` фиксируем на repoRoot, а изолированный воркспейс не
 * используется.
 */
export async function runScenario(spec: ScenarioSpec): Promise<CapturedShot[]> {
    const app = await startHeadlessApp({
        open: spec.open ?? [],
        cwd: repoRoot,
        ...(spec.installVsix !== undefined ? { installVsix: spec.installVsix } : {}),
        ...(spec.settings !== undefined ? { settings: spec.settings } : {}),
        ...(spec.userKeybindings !== undefined ? { keybindings: spec.userKeybindings } : {}),
        ...(spec.extraArgs !== undefined ? { extraArgs: spec.extraArgs } : {}),
        ...(spec.seedUserData !== undefined ? { seedUserData: spec.seedUserData } : {}),
        ...(spec.cols !== undefined ? { cols: spec.cols } : {}),
        ...(spec.rows !== undefined ? { rows: spec.rows } : {}),
        ...(spec.env !== undefined ? { env: spec.env } : {}),
    });
    const { session } = app;
    const shots: CapturedShot[] = [];
    const driver: ScenarioDriver = {
        sendKey: (name) => session.sendKey(name),
        sendText: (text) => session.sendText(text),
        resize: (cols, rows) => session.resize(cols, rows),
        waitForText: (predicate, opts) => session.waitForText(predicate, opts),
        captureFrame: () => session.captureFrame(),
        getDocument: () => session.getDocument(),
        waitForNode: (selector, opts) => session.waitForNode(selector, opts),
        sendMouse: (params) => session.sendMouse(params),
        click: (x, y, opts) => session.click(x, y, opts),
        clickNode: (selector, opts) => session.clickNode(selector, opts),
        wheel: (x, y, direction) => session.wheel(x, y, direction),
        capture: async (shot) => {
            const frame = await session.captureFrame();
            const path = saveScreenshot(`${spec.name}-${shot}`, frame);
            shots.push({ scenario: spec.name, shot, title: spec.title ?? spec.name, path });
            return path;
        },
    };
    try {
        await spec.run(driver);
    } finally {
        await app.dispose();
    }
    return shots;
}

/** Discover and import every `*.scenario.ts` in this directory (sorted by name). */
export async function loadScenarios(): Promise<ScenarioSpec[]> {
    const files = readdirSync(scenariosDir)
        .filter((f) => f.endsWith(".scenario.ts"))
        .sort();
    const specs: ScenarioSpec[] = [];
    for (const file of files) {
        const mod = (await import(pathToFileURL(resolve(scenariosDir, file)).href)) as { default?: ScenarioSpec };
        if (mod.default !== undefined) specs.push(mod.default);
    }
    return specs;
}

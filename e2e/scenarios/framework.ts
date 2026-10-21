import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import type { GetDocumentResult, NodeSnapshot, SendMouseParams } from "@tuidom/inspector/protocol";
import { startHeadlessApp } from "../helpers/appSession.ts";
import type { MouseModifiers, NodeClickOffset, SettleOption } from "../helpers/headlessSession.ts";
import { saveScreenshot } from "../helpers/renderScreenshot.ts";


const here = fileURLToPath(new URL(".", import.meta.url));
const scenariosDir = here;
export const repoRoot = resolve(here, "..", "..");

export interface ScenarioDriver {
    sendKey(name: string): Promise<void>;
    sendText(text: string): Promise<void>;
    resize(cols: number, rows: number): Promise<void>;
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<GridSnapshot>;
    captureFrame(): Promise<GridSnapshot>;
    /** Text on screen is not readiness: extensions start after the text and highlight frames, as in vscode. */
    waitForReady(timeoutMs?: number): Promise<void>;
    getDocument(): Promise<GetDocumentResult>;
    waitForNode(selector: string, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<NodeSnapshot>;
    /** 0-based screen cells. */
    sendMouse(params: SendMouseParams): Promise<void>;
    /** 0-based cell. */
    click(x: number, y: number, opts?: MouseModifiers & SettleOption): Promise<void>;
    clickNode(selector: string, opts?: MouseModifiers & SettleOption & NodeClickOffset): Promise<void>;
    wheel(x: number, y: number, direction: "up" | "down" | "left" | "right"): Promise<void>;
    /** Capture and save `screenshots/<scenario>-<shot>.png`; returns the path. */
    capture(shot: string): Promise<string>;
    /** После `workbench.action.reloadWindow` процесс заменяет себя, инспектор поднимается на том же порту. */
    reconnect(): Promise<void>;
}

export interface ScenarioSpec {
    /** Kebab-case id; prefixes every screenshot file. */
    name: string;
    title?: string;
    /** Опущено — каталог воркспейса сценария; пустой массив — запуск без позиционных аргументов (пустое окно). */
    open?: string[];
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    /** Пропуск только в CI-safety-net (`scenarios-<N>.test.ts`); скриншоты генерируются как обычно. */
    skipOn?: readonly NodeJS.Platform[];
    /** Путь к `.vsix` либо id из магазина (различение по суффиксу, как у CLI); id требует `network: true`. */
    installVsix?: readonly string[];
    /** Пустое — 300с. */
    timeoutMs?: number;
    /** CI-safety-net пропускает сценарий при `DIODE_E2E_OFFLINE=1`. */
    network?: boolean;
    /** Причина пропуска (и в CI-safety-net, и в `npm run screenshots`) либо `undefined`, если инструмент есть. */
    requires?(): string | undefined;
    settings?: Readonly<Record<string, unknown>>;
    /**
     * Чтобы исполнить команду, не уводя фокус: палитра возвращает фокус тому, у кого он был, а маршрут через
     * меню-бар оставляет его в меню.
     */
    userKeybindings?: readonly { key: string; command: string; when?: string; args?: unknown }[];
    extraArgs?: readonly string[];
    seedUserData?: string;
    /** Зовётся, только когда сценарий реально запускается: сетевая подготовка не бьёт по офлайн-прогонам. */
    prepare?(): Promise<void>;
    run(driver: ScenarioDriver): Promise<void>;
}

export interface CapturedShot {
    scenario: string;
    shot: string;
    title: string;
    path: string;
}

export function defineScenario(spec: ScenarioSpec): ScenarioSpec {
    return spec;
}

/** `cwd` — repoRoot: сценарии открывают его абсолютными путями, bundle и расширения лежат рядом. */
export async function runScenario(spec: ScenarioSpec): Promise<CapturedShot[]> {
    await spec.prepare?.();
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
        waitForReady: (timeoutMs) => session.waitForReady(timeoutMs),
        getDocument: () => session.getDocument(),
        waitForNode: (selector, opts) => session.waitForNode(selector, opts),
        sendMouse: (params) => session.sendMouse(params),
        click: (x, y, opts) => session.click(x, y, opts),
        clickNode: (selector, opts) => session.clickNode(selector, opts),
        wheel: (x, y, direction) => session.wheel(x, y, direction),
        reconnect: () => session.reconnect(),
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

export function scenarioFiles(): string[] {
    return readdirSync(scenariosDir)
        .filter((f) => f.endsWith(".scenario.ts"))
        .sort();
}

/** `filter` отбирает файлы до импорта: часть сценариев готовит фикстуры прямо при импорте (`mkdtempSync`). */
export async function loadScenarios(filter: (file: string, index: number) => boolean = () => true): Promise<ScenarioSpec[]> {
    const files = scenarioFiles().filter(filter);
    const specs: ScenarioSpec[] = [];
    for (const file of files) {
        const mod = (await import(pathToFileURL(resolve(scenariosDir, file)).href)) as { default?: ScenarioSpec };
        if (mod.default !== undefined) specs.push(mod.default);
    }
    return specs;
}

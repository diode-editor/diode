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
    /** The node's `inspectState()`; for what the frame does not show, such as folding regions computed after a delay. */
    waitForState(
        selector: string,
        predicate: (state: Record<string, unknown> | undefined) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<NodeSnapshot>;
    /** 0-based screen cells. */
    sendMouse(params: SendMouseParams): Promise<void>;
    /** 0-based cell. */
    click(x: number, y: number, opts?: MouseModifiers & SettleOption): Promise<void>;
    clickNode(selector: string, opts?: MouseModifiers & SettleOption & NodeClickOffset): Promise<void>;
    wheel(x: number, y: number, direction: "up" | "down" | "left" | "right"): Promise<void>;
    /** Capture and save `screenshots/<scenario>-<shot>.png`; returns the path. */
    capture(shot: string): Promise<string>;
    /** The terminal reports a light/dark flip (mode 2031), as when the OS switches appearance. */
    setHostColorScheme(scheme: "dark" | "light"): Promise<void>;
    /** After `workbench.action.reloadWindow` the process replaces itself; the inspector returns on the same port. */
    reconnect(): Promise<void>;
}

export interface ScenarioSpec {
    /** Kebab-case id; prefixes every screenshot file. */
    name: string;
    title?: string;
    /** Omitted: the scenario's workspace directory; empty array: no positional arguments (an empty window). */
    open?: string[];
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    /** Skips only in the CI safety net (`scenarios-<N>.test.ts`); screenshots are generated as usual. */
    skipOn?: readonly NodeJS.Platform[];
    /** A `.vsix` path or a marketplace id (told apart by suffix, as in the CLI); an id requires `network: true`. */
    installVsix?: readonly string[];
    /** Defaults to 300 s. */
    timeoutMs?: number;
    /** The CI safety net skips the scenario under `DIODE_E2E_OFFLINE=1`. */
    network?: boolean;
    /** The skip reason (in both the CI safety net and `npm run screenshots`), or `undefined` if the tool is present. */
    requires?(): string | undefined;
    settings?: Readonly<Record<string, unknown>>;
    /**
     * For running a command without moving focus: the command palette hands focus back to its previous owner,
     * while the menu bar route leaves it in the menu.
     */
    userKeybindings?: readonly { key: string; command: string; when?: string; args?: unknown }[];
    extraArgs?: readonly string[];
    seedUserData?: string;
    /** Called only when the scenario actually runs, so network setup does not hurt offline runs. */
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

/** `cwd` is repoRoot: scenarios open it by absolute paths, and the bundle and extensions sit next to it. */
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
        waitForState: (selector, predicate, opts) => session.waitForState(selector, predicate, opts),
        sendMouse: (params) => session.sendMouse(params),
        click: (x, y, opts) => session.click(x, y, opts),
        clickNode: (selector, opts) => session.clickNode(selector, opts),
        wheel: (x, y, direction) => session.wheel(x, y, direction),
        reconnect: () => session.reconnect(),
        setHostColorScheme: (scheme) => session.setHostColorScheme(scheme),
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

/** `filter` selects files before import: some scenarios prepare fixtures right at import (`mkdtempSync`). */
export async function loadScenarios(filter: (file: string, index: number) => boolean = () => true): Promise<ScenarioSpec[]> {
    return (await loadScenarioFiles(filter)).map(({ spec }) => spec);
}

export interface LoadedScenario {
    /** Absolute path of the `*.scenario.ts` file: test-flakes.json keys a scenario by it and `name`. */
    file: string;
    spec: ScenarioSpec;
}

/** Same as `loadScenarios`, with the file each scenario came from. */
export async function loadScenarioFiles(filter: (file: string, index: number) => boolean = () => true): Promise<LoadedScenario[]> {
    const files = scenarioFiles().filter(filter);
    const loaded: LoadedScenario[] = [];
    for (const file of files) {
        const path = resolve(scenariosDir, file);
        const mod = (await import(pathToFileURL(path).href)) as { default?: ScenarioSpec };
        if (mod.default !== undefined) loaded.push({ file: path, spec: mod.default });
    }
    return loaded;
}

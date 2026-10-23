import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { cliOk, defaultProfileFile, versionDirs } from "./helpers/extensionsDisk.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * ExtensionUpdates stage 3 as the user sees it (docs/TODO/ExtensionUpdates.md, "stage 3 spec"): the background
 * check after startup, auto-update with one notification, pinned entries and the publish delay, the page's
 * `Auto Update` toggle, offline and two windows. Hermetic registry of real `.vsix` files; the hours pass through
 * `Diode.advanceClock`, the editor's clock for long timers.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(here, "marketplace", "sample-extension");
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

/** 1.0.0 and 1.1.0, both published long ago. */
const A = "test.auto-a";
const B = "test.auto-b";
/** 1.0.0 long ago, 1.1.0 thirty minutes before the suite starts. */
const FRESH = "test.auto-fresh";

let root: string;
let registry: string;
let seeds = 0;

function pageId(id: string): string {
    return id.replaceAll(".", "-");
}

interface IEntry {
    identifier: { id: string };
    version: string;
    metadata?: { pinned?: boolean };
}

function readEntries(userDataDir: string): IEntry[] {
    return JSON.parse(readFileSync(defaultProfileFile(userDataDir), "utf8")) as IEntry[];
}

/** Entries of the test extensions as `id@version pinned=…`, sorted by id. */
function profile(app: HeadlessApp): string[] {
    return readEntries(app.env.userDataDir)
        .filter((e) => e.identifier.id.startsWith("test.auto-"))
        .map((e) => `${e.identifier.id}@${e.version} pinned=${String(e.metadata?.pinned ?? false)}`)
        .sort();
}

/**
 * A user data directory with `ids` at 1.0.0 as if installed from the marketplace earlier: the CLI pins a given
 * version, so the pin is taken off again unless `pinned` lists the id.
 */
async function seed(ids: readonly string[], pinned: readonly string[] = []): Promise<string> {
    const dir = join(root, `seed-${String(++seeds)}`);
    for (const id of ids) {
        await cliOk(["--user-data-dir", dir, "--registry", registry, "--install-extension", `${id}@1.0.0`]);
    }
    const entries = readEntries(dir).map((e) =>
        pinned.includes(e.identifier.id) ? e : { ...e, metadata: { ...e.metadata, pinned: false } },
    );
    writeFileSync(defaultProfileFile(dir), JSON.stringify(entries));
    return dir;
}

interface IStartOptions {
    readonly seedUserData: string;
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly registry?: string;
    readonly root?: string;
}

async function start(options: IStartOptions): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${options.registry ?? registry}`],
        ...(options.root === undefined ? { seedUserData: options.seedUserData } : { root: options.root, keepRoot: true }),
        settings: options.settings ?? {},
        cols: 120,
        rows: 32,
    });
    await app.session.waitForReady();
    return app;
}

function settingsFile(app: HeadlessApp): string {
    return join(app.env.userDataDir, "user-data", "User", "settings.json");
}

/** Like the user editing settings.json: the editor reloads it from disk. */
function writeSettings(app: HeadlessApp, settings: Readonly<Record<string, unknown>>): void {
    writeFileSync(settingsFile(app), JSON.stringify(settings, null, 2));
}

async function showViewlet(app: HeadlessApp): Promise<void> {
    await app.session.executeCommand("workbench.view.extensions");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
}

async function openPage(app: HeadlessApp, query: string, id: string): Promise<void> {
    await showViewlet(app);
    for (let i = 0; i < 20; i++) await app.session.key("Backspace");
    await app.session.text(query);
    await app.session.key("Tab");
    await app.session.key("ArrowDown");
    await app.session.key("Enter");
    await app.session.waitForNode(`#extensionPage-${pageId(id)}`);
}

async function pageButtons(app: HeadlessApp): Promise<{ label: string; enabled: boolean }[]> {
    const header = await app.session.node("#extensionPageHeader");
    const state = header?.state as { buttons?: { label: string; enabled: boolean }[] } | undefined;
    return state?.buttons ?? [];
}

async function waitForButtons(app: HeadlessApp, predicate: (labels: string[]) => boolean): Promise<string[]> {
    let labels: string[] = [];
    await vi.waitFor(
        async () => {
            labels = (await pageButtons(app)).map((b) => b.label);
            expect(predicate(labels)).toBe(true);
        },
        { timeout: 10_000, interval: 100 },
    );
    return labels;
}

/** Focus moves from the first button to the one labeled `label`. */
async function pressButton(app: HeadlessApp, label: string): Promise<void> {
    const index = (await pageButtons(app)).findIndex((b) => b.label === label);
    expect(index).toBeGreaterThanOrEqual(0);
    await app.session.executeCommand("workbench.action.focusActiveEditorGroup");
    for (let i = 0; i < index; i++) await app.session.key("ArrowRight");
    await app.session.key("Enter");
}

async function rowText(app: HeadlessApp, id: string): Promise<string | null> {
    const row = await app.session.node(`#extensionsGroup-installed-${pageId(id)}`);
    return row?.text ?? null;
}

async function waitForRow(app: HeadlessApp, id: string, expected: RegExp): Promise<void> {
    await vi.waitFor(
        async () => {
            expect(await rowText(app, id)).toMatch(expected);
        },
        { timeout: 10_000, interval: 100 },
    );
}

async function screen(app: HeadlessApp): Promise<string> {
    return frameToText(await app.session.captureFrame());
}

async function waitForScreen(app: HeadlessApp, needle: string): Promise<string> {
    return frameToText(await app.session.waitForText((t) => t.includes(needle)));
}

async function hasOutdated(app: HeadlessApp): Promise<unknown> {
    return app.session.getContextKey("hasOutdatedExtensions");
}

async function waitForOutdated(app: HeadlessApp, expected: boolean): Promise<void> {
    await vi.waitFor(
        async () => {
            expect(await hasOutdated(app)).toBe(expected);
        },
        { timeout: 10_000, interval: 100 },
    );
}

/** The first background check is 10 s after the `eventually` phase, which `waitForReady` waits for. */
async function passFirstCheckDelay(app: HeadlessApp): Promise<void> {
    await app.session.advanceClock(10 * SECOND);
}

/** The toast wraps the rest: "Reload the window to apply." */
const UPDATED_TWO = "Updated 2 extensions.";
const UPDATED_ONE = "Updated 1 extension.";

describe("Extension auto-update (ExtensionUpdates stage 3, functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-auto-update-"));
        const longAgo = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
        const recently = new Date(Date.now() - 0.5 * HOUR).toISOString();
        registry = await createRegistryFixture(join(root, "registry"), [
            ...[A, B].flatMap((id) =>
                ["1.0.0", "1.1.0"].map((version) => ({
                    id,
                    version,
                    sourceDir: SAMPLE,
                    displayName: id === A ? "Auto A" : "Auto B",
                    publishedAt: longAgo,
                })),
            ),
            { id: FRESH, version: "1.0.0", sourceDir: SAMPLE, displayName: "Auto Fresh", publishedAt: longAgo },
            { id: FRESH, version: "1.1.0", sourceDir: SAMPLE, displayName: "Auto Fresh", publishedAt: recently },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(root);
    });

    it("US-3.1/US-3.4: after the startup delay both are updated, with one notification and without a reload", async () => {
        const app = await start({ seedUserData: await seed([A, B]) });
        // Startup does not go to the network: nothing is known to be outdated yet.
        expect(await hasOutdated(app)).toBe(false);
        expect(profile(app)).toEqual([`${A}@1.0.0 pinned=false`, `${B}@1.0.0 pinned=false`]);

        await passFirstCheckDelay(app);
        const text = await waitForScreen(app, UPDATED_TWO);

        expect(text).toContain("Reload the window to");
        expect(text).toContain("[ Reload Window ]");
        expect(profile(app)).toEqual([`${A}@1.1.0 pinned=false`, `${B}@1.1.0 pinned=false`]);
        // Stage 0: the running host keeps the old directories until the next start.
        expect(versionDirs(app.env.userDataDir, A)).toEqual([`${A}-1.0.0`, `${A}-1.1.0`]);
        expect(versionDirs(app.env.userDataDir, B)).toEqual([`${B}-1.0.0`, `${B}-1.1.0`]);
        await showViewlet(app);
        await waitForRow(app, A, /Reload$/u);
        await waitForRow(app, B, /Reload$/u);
        // One notification for the batch, not one per extension.
        expect((await screen(app)).split(UPDATED_TWO)).toHaveLength(2);
    });

    it("US-3.1: with auto-update off the check only marks the outdated ones; the viewlet reuses its catalog", async () => {
        const app = await start({ seedUserData: await seed([A]), settings: { "extensions.autoUpdate": "off" } });

        await passFirstCheckDelay(app);
        await waitForOutdated(app, true);

        // `Update All` in the `⋯` menu is enabled (`hasOutdatedExtensions`) without showing the viewlet.
        expect(profile(app)).toEqual([`${A}@1.0.0 pinned=false`]);
        await showViewlet(app);
        await waitForRow(app, A, /Update 1\.1\.0$/u);
    });

    it("US-3.2: `autoCheckUpdates: false` never checks; turning it on checks right away", async () => {
        const settings = { "extensions.autoCheckUpdates": false, "extensions.autoUpdate": "off" };
        const app = await start({ seedUserData: await seed([A]), settings });

        await passFirstCheckDelay(app);
        await app.session.advanceClock(13 * HOUR);
        // Give a wrongly fired check the time to land.
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        expect(await hasOutdated(app)).toBe(false);

        writeSettings(app, { ...settings, "extensions.autoCheckUpdates": true });

        await waitForOutdated(app, true);
    });

    it("US-3.3: the next check is 12 hours after the last one", async () => {
        const reg = join(root, "registry-12h");
        cpSync(registry, reg, { recursive: true });
        // The suite's registry before the 1.1.0 releases: the first check finds nothing.
        const index = JSON.parse(readFileSync(join(reg, "index.json"), "utf8")) as {
            extensions: { id: string; latest: { version: string } }[];
        };
        const full = JSON.stringify(index);
        for (const entry of index.extensions) entry.latest = { ...entry.latest, version: "1.0.0" };
        writeFileSync(join(reg, "index.json"), JSON.stringify(index));
        const app = await start({ seedUserData: await seed([A]), registry: reg, settings: { "extensions.autoUpdate": "off" } });
        await passFirstCheckDelay(app);
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        expect(await hasOutdated(app)).toBe(false);

        // The publisher releases 1.1.0.
        writeFileSync(join(reg, "index.json"), full);
        await app.session.advanceClock(12 * HOUR - 60 * SECOND);
        await new Promise((resolveWait) => setTimeout(resolveWait, 500));
        expect(await hasOutdated(app)).toBe(false);
        await app.session.advanceClock(60 * SECOND);

        await waitForOutdated(app, true);
    });

    it("US-3.5: a pinned one is left alone; Update All still updates it", async () => {
        const app = await start({ seedUserData: await seed([A, B], [A]) });

        await passFirstCheckDelay(app);
        await waitForScreen(app, UPDATED_ONE);

        expect(profile(app)).toEqual([`${A}@1.0.0 pinned=true`, `${B}@1.1.0 pinned=false`]);
        await showViewlet(app);
        await waitForRow(app, A, /Update 1\.1\.0$/u);

        await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");
        await waitForScreen(app, "Updated 1 extension.");
        // Decision E1: Update All keeps the pin.
        expect(profile(app)).toEqual([`${A}@1.1.0 pinned=true`, `${B}@1.1.0 pinned=false`]);
    });

    it("US-3.6: a version published 30 min ago waits for the 2-hour delay, then is installed", async () => {
        const app = await start({ seedUserData: await seed([FRESH]) });

        await passFirstCheckDelay(app);
        await waitForOutdated(app, true);
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=false`]);
        await showViewlet(app);
        await waitForRow(app, FRESH, /Update 1\.1\.0$/u);

        await app.session.advanceClock(1.5 * HOUR);

        await waitForScreen(app, UPDATED_ONE);
        expect(profile(app)).toEqual([`${FRESH}@1.1.0 pinned=false`]);
    });

    it("US-3.6: `autoUpdateDelay: 0` installs a fresh version right away", async () => {
        const app = await start({ seedUserData: await seed([FRESH]), settings: { "extensions.autoUpdateDelay": 0 } });

        await passFirstCheckDelay(app);

        await waitForScreen(app, UPDATED_ONE);
        expect(profile(app)).toEqual([`${FRESH}@1.1.0 pinned=false`]);
    });

    it("US-3.7/US-3.8: the page toggle — check to auto-update now, uncheck to pin; off in settings disables it", async () => {
        const app = await start({
            seedUserData: await seed([A], [A]),
            settings: { "extensions.autoCheckUpdates": false },
        });
        await openPage(app, "auto a", A);
        expect(await waitForButtons(app, (labels) => labels.includes("[ ] Auto Update"))).toEqual([
            "Update to 1.1.0",
            "Install Specific Version...",
            "Uninstall",
            "[ ] Auto Update",
        ]);

        // Checked: unpinned, and the update goes in by itself (upstream updateAutoUpdateEnablementFor).
        await pressButton(app, "[ ] Auto Update");
        await waitForScreen(app, UPDATED_ONE);
        expect(profile(app)).toEqual([`${A}@1.1.0 pinned=false`]);
        await waitForButtons(app, (labels) => labels.at(-1) === "[x] Auto Update");

        // Unchecked: pinned at the current version, nothing installed.
        await pressButton(app, "[x] Auto Update");
        await waitForButtons(app, (labels) => labels.at(-1) === "[ ] Auto Update");
        expect(profile(app)).toEqual([`${A}@1.1.0 pinned=true`]);

        writeSettings(app, { "extensions.autoCheckUpdates": false, "extensions.autoUpdate": "off" });
        await waitForButtons(app, (labels) => labels.at(-1) === "[ ] Auto Update (extensions.autoUpdate is off)");
        expect((await pageButtons(app)).at(-1)?.enabled).toBe(false);
    });

    it("US-3.9: auto-update turned off while waiting installs nothing; on again installs at once", async () => {
        const app = await start({ seedUserData: await seed([FRESH]) });
        await passFirstCheckDelay(app);
        await waitForOutdated(app, true);

        writeSettings(app, { "extensions.autoUpdate": "off" });
        await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
        await app.session.advanceClock(3 * HOUR);
        await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
        expect(profile(app)).toEqual([`${FRESH}@1.0.0 pinned=false`]);

        writeSettings(app, { "extensions.autoUpdate": "on" });

        await waitForScreen(app, UPDATED_ONE);
        expect(profile(app)).toEqual([`${FRESH}@1.1.0 pinned=false`]);
    });

    it("US-3.10: offline the background check is silent: no toast, no Retry row, a warning in the log", async () => {
        const reg = join(root, "registry-offline");
        cpSync(registry, reg, { recursive: true });
        const app = await start({ seedUserData: await seed([A]), registry: reg, settings: { "extensions.autoUpdate": "off" } });
        await showViewlet(app);
        await waitForRow(app, A, /Update 1\.1\.0$/u);
        renameSync(reg, `${reg}-gone`);

        await app.session.advanceClock(12 * HOUR + 10 * SECOND);
        await vi.waitFor(
            async () => {
                expect(await app.session.getOutput("Extensions")).toContain("Could not check for extension updates:");
            },
            { timeout: 10_000, interval: 100 },
        );

        const text = await screen(app);
        expect(text).not.toContain("Retry");
        expect(text).not.toContain("Could not check for extension updates");
        expect(await rowText(app, A)).toMatch(/Update 1\.1\.0$/u);
    });

    it("US-3.12: two windows over one profile — one entry per id, the second window installs nothing again", async () => {
        const first = await start({ seedUserData: await seed([A]) });
        const second = await start({ seedUserData: "", root: first.env.root });

        await passFirstCheckDelay(first);
        await waitForScreen(first, UPDATED_ONE);
        await passFirstCheckDelay(second);
        await new Promise((resolveWait) => setTimeout(resolveWait, 2000));

        expect(await screen(second)).not.toContain("Updated");
        expect(readEntries(first.env.userDataDir).filter((e) => e.identifier.id === A)).toHaveLength(1);
        expect(profile(first)).toEqual([`${A}@1.1.0 pinned=false`]);
        expect(existsSync(join(first.env.userDataDir, "extensions", `${A}-1.1.0`))).toBe(true);
    });
});

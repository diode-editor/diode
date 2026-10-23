import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell, frameLine, frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * ExtensionUpdates stage 2 as the user sees it: the target is the highest COMPATIBLE version (not the index's
 * latest), `Extensions: Check for Extension Updates` puts `@outdated` into the viewlet search, `Extensions: Update
 * All Extensions` updates the batch with one summary and one `Reload Window`. Hermetic registry (`--registry`),
 * real `.vsix` from pack-vsix; the registry is edited on disk mid-session, like a publisher releasing a version.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = resolve(here, "marketplace", "sample-extension");
/** 1.0.0, 1.1.0 and the index's latest 2.0.0, incompatible with any build. */
const PINNED = "test.upd-pinned";
/** 1.0.0 and 1.1.0; installed from the marketplace, so not pinned. */
const PLAIN = "test.upd-plain";
/** Not installed: 1.1.0 and an incompatible latest 2.0.0. */
const FRESH = "test.upd-fresh";
/** Only incompatible versions. */
const TOO_NEW = "test.upd-too-new";

const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

let registryRoot: string;
/** The full registry: what `restoreRegistry` brings back. */
let registry: string;
let fullIndex: string;
const fullMeta = new Map<string, string>();

function pageId(id: string): string {
    return id.replaceAll(".", "-");
}

/** The registry before the 1.1.0 releases of the two installed extensions: their 1.0.0 is the newest compatible. */
function hideNewReleases(): void {
    const index = JSON.parse(fullIndex) as { extensions: { id: string; latest: { version: string } }[] };
    const plain = index.extensions.find((e) => e.id === PLAIN)!;
    plain.latest = { ...plain.latest, version: "1.0.0" };
    writeFileSync(join(registry, "index.json"), JSON.stringify(index));
    for (const id of [PINNED, PLAIN]) {
        const meta = JSON.parse(fullMeta.get(id)!) as { versions: { version: string }[] };
        meta.versions = meta.versions.filter((v) => v.version !== "1.1.0");
        writeFileSync(join(registry, "meta", `${id}.json`), JSON.stringify(meta));
    }
}

function restoreRegistry(): void {
    writeFileSync(join(registry, "index.json"), fullIndex);
    for (const [id, meta] of fullMeta) writeFileSync(join(registry, "meta", `${id}.json`), meta);
}

async function openExtensions(options: { installVsix?: string[]; registry?: string } = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${options.registry ?? registry}`],
        keybindings: KEYS,
        installVsix: options.installVsix ?? [],
        cols: 120,
        rows: 32,
    });
    await app.session.waitForReady();
    return app;
}

async function showViewlet(app: HeadlessApp): Promise<void> {
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
}

/** Showing the viewlet focuses its search box; the previous query is erased first. */
async function openPage(app: HeadlessApp, query: string, id: string): Promise<void> {
    await showViewlet(app);
    for (let i = 0; i < 12; i++) await app.session.key("Backspace");
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

async function pressButton(app: HeadlessApp, label: string): Promise<void> {
    const index = (await pageButtons(app)).findIndex((b) => b.label === label);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) await app.session.key("ArrowRight");
    await app.session.key("Enter");
}

async function runPaletteCommand(app: HeadlessApp, title: string): Promise<void> {
    await app.session.key("F1");
    await app.session.waitForNode("#quickInput");
    await app.session.text(title.replace("Extensions: ", ""));
    await app.session.waitForText((t) => t.includes(title));
    await app.session.key("Enter");
}

function vsix(id: string, version: string): string {
    return join(registry, "artifacts", `${id}-${version}.vsix`);
}

/** Profile entries of the test extensions as `id version pinned`. */
function profileEntries(app: HeadlessApp): string[] {
    const file = join(app.env.userDataDir, "extensions", "extensions.json");
    const entries = JSON.parse(readFileSync(file, "utf8")) as {
        identifier: { id: string };
        version: string;
        metadata?: { pinned?: boolean };
    }[];
    return entries
        .filter((e) => e.identifier.id.startsWith("test.upd-"))
        .map((e) => `${e.identifier.id} ${e.version} pinned=${String(e.metadata?.pinned ?? false)}`)
        .sort();
}

function versionDirs(app: HeadlessApp): string[] {
    const dir = join(app.env.userDataDir, "extensions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("test.upd-"))
        .map((entry) => entry.name)
        .sort();
}

/** A list row's whole text: the sidebar is narrower than a row with its badge. */
async function rowText(app: HeadlessApp, section: "marketplace" | "installed", id: string): Promise<string> {
    const row = await app.session.node(`#extensionsGroup-${section}-${pageId(id)}`);
    return row?.text ?? "";
}

async function waitForRow(
    app: HeadlessApp,
    section: "marketplace" | "installed",
    id: string,
    expected: RegExp,
): Promise<void> {
    await vi.waitFor(
        async () => {
            expect(await rowText(app, section, id)).toMatch(expected);
        },
        { timeout: 10_000, interval: 100 },
    );
}

async function waitForScreen(app: HeadlessApp, needle: string): Promise<string> {
    return frameToText(await app.session.waitForText((t) => t.includes(needle)));
}

describe("Manual extension updates (ExtensionUpdates stage 2, functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        registryRoot = mkdtempSync(join(tmpdir(), "diode-update-all-"));
        const versions = (id: string, displayName: string, list: [string, boolean][]) =>
            list.map(([version, compatible]) => ({
                id,
                version,
                sourceDir: SOURCE,
                displayName,
                ...(compatible ? {} : { engines: { vscode: "^99.0.0" } }),
            }));
        // The last declared version of an id is the index's latest.
        registry = await createRegistryFixture(join(registryRoot, "registry"), [
            ...versions(PINNED, "Upd Pinned", [
                ["1.0.0", true],
                ["1.1.0", true],
                ["2.0.0", false],
            ]),
            ...versions(PLAIN, "Upd Plain", [
                ["1.0.0", true],
                ["1.1.0", true],
            ]),
            ...versions(FRESH, "Upd Fresh", [
                ["1.1.0", true],
                ["2.0.0", false],
            ]),
            ...versions(TOO_NEW, "Upd Too New", [["3.0.0", false]]),
        ]);
        fullIndex = readFileSync(join(registry, "index.json"), "utf8");
        for (const id of [PINNED, PLAIN]) fullMeta.set(id, readFileSync(join(registry, "meta", `${id}.json`), "utf8"));
    }, 300_000);

    afterAll(() => {
        removeTempDir(registryRoot);
    });

    it("US-2.1/US-2.2: an incompatible latest still offers the newest compatible version — to update and to install", async () => {
        restoreRegistry();
        const app = await openExtensions({ installVsix: [vsix(PINNED, "1.0.0")] });
        await showViewlet(app);
        await waitForRow(app, "installed", PINNED, /^Upd Pinned {2}1\.0\.0 {2}Update 1\.1\.0$/u);
        // Not installed with a compatible older version: no badge; nothing compatible at all: Incompatible.
        expect(await rowText(app, "marketplace", FRESH)).toBe("Upd Fresh  1.1.0");
        expect(await rowText(app, "marketplace", TOO_NEW)).toBe("Upd Too New  3.0.0  Incompatible");

        await openPage(app, "fresh", FRESH);
        expect((await pageButtons(app)).find((b) => b.label === "Install")).toEqual({ label: "Install", enabled: true });
        await pressButton(app, "Install");
        await waitForScreen(app, "Installed 1.1.0");

        await openPage(app, "pinned", PINNED);
        await pressButton(app, "Update to 1.1.0");
        await waitForScreen(app, "Installed 1.1.0");
        expect(profileEntries(app)).toEqual([`${FRESH} 1.1.0 pinned=false`, `${PINNED} 1.1.0 pinned=true`]);
    });

    it("US-2.4/US-2.6–2.8: up to date, then a release, @outdated, Update All with one summary and one reload", async () => {
        hideNewReleases();
        const app = await openExtensions({ installVsix: [vsix(PINNED, "1.0.0")] });
        await openPage(app, "plain", PLAIN);
        await pressButton(app, "Install");
        await waitForScreen(app, "Installed 1.0.0");

        await runPaletteCommand(app, "Extensions: Check for Extension Updates");
        await waitForScreen(app, "All extensions are up to date.");
        await app.session.key("Enter");
        await app.session.waitForText((t) => !t.includes("All extensions are up to date."));

        // The publisher releases 1.1.0 of both: Check for Updates re-reads the index and the metadata.
        restoreRegistry();
        await runPaletteCommand(app, "Extensions: Check for Extension Updates");
        await waitForScreen(app, "@outdated");
        await waitForRow(app, "installed", PINNED, /Update 1\.1\.0$/u);
        // Installed in this session, so its badge is Reload (it beats Update); being listed is what says outdated.
        await waitForRow(app, "installed", PLAIN, /^Upd Plain {2}1\.0\.0 {2}Reload$/u);
        const outdated = await waitForScreen(app, "INSTALLED");
        expect(outdated).not.toContain("MARKETPLACE");
        expect(outdated).not.toContain("Upd Fresh");

        // Both commands are in the section's "⋯" menu, in the updates group.
        const frame = await app.session.captureFrame();
        let menu: { x: number; y: number } | null = null;
        for (let y = 0; y < frame.rows && menu === null; y++) {
            const line = frameLine(frame, y);
            if (line.includes("EXTENSIONS") && line.includes("⋯")) menu = { x: line.indexOf("⋯"), y };
        }
        expect(menu).not.toBeNull();
        await app.session.click(menu!.x, menu!.y);
        const popup = await waitForScreen(app, "Update All Extensions");
        expect(popup).toContain("Check for Extension Updates");
        await app.session.key("Escape");
        await app.session.waitForText((t) => !t.includes("Update All Extensions"));

        await runPaletteCommand(app, "Extensions: Update All Extensions");
        // The toast wraps the text: one line is enough to know it is the batch summary.
        await waitForScreen(app, "Updated 2 extensions. Reload the window to");
        // Nothing is outdated any more; without the filter the updated rows wait for the reload.
        await waitForScreen(app, "No extensions found");
        await app.session.click(1, 2);
        await app.session.key("End");
        for (let i = 0; i < 12; i++) await app.session.key("Backspace");
        await waitForRow(app, "installed", PINNED, /^Upd Pinned {2}1\.1\.0 {2}Reload$/u);
        await waitForRow(app, "installed", PLAIN, /^Upd Plain {2}1\.1\.0 {2}Reload$/u);
        expect(profileEntries(app)).toEqual([`${PINNED} 1.1.0 pinned=true`, `${PLAIN} 1.1.0 pinned=false`]);

        const reload = findTextCell(await app.session.captureFrame(), "Reload Window");
        expect(reload).not.toBeNull();
        // The reply to this input may never arrive: the window restarts along with the socket.
        await app.session.click(reload!.x + 1, reload!.y).catch(() => undefined);
        await app.session.reconnect();
        await app.session.waitForReady();

        expect(versionDirs(app)).toEqual([`${PINNED}-1.1.0`, `${PLAIN}-1.1.0`]);
        await showViewlet(app);
        await waitForRow(app, "installed", PINNED, /^Upd Pinned {2}1\.1\.0 {2}Installed$/u);
        await waitForRow(app, "installed", PLAIN, /^Upd Plain {2}1\.1\.0 {2}Installed$/u);
    });

    it("US-2.4: an unreachable registry is an error, not 'up to date'", async () => {
        const app = await openExtensions({
            installVsix: [vsix(PLAIN, "1.0.0")],
            registry: join(registryRoot, "missing"),
        });

        await runPaletteCommand(app, "Extensions: Check for Extension Updates");

        await waitForScreen(app, "Could not check for extension updates:");
        const screen = await waitForScreen(app, "Retry —");
        expect(screen).not.toContain("All extensions are up to date.");
    });

    it("US-2.9: before the catalog is read Update All does nothing; Check for Updates reads it itself", async () => {
        restoreRegistry();
        const app = await openExtensions({ installVsix: [vsix(PLAIN, "1.0.0")] });

        await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");
        await runPaletteCommand(app, "Extensions: Check for Extension Updates");

        await waitForScreen(app, "@outdated");
        await waitForRow(app, "installed", PLAIN, /Update 1\.1\.0$/u);
        expect(profileEntries(app)).toEqual([`${PLAIN} 1.0.0 pinned=true`]);
    });
});

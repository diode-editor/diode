import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { currentTargetPlatform } from "../src/vs/platform/extensionManagement/node/targetPlatform.ts";
import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import {
    cliOk,
    createNamedProfile,
    defaultProfileFile,
    namedProfileFile,
    obsoleteKeys,
    versionDirs,
} from "./helpers/extensionsDisk.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Acceptance tests for ExtensionUpdates stage 2 in the window (the "stage 2 spec" of the closed tracker,
 * `git show 188ea93e:docs/TODO/ExtensionUpdates.md`): the edge cases the implementer's
 * `extensionsUpdateAll.functional.test.ts` leaves out — a registry that goes away, a platform-only release, a newer
 * `.vsix`, `@OUTDATED` with text, a partial failure, dependencies, profile B and a double `Update All`. A comment "QA
 * report #N" names the bug of PR #792 the test caught (fixed in the same PR).
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(here, "marketplace", "sample-extension");
/** `extensionDependencies: ["test.sample-lang"]`. */
const DEPENDENT = resolve(here, "marketplace", "dependent-extension");

/** 1.0.0, 1.1.0 and an incompatible latest 2.0.0: the target is in the metadata. */
const META = "test.qa2-meta";
/** 1.0.0 and 1.1.0. */
const PLAIN = "test.qa2-plain";
/** 1.0.0 and 1.1.0 with a wrong sha256. */
const BROKEN = "test.qa2-broken";
/** 1.0.0 and 1.1.0; the per-test copy makes 1.1.0 a record of another platform. */
const PLATFORM = "test.qa2-platform";
const DEP = "test.sample-lang";
const ROOT = "test.lang-pack";

let root: string;
let registry: string;
let copies = 0;

function pageId(id: string): string {
    return id.replaceAll(".", "-");
}

/** A registry of its own for a test that edits it. */
function copyRegistry(): string {
    const dir = join(root, `registry-${String(++copies)}`);
    cpSync(registry, dir, { recursive: true });
    return dir;
}

function readJson<T>(file: string): T {
    return JSON.parse(readFileSync(file, "utf8")) as T;
}

interface IIndexEntry {
    id: string;
    latest: { version: string; engines: Record<string, string> };
}

interface IMeta {
    versions: { version: string; targetPlatform?: string }[];
}

/** The registry before `version` of `id` was released: gone from the index and the metadata. */
function unpublish(registryDir: string, id: string, version: string, newLatest: string): void {
    const indexFile = join(registryDir, "index.json");
    const index = readJson<{ extensions: IIndexEntry[] }>(indexFile);
    const entry = index.extensions.find((e) => e.id === id)!;
    entry.latest = { ...entry.latest, version: newLatest };
    writeFileSync(indexFile, JSON.stringify(index));
    const metaFile = join(registryDir, "meta", `${id}.json`);
    const meta = readJson<IMeta>(metaFile);
    meta.versions = meta.versions.filter((v) => v.version !== version);
    writeFileSync(metaFile, JSON.stringify(meta));
}

function artifact(id: string, version: string): string {
    return join(registry, "artifacts", `${id}-${version}.vsix`);
}

interface IStartOptions {
    readonly registry?: string;
    readonly installVsix?: string[];
    readonly seedUserData?: string;
    readonly extraArgs?: string[];
}

async function start(options: IStartOptions = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${options.registry ?? registry}`, ...(options.extraArgs ?? [])],
        installVsix: options.installVsix ?? [],
        ...(options.seedUserData === undefined ? {} : { seedUserData: options.seedUserData }),
        cols: 120,
        rows: 32,
    });
    await app.session.waitForReady();
    return app;
}

/** The command, not a key: a named profile has keybindings of its own. */
async function showViewlet(app: HeadlessApp): Promise<void> {
    await app.session.executeCommand("workbench.view.extensions");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
}

/** Showing the viewlet focuses its search box; the previous query is erased first. */
async function search(app: HeadlessApp, query: string): Promise<void> {
    await showViewlet(app);
    for (let i = 0; i < 20; i++) await app.session.key("Backspace");
    await app.session.text(query);
}

async function openPage(app: HeadlessApp, query: string, id: string): Promise<void> {
    await search(app, query);
    await app.session.key("Tab");
    await app.session.key("ArrowDown");
    await app.session.key("Enter");
    await app.session.waitForNode(`#extensionPage-${pageId(id)}`);
}

async function pageButtons(app: HeadlessApp): Promise<string[]> {
    const header = await app.session.node("#extensionPageHeader");
    const state = header?.state as { buttons?: { label: string }[] } | undefined;
    return (state?.buttons ?? []).map((b) => b.label);
}

async function pressButton(app: HeadlessApp, label: string): Promise<void> {
    const index = (await pageButtons(app)).indexOf(label);
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

async function rowText(app: HeadlessApp, section: "marketplace" | "installed", id: string): Promise<string | null> {
    const row = await app.session.node(`#extensionsGroup-${section}-${pageId(id)}`);
    return row?.text ?? null;
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

async function screen(app: HeadlessApp): Promise<string> {
    return frameToText(await app.session.captureFrame());
}

/**
 * The toast that starts with `head`, as one line: the frame wraps a long message. Only the columns right of the
 * toast's left border, so the sidebar on the same rows does not interleave.
 */
async function toastText(app: HeadlessApp, head: string): Promise<string> {
    const lines = (await waitForScreen(app, head)).split("\n");
    const first = lines.findIndex((line) => line.includes(head));
    const border = lines[first]!.lastIndexOf("│", lines[first]!.indexOf(head));
    return lines
        .slice(first)
        .map((line) => line.slice(border + 1).replace(/│\s*$/u, ""))
        .join(" ")
        .replace(/\s+/gu, " ");
}

async function waitForScreen(app: HeadlessApp, needle: string): Promise<string> {
    return frameToText(await app.session.waitForText((t) => t.includes(needle)));
}

interface IEntry {
    identifier: { id: string };
    version: string;
    metadata?: { pinned?: boolean };
}

/** Entries of the test extensions as `id@version pinned=…`, sorted by id. */
function describeProfile(file: string): string[] {
    if (!existsSync(file)) return [];
    return readJson<IEntry[]>(file)
        .filter((e) => e.identifier.id.startsWith("test."))
        .map((e) => `${e.identifier.id}@${e.version} pinned=${String(e.metadata?.pinned ?? false)}`)
        .sort();
}

describe("Manual extension updates edge cases (ExtensionUpdates stage 2 QA, functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-stage2-qa-"));
        const versions = (id: string, displayName: string, list: [string, "ok" | "incompatible" | "corrupt"][]) =>
            list.map(([version, kind]) => ({
                id,
                version,
                sourceDir: id === ROOT ? DEPENDENT : SAMPLE,
                displayName,
                ...(kind === "incompatible" ? { engines: { vscode: "^99.0.0" } } : {}),
                ...(kind === "corrupt" ? { corruptSha: true } : {}),
            }));
        // The last declared version of an id is the index's latest.
        registry = await createRegistryFixture(join(root, "registry"), [
            ...versions(META, "Qa Meta", [
                ["1.0.0", "ok"],
                ["1.1.0", "ok"],
                ["2.0.0", "incompatible"],
            ]),
            ...versions(PLAIN, "Qa Plain", [
                ["1.0.0", "ok"],
                ["1.1.0", "ok"],
            ]),
            ...versions(BROKEN, "Qa Broken", [
                ["1.0.0", "ok"],
                ["1.1.0", "corrupt"],
            ]),
            ...versions(PLATFORM, "Qa Platform", [
                ["1.0.0", "ok"],
                ["1.1.0", "ok"],
            ]),
            ...versions(DEP, "Sample Lang", [
                ["1.0.0", "ok"],
                ["1.1.0", "ok"],
            ]),
            ...versions(ROOT, "Lang Pack", [
                ["1.0.0", "ok"],
                ["1.1.0", "ok"],
            ]),
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(root);
    });

    // QA report #1 (fixed): `checkForUpdates` cleared the metadata cache BEFORE reading the index. When the read failed,
    // the previous index was kept (like Refresh) but its targets were recomputed without metadata: every entry whose
    // latest is incompatible turned `Incompatible`, left `@outdated`, and `hasOutdatedExtensions` went false.
    it("US-2.4: Check for Updates with the registry gone keeps the last list — the outdated row stays outdated", async () => {
        const dir = copyRegistry();
        const app = await start({ registry: dir, installVsix: [artifact(META, "1.0.0")] });
        await showViewlet(app);
        await waitForRow(app, "installed", META, /^Qa Meta {2}1\.0\.0 {2}Update 1\.1\.0$/u);

        renameSync(dir, `${dir}-gone`);
        await runPaletteCommand(app, "Extensions: Check for Extension Updates");
        await waitForScreen(app, "Could not check for extension updates:");

        // The stale list, as after a failed Refresh: the reason is on the `Retry —` row, the rows are as they were.
        expect(await rowText(app, "installed", META)).toMatch(/^Qa Meta {2}1\.0\.0 {2}Update 1\.1\.0$/u);
        // Update All stays available: it is enabled by the last loaded catalog (US-2.6). It runs and, with the
        // registry gone, reports the failure in its summary.
        await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");
        await waitForScreen(app, "Updated 0 of 1 extensions. Failed:");
    });

    // QA report #2 (fixed): the target was the index's latest whenever its `engines` fit, but the index knows no
    // platform. A release published only for another platform was then "outdated" forever: Update All reinstalled the
    // old version (`installFromRegistry` resolves by platform) and said `Updated 1 extension.`.
    it("US-2.1/US-2.6: a newer version for another platform only is not an update on this host", async () => {
        const dir = copyRegistry();
        const foreign = currentTargetPlatform() === "win32-arm64" ? "darwin-x64" : "win32-arm64";
        const metaFile = join(dir, "meta", `${PLATFORM}.json`);
        const meta = readJson<IMeta>(metaFile);
        meta.versions = meta.versions.map((v) => (v.version === "1.1.0" ? { ...v, targetPlatform: foreign } : v));
        writeFileSync(metaFile, JSON.stringify(meta));
        const app = await start({ registry: dir, installVsix: [artifact(PLATFORM, "1.0.0")] });

        await showViewlet(app);
        await waitForRow(app, "installed", PLATFORM, /^Qa Platform {2}1\.0\.0/u);
        expect(await rowText(app, "installed", PLATFORM)).toBe("Qa Platform  1.0.0  Installed");
        await runPaletteCommand(app, "Extensions: Check for Extension Updates");
        await waitForScreen(app, "All extensions are up to date.");
    });

    it("US-2.3: a `.vsix` newer than the registry is not outdated — no badge, no button, Check says up to date", async () => {
        const dir = copyRegistry();
        unpublish(dir, PLAIN, "1.1.0", "1.0.0");
        const app = await start({ registry: dir, installVsix: [artifact(PLAIN, "1.1.0")] });

        await showViewlet(app);
        await waitForRow(app, "installed", PLAIN, /^Qa Plain {2}1\.1\.0 {2}Installed$/u);
        await openPage(app, "qa2-plain", PLAIN);
        expect((await pageButtons(app)).filter((b) => b.startsWith("Update"))).toEqual([]);
        expect(await screen(app)).not.toContain("update available");

        await runPaletteCommand(app, "Extensions: Check for Extension Updates");
        await waitForScreen(app, "All extensions are up to date.");
        // Enter presses the modal's OK (the fix in this PR).
        await app.session.key("Enter");
        await app.session.waitForText((t) => !t.includes("All extensions are up to date."));
    });

    it("US-2.5: `@OUTDATED` in any case with text after it filters within the outdated ones", async () => {
        const app = await start({ installVsix: [artifact(META, "1.0.0"), artifact(PLAIN, "1.0.0")] });
        await showViewlet(app);
        await waitForRow(app, "installed", PLAIN, /Update 1\.1\.0$/u);

        await search(app, "@OUTDATED plain");
        await vi.waitFor(async () => {
            expect(await rowText(app, "installed", META)).toBeNull();
        });
        expect(await rowText(app, "installed", PLAIN)).toMatch(/Update 1\.1\.0$/u);
        expect(await screen(app)).not.toContain("MARKETPLACE");

        // Text before the filter works the same.
        await search(app, "meta @Outdated");
        await waitForRow(app, "installed", META, /Update 1\.1\.0$/u);
        expect(await rowText(app, "installed", PLAIN)).toBeNull();
    });

    it("US-2.5: without a catalog `@outdated` is empty, not every installed extension", async () => {
        const app = await start({ registry: join(root, "missing"), installVsix: [artifact(PLAIN, "1.0.0")] });
        await showViewlet(app);
        await waitForScreen(app, "Retry —");
        // No catalog: the row is the manifest's (its display name), like a sideloaded one.
        await waitForRow(app, "installed", PLAIN, / 1\.0\.0 {2}Installed$/u);

        await search(app, "@outdated");
        await vi.waitFor(async () => {
            expect(await rowText(app, "installed", PLAIN)).toBeNull();
        });
    });

    it("US-2.6/US-2.7: a partial failure — one summary with the reason, Reload Window, the rest updated; again — only the failed one", async () => {
        const app = await start({ installVsix: [artifact(BROKEN, "1.0.0"), artifact(PLAIN, "1.0.0")] });
        await showViewlet(app);
        await waitForRow(app, "installed", BROKEN, /Update 1\.1\.0$/u);

        await runPaletteCommand(app, "Extensions: Update All Extensions");
        const summary = await toastText(app, "Updated 1 of 2 extensions.");
        expect(summary).toContain(`Failed: ${BROKEN} — sha256 mismatch`);
        expect(summary).toContain("Reload Window");
        expect(describeProfile(defaultProfileFile(app.env.userDataDir))).toEqual([
            `${BROKEN}@1.0.0 pinned=true`,
            `${PLAIN}@1.1.0 pinned=true`,
        ]);
        expect(versionDirs(app.env.userDataDir, BROKEN)).toEqual([`${BROKEN}-1.0.0`]);

        // Check again (the metadata cache is reset): only the failed one is still outdated.
        await runPaletteCommand(app, "Extensions: Check for Extension Updates");
        await waitForScreen(app, "@outdated");
        await waitForRow(app, "installed", BROKEN, /Update 1\.1\.0$/u);
        expect(await rowText(app, "installed", PLAIN)).toBeNull();

        await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");
        await waitForScreen(app, "Updated 0 of 1 extensions.");
    });

    it("US-2.11: updating the root leaves its outdated dependency alone; Update All updates the dependency as its own row", async () => {
        const seed = join(root, "seed-deps");
        // The dependency first, at its old version: the root's install then finds it and installs nothing.
        await cliOk(["--user-data-dir", seed, "--registry", registry, "--install-extension", `${DEP}@1.0.0`]);
        await cliOk(["--user-data-dir", seed, "--registry", registry, "--install-extension", `${ROOT}@1.0.0`]);
        const app = await start({ seedUserData: seed });
        await showViewlet(app);
        await waitForRow(app, "installed", DEP, /^Sample Lang {2}1\.0\.0 {2}Update 1\.1\.0$/u);
        await waitForRow(app, "installed", ROOT, /^Lang Pack {2}1\.0\.0 {2}Update 1\.1\.0$/u);

        await openPage(app, "lang-pack", ROOT);
        await pressButton(app, "Update to 1.1.0");
        await waitForScreen(app, "Installed 1.1.0");
        expect(describeProfile(defaultProfileFile(app.env.userDataDir))).toEqual([
            `${ROOT}@1.1.0 pinned=true`,
            `${DEP}@1.0.0 pinned=true`,
        ]);

        await app.session.executeCommand("workbench.extensions.action.updateAllExtensions");
        await waitForScreen(app, "Updated 1 extension.");
        expect(describeProfile(defaultProfileFile(app.env.userDataDir))).toEqual([
            `${ROOT}@1.1.0 pinned=true`,
            `${DEP}@1.1.0 pinned=true`,
        ]);
    });

    it("profile B: Update All updates B's entries only; Default keeps its version, which is not obsolete after a reload", async () => {
        const seed = join(root, "seed-two-profiles");
        await cliOk(["--user-data-dir", seed, "--registry", registry, "--install-extension", `${PLAIN}@1.0.0`]);
        createNamedProfile(seed, "B");
        await cliOk([
            "--user-data-dir",
            seed,
            "--registry",
            registry,
            "--profile",
            "B",
            "--install-extension",
            `${PLAIN}@1.0.0`,
        ]);
        const app = await start({ seedUserData: seed, extraArgs: ["--profile", "B"] });
        await showViewlet(app);
        await waitForRow(app, "installed", PLAIN, /Update 1\.1\.0$/u);

        await runPaletteCommand(app, "Extensions: Update All Extensions");
        await waitForScreen(app, "Updated 1 extension.");
        const userData = app.env.userDataDir;
        expect(describeProfile(namedProfileFile(userData, "B"))).toEqual([`${PLAIN}@1.1.0 pinned=true`]);
        expect(describeProfile(defaultProfileFile(userData))).toEqual([`${PLAIN}@1.0.0 pinned=true`]);

        await app.session.executeCommand("workbench.action.reloadWindow").catch(() => undefined);
        await app.session.reconnect();
        await app.session.waitForReady();
        expect(versionDirs(userData, PLAIN)).toEqual([`${PLAIN}-1.0.0`, `${PLAIN}-1.1.0`]);
        expect(obsoleteKeys(userData)).not.toContain(`${PLAIN}-1.0.0`);
    });
});

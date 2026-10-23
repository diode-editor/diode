import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { cliOk, createNamedProfile, defaultProfileFile, namedProfileFile } from "./helpers/extensionsDisk.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Acceptance tests for ExtensionUpdates stage 1 in the window (docs/TODO/ExtensionUpdates.md, "stage 1 spec"): the
 * stories and edge cases the implementer's `extensionVersionPin.functional.test.ts` leaves out — errors (US-1.13),
 * sideloaded extensions (US-1.14), the palette precondition (US-1.6), profile B (US-1.9), dependencies and dates.
 * A test marked `it.fails` is a found bug; the comment names the item of the QA report in PR #785.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(here, "marketplace", "sample-extension");
/** `extensionDependencies: ["test.sample-lang"]`. */
const DEPENDENT = resolve(here, "marketplace", "dependent-extension");

const ID = "test.qa-ui";
const PAGE = "test-qa-ui";
const OTHER = "test.qa-other";
const DEP = "test.sample-lang";
const ROOT = "test.lang-pack";
const SIDE = "test.qa-side";

/** F6 opens the extensions viewlet: the e2e DSL cannot encode a real Ctrl+Shift+X. */
const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

const DAY = 24 * 60 * 60 * 1000;

let root: string;
let registry: string;
/** Only `ID`, with a broken 1.0.0 artifact. */
let brokenRegistry: string;
/** A registry that knows nothing of `SIDE`: its artifact is a sideloaded `.vsix`. */
let sideVsix: string;
/** A user-data dir with `ID@1.1.0` in Default and in profile B. */
let seedTwoProfiles: string;

interface IStartOptions {
    readonly installVsix?: string[];
    readonly extraArgs?: string[];
    readonly seedUserData?: string;
    /** Instead of the main fixture. */
    readonly registry?: string;
}

async function start(options: IStartOptions = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${options.registry ?? registry}`, ...(options.extraArgs ?? [])],
        keybindings: KEYS,
        installVsix: options.installVsix ?? [],
        ...(options.seedUserData === undefined ? {} : { seedUserData: options.seedUserData }),
        cols: 110,
        rows: 30,
    });
    await app.session.waitForReady();
    return app;
}

async function openExtensions(app: HeadlessApp): Promise<void> {
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
}

async function openPage(app: HeadlessApp, query: string, pageId: string): Promise<void> {
    await app.session.text(query);
    await app.session.key("Tab");
    await app.session.key("ArrowDown");
    await app.session.key("Enter");
    await app.session.waitForNode(`#extensionPage-${pageId}`);
}

async function pageButtons(app: HeadlessApp): Promise<string[]> {
    const header = await app.session.node("#extensionPageHeader");
    const state = header?.state as { buttons?: { label: string }[] } | undefined;
    return (state?.buttons ?? []).map((b) => b.label);
}

/** Focus lands on the first button; `ArrowRight` steps to the one with this label. */
async function pressButton(app: HeadlessApp, label: string): Promise<void> {
    const index = (await pageButtons(app)).indexOf(label);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) await app.session.key("ArrowRight");
    await app.session.key("Enter");
}

/** Types the query into the command palette; resolves with the screen once the list settled on it. */
async function palette(app: HeadlessApp, query: string): Promise<string> {
    await app.session.key("F1");
    await app.session.waitForNode("#quickInput");
    await app.session.text(query);
    return frameToText(await app.session.waitForText((t) => t.includes(query)));
}

async function runSpecificVersionCommand(app: HeadlessApp): Promise<void> {
    await palette(app, "Install Specific Version of Extension");
    await app.session.waitForText((t) => t.includes("Extensions: Install Specific Version of Extension..."));
    await app.session.key("Enter");
}

function artifact(registryDir: string, id: string, version: string): string {
    return join(registryDir, "artifacts", `${id}-${version}.vsix`);
}

interface IEntry {
    identifier: { id: string };
    version: string;
    metadata?: { pinned?: boolean };
}

/** Entries as `id@version pinned=…`, sorted by id. */
function describeProfile(file: string): string[] {
    if (!existsSync(file)) return [];
    return (JSON.parse(readFileSync(file, "utf8")) as IEntry[])
        .map((e) => `${e.identifier.id}@${e.version} pinned=${String(e.metadata?.pinned ?? false)}`)
        .sort();
}

function obsoleteDirs(app: HeadlessApp): string[] {
    const file = join(app.env.userDataDir, "extensions", ".obsolete");
    if (!existsSync(file)) return [];
    return Object.keys(JSON.parse(readFileSync(file, "utf8")) as Record<string, true>).sort();
}

async function screen(app: HeadlessApp): Promise<string> {
    return frameToText(await app.session.captureFrame());
}

async function waitForScreen(app: HeadlessApp, needle: string): Promise<string> {
    return frameToText(await app.session.waitForText((t) => t.includes(needle)));
}

describe("Install Specific Version edge cases (ExtensionUpdates stage 1 QA, functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-stage1-qa-ui-"));
        const now = Date.now();
        registry = await createRegistryFixture(join(root, "registry"), [
            {
                id: ID,
                version: "1.0.0",
                sourceDir: SAMPLE,
                displayName: "QA UI",
                // A date the registry may well publish: not ISO. No date is shown, the row stays.
                publishedAt: "not a date",
            },
            {
                id: ID,
                version: "1.1.0",
                sourceDir: SAMPLE,
                displayName: "QA UI",
                publishedAt: new Date(now - 3 * DAY).toISOString(),
            },
            // Sorted before "QA UI" by displayName, after it by id.
            { id: OTHER, version: "2.0.0", sourceDir: SAMPLE, displayName: "Alpha Other" },
            { id: DEP, version: "1.0.0", sourceDir: SAMPLE, displayName: "Sample Lang" },
            { id: ROOT, version: "1.0.0", sourceDir: DEPENDENT, displayName: "Lang Pack" },
            { id: ROOT, version: "1.1.0", sourceDir: DEPENDENT, displayName: "Lang Pack" },
        ]);
        brokenRegistry = await createRegistryFixture(join(root, "broken-registry"), [
            { id: ID, version: "1.0.0", sourceDir: SAMPLE, displayName: "QA UI", corruptSha: true },
            { id: ID, version: "1.1.0", sourceDir: SAMPLE, displayName: "QA UI" },
        ]);
        const sideRegistry = await createRegistryFixture(join(root, "side-registry"), [
            { id: SIDE, version: "1.0.0", sourceDir: SAMPLE, displayName: "QA Side" },
        ]);
        sideVsix = artifact(sideRegistry, SIDE, "1.0.0");

        seedTwoProfiles = join(root, "seed-two-profiles");
        await cliOk(["--user-data-dir", seedTwoProfiles, "--registry", registry, "--install-extension", ID]);
        createNamedProfile(seedTwoProfiles, "B");
        await cliOk([
            "--user-data-dir",
            seedTwoProfiles,
            "--registry",
            registry,
            "--profile",
            "B",
            "--install-extension",
            ID,
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(root);
    });

    it("US-1.13: a broken artifact of the picked version is an error on the page; disk and profile stay", async () => {
        const app = await start({ installVsix: [artifact(registry, ID, "1.1.0")], registry: brokenRegistry });
        await openExtensions(app);
        await openPage(app, "qa", PAGE);
        const before = describeProfile(defaultProfileFile(app.env.userDataDir));

        await pressButton(app, "Install Specific Version...");
        await waitForScreen(app, "Select Version to Install");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");

        const text = await waitForScreen(app, "sha256 mismatch");
        expect(text).not.toContain("Reload Window");
        expect(await pageButtons(app)).toEqual(["Install Specific Version...", "Uninstall", "[ ] Auto Update"]);
        expect(describeProfile(defaultProfileFile(app.env.userDataDir))).toEqual(before);
        expect(existsSync(join(app.env.userDataDir, "extensions", `${ID}-1.0.0`))).toBe(false);
        expect(obsoleteDirs(app)).toEqual([]);
    });

    // Regression test, QA report #2 (fixed in this PR): with the registry down the command says "no installed extensions from the marketplace"
    // instead of the registry error: before the catalog is read every installed extension looks sideloaded.
    it(
        "US-1.13: the palette command with the registry down shows the registry error, not 'no extensions'",
        async () => {
            const app = await start({
                installVsix: [artifact(registry, ID, "1.1.0")],
                registry: join(root, "no-such-registry"),
            });

            await runSpecificVersionCommand(app);

            // The viewlet shows the same failure as `Retry — ENOENT: no such file or directory…`.
            const text = await waitForScreen(app, "ENOENT");
            expect(text).not.toContain("There are no installed extensions from the marketplace.");
        },
    );

    it("US-1.14: a sideloaded extension has no button and is not in the palette's list", async () => {
        const app = await start({ installVsix: [sideVsix, artifact(registry, ID, "1.1.0")] });
        await openExtensions(app);
        await openPage(app, "side", "test-qa-side");
        expect(await pageButtons(app)).toEqual(["Uninstall"]);

        await runSpecificVersionCommand(app);

        const list = await waitForScreen(app, "Select Extension");
        expect(list).toContain(ID);
        expect(list).not.toContain(SIDE);
    });

    it("US-1.6: with only a sideloaded extension, after the catalog is read the command is not in the palette", async () => {
        const app = await start({ installVsix: [sideVsix] });
        // The viewlet reads the catalog.
        await openExtensions(app);
        await waitForScreen(app, "QA UI");
        await app.session.key("Escape");

        const text = await palette(app, "Install Specific Version of Extension");

        expect(text).not.toContain("Extensions: Install Specific Version of Extension...");
    });

    it("US-1.6: with nothing installed the command is not in the palette", async () => {
        const app = await start();

        const text = await palette(app, "Install Specific Version of Extension");

        expect(text).not.toContain("Extensions: Install Specific Version of Extension...");
    });

    it("US-1.6: the extension list is sorted by displayName with the id as description", async () => {
        const app = await start({ installVsix: [artifact(registry, ID, "1.1.0"), artifact(registry, OTHER, "2.0.0")] });

        await runSpecificVersionCommand(app);

        const list = await waitForScreen(app, "Select Extension");
        const alpha = list.indexOf("Alpha Other");
        const qa = list.indexOf("QA UI");
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(qa).toBeGreaterThan(alpha);
        expect(list).toMatch(new RegExp(`Alpha Other\\s+${OTHER.replace(".", "\\.")}`, "u"));
    });

    it("US-1.1: a version with an unparsable publishedAt is listed without a date", async () => {
        const app = await start({ installVsix: [artifact(registry, ID, "1.1.0")] });
        await openExtensions(app);
        await openPage(app, "qa", PAGE);

        await pressButton(app, "Install Specific Version...");

        const picker = await waitForScreen(app, "Select Version to Install");
        expect(picker).toMatch(/1\.1\.0\s+3 days ago \(current\)/u);
        expect(picker).toMatch(/1\.0\.0/u);
        expect(picker).not.toMatch(/1\.0\.0 +(\d+ \w+ ago|now|in \d)/u);
    });

    // Regression test, QA report #1 (fixed in this PR): the service passes the dependencies to `ProfileExtensions.add` as roots, so they get the pin.
    it("a dependency installed by the version picker is not pinned", async () => {
        const app = await start();
        await openExtensions(app);
        await openPage(app, "lang pack", "test-lang-pack");

        await pressButton(app, "Install Specific Version...");
        await waitForScreen(app, "Select Version to Install");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await waitForScreen(app, "Update to 1.1.0");

        expect(describeProfile(defaultProfileFile(app.env.userDataDir))).toEqual([
            `${ROOT}@1.0.0 pinned=true`,
            `${DEP}@1.0.0 pinned=false`,
        ]);
    });

    it("US-1.9: a rollback in profile B leaves Default's entry and its version alone", async () => {
        const app = await start({ seedUserData: seedTwoProfiles, extraArgs: ["--profile", "B"] });

        await runSpecificVersionCommand(app);
        await waitForScreen(app, "Select Extension");
        await app.session.key("Enter");
        await waitForScreen(app, "Select Version to Install");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Reload Window") && t.includes("Installed 1.0.0"));

        expect(describeProfile(namedProfileFile(app.env.userDataDir, "B"))).toEqual([`${ID}@1.0.0 pinned=true`]);
        expect(describeProfile(defaultProfileFile(app.env.userDataDir))).toEqual([`${ID}@1.1.0 pinned=false`]);
        // Default still uses 1.1.0.
        expect(obsoleteDirs(app)).toEqual([]);
        expect(await screen(app)).toContain("Update to 1.1.0");
    });

    // `getMeta` caches per session: the picker must still see a version the registry published meanwhile.
    it("US-1.1: after Extensions: Refresh the picker lists a version published meanwhile", async () => {
        const live = await createRegistryFixture(join(root, "live-registry"), [
            { id: ID, version: "1.0.0", sourceDir: SAMPLE, displayName: "QA UI" },
            { id: ID, version: "1.1.0", sourceDir: SAMPLE, displayName: "QA UI" },
        ]);
        const app = await start({ installVsix: [artifact(registry, ID, "1.1.0")], registry: live });
        await openExtensions(app);
        await openPage(app, "qa", PAGE);
        await pressButton(app, "Install Specific Version...");
        await waitForScreen(app, "Select Version to Install");
        await app.session.key("Escape");
        await app.session.waitForNoNode("#quickInput");

        // The registry publishes 1.2.0 while the window is open.
        const next = await createRegistryFixture(join(root, "live-registry-next"), [
            { id: ID, version: "1.0.0", sourceDir: SAMPLE, displayName: "QA UI" },
            { id: ID, version: "1.1.0", sourceDir: SAMPLE, displayName: "QA UI" },
            { id: ID, version: "1.2.0", sourceDir: SAMPLE, displayName: "QA UI" },
        ]);
        cpSync(next, live, { recursive: true });
        await app.session.executeCommand("extensions.refresh");
        await waitForScreen(app, "Update to 1.2.0");
        // The page command behind the button; the focus is no longer on the page after the refresh.
        // The command waits on the quick pick, so its reply never comes: the session closes with it in flight.
        app.session
            .executeCommand("workbench.extensions.action.install.anotherVersion", ID)
            .catch(() => undefined);

        const picker = await waitForScreen(app, "Select Version to Install");
        expect(picker).toMatch(/1\.2\.0/u);
    });
});

import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { explorerTitle } from "./helpers/explorerTitle.ts";
import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * The registry is hermetic (`--registry`), but artifacts are packed by the production pack-vsix; network
 * tests live in `e2e/marketplace/`. "Works after reload" is checked via a contribution in the
 * status bar, not via a file on disk.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE_SOURCE = resolve(here, "marketplace", "sample-extension");

/** F6 opens the extensions viewlet: the e2e DSL cannot encode a real Ctrl+Shift+X. */
const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

const SAMPLE_FILE = "sample.diodesample";

/** Registry cards: names and descriptions that do not overlap with the language name. */
const NAMES = {
    sample: { displayName: "Sample Lang", description: "Fixture language", readme: "Sample language readme" },
    legacy: { displayName: "Legacy Thing", description: "Needs a newer API" },
    broken: { displayName: "Broken Artifact", description: "Its bytes do not match the registry" },
    pack: { displayName: "Lang Pack", description: "Depends on another extension" },
} as const;

/** An extension with no contributions that depends on `test.sample-lang`. */
const DEPENDENT_SOURCE = resolve(here, "marketplace", "dependent-extension");

let registryRoot: string;
let registry: string;

async function openExtensions(options: { installVsix?: string[] } = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { [SAMPLE_FILE]: "sample marketplace 42\n" },
        open: [".", SAMPLE_FILE],
        extraArgs: [`--registry=${registry}`],
        keybindings: KEYS,
        installVsix: options.installVsix,
        cols: 110,
        rows: 30,
    });
    await app.session.waitForText((t) => t.includes(explorerTitle(app.env.workspaceDir)));
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
    return app;
}

/** Opens an extension page: filter by query → Enter on the first entry. */
async function openPage(app: HeadlessApp, query: string, pageId: string): Promise<void> {
    await app.session.text(query);
    await app.session.key("Tab");
    await app.session.key("ArrowDown");
    await app.session.key("Enter");
    await app.session.waitForNode(`#extensionPage-${pageId}`);
}

const ANOTHER_VERSION = { label: "Install Specific Version...", enabled: true };

/** Page buttons as the user sees them: label and enablement. */
async function pageButtons(app: HeadlessApp): Promise<{ label: string; enabled: boolean }[]> {
    const header = await app.session.node("#extensionPageHeader");
    const state = header?.state as { buttons?: { label: string; enabled: boolean }[] } | undefined;
    return state?.buttons ?? [];
}

/**
 * Installed extension directories in the session's user-data-dir. Next to them lie
 * `extensions.json` — the Default profile's contents — and service entries (`.obsolete`, `.inuse`).
 */
function installedDirs(app: HeadlessApp): string[] {
    const dir = join(app.env.userDataDir, "extensions");
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
}

/** Directories marked for removal on the next start. */
function obsoleteDirs(app: HeadlessApp): string[] {
    const file = join(app.env.userDataDir, "extensions", ".obsolete");
    if (!existsSync(file)) return [];
    return Object.keys(JSON.parse(readFileSync(file, "utf8")) as Record<string, true>).sort();
}

/** Ids in the Default profile (`extensions/extensions.json`) — what is enabled in the window. */
function defaultProfileIds(app: HeadlessApp): string[] {
    const file = join(app.env.userDataDir, "extensions", "extensions.json");
    const entries = JSON.parse(readFileSync(file, "utf8")) as { identifier: { id: string } }[];
    return entries.map((e) => e.identifier.id).sort();
}

describe("Extensions install (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        registryRoot = mkdtempSync(join(tmpdir(), "diode-registry-fixture-"));
        registry = await createRegistryFixture(join(registryRoot, "registry"), [
            // Two versions of one extension: install the old one and update to the new one.
            // Card names deliberately do not contain "Diode Sample": that is the language name
            // from the extension's contribution, used to check it works after reload.
            { id: "test.sample-lang", version: "0.0.1", sourceDir: SAMPLE_SOURCE, ...NAMES.sample },
            { id: "test.sample-lang", version: "0.0.2", sourceDir: SAMPLE_SOURCE, ...NAMES.sample },
            {
                id: "old.legacy",
                version: "3.0.0",
                sourceDir: SAMPLE_SOURCE,
                engines: { vscode: "^99.0.0" },
                ...NAMES.legacy,
            },
            { id: "broken.artifact", version: "1.0.0", sourceDir: SAMPLE_SOURCE, corruptSha: true, ...NAMES.broken },
            // No contributions of its own — only `extensionDependencies: ["test.sample-lang"]`.
            { id: "test.lang-pack", version: "0.0.1", sourceDir: DEPENDENT_SOURCE, ...NAMES.pack },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(registryRoot);
    });

    it("US-11/12: the Install button installs the extension to disk and asks to reload the window", async () => {
        const app = await openExtensions();
        await openPage(app, "sample", "test-sample-lang");
        expect(await pageButtons(app)).toEqual([{ label: "Install", enabled: true }, ANOTHER_VERSION]);

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Installed 0.0.2"));

        expect(await pageButtons(app)).toEqual([
            { label: "Reload Window", enabled: true },
            ANOTHER_VERSION,
            { label: "Uninstall", enabled: true },
            // Installed from the marketplace: not pinned, auto-update is on (ExtensionUpdates stage 3).
            { label: "[x] Auto Update", enabled: true },
        ]);
        expect(installedDirs(app)).toEqual(["test.sample-lang-0.0.2"]);
        expect(existsSync(join(app.env.userDataDir, "extensions", "test.sample-lang-0.0.2", "package.json"))).toBe(
            true,
        );
        // And enabled in the window's profile.
        expect(defaultProfileIds(app)).toEqual(["test.sample-lang"]);
        // The result message is in the status bar, next to the same prompt.
        expect(frameToText(await app.session.captureFrame())).toContain("reload window to activate");
    });

    it("US-13: after a window reload the extension contribution works", async () => {
        const app = await openExtensions();
        // Before install the language is unknown: `.diodesample` is plain text.
        expect(frameToText(await app.session.captureFrame())).not.toContain("Diode Sample");

        await openPage(app, "sample", "test-sample-lang");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Reload Window"));

        // The reply to this input may never arrive: the window restarts along with the socket.
        await app.session.sendKey("Enter").catch(() => undefined);
        await app.session.reconnect();

        // New window: same arguments, restored session and — most importantly —
        // the language from the installed extension.
        await app.session.waitForText((t) => t.includes("Diode Sample"), { timeoutMs: 60_000 });
    });

    it("Install also installs extensionDependencies without asking, like VS Code; after reload the dependency contribution works", async () => {
        const app = await openExtensions();
        await openPage(app, "pack", "test-lang-pack");

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Installed 0.0.1"));

        // The dependency is the highest compatible version in the registry.
        expect(installedDirs(app)).toEqual(["test.lang-pack-0.0.1", "test.sample-lang-0.0.2"]);
        expect(defaultProfileIds(app)).toEqual(["test.lang-pack", "test.sample-lang"]);

        // The reply to this input may never arrive: the window restarts along with the socket.
        await app.session.sendKey("Enter").catch(() => undefined);
        await app.session.reconnect();
        // Only the dependency provides the language: Lang Pack itself has no contributions.
        await app.session.waitForText((t) => t.includes("Diode Sample"), { timeoutMs: 60_000 });
    });

    it("US-14: for an installed older version the button updates to the registry version", async () => {
        const app = await openExtensions({
            installVsix: [join(registry, "artifacts", "test.sample-lang-0.0.1.vsix")],
        });
        await openPage(app, "sample", "test-sample-lang");
        expect(await pageButtons(app)).toEqual([
            { label: "Update to 0.0.2", enabled: true },
            ANOTHER_VERSION,
            { label: "Uninstall", enabled: true },
            // A `.vsix` is pinned (stage 1).
            { label: "[ ] Auto Update", enabled: true },
        ]);

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Installed 0.0.2"));

        // The old version stays for the running host and is marked for removal on the next start.
        expect(installedDirs(app)).toEqual(["test.sample-lang-0.0.1", "test.sample-lang-0.0.2"]);
        expect(obsoleteDirs(app)).toEqual(["test.sample-lang-0.0.1"]);

        // The reply to this input may never arrive: the window restarts along with the socket.
        await app.session.sendKey("Enter").catch(() => undefined);
        await app.session.reconnect();
        await app.session.waitForText((t) => t.includes("Diode Sample"), { timeoutMs: 60_000 });
        // Exactly one version on disk after the reload.
        expect(installedDirs(app)).toEqual(["test.sample-lang-0.0.2"]);
        expect(obsoleteDirs(app)).toEqual([]);
    });

    it("US-15: Uninstall removes the extension from disk", async () => {
        const app = await openExtensions({
            installVsix: [join(registry, "artifacts", "test.sample-lang-0.0.1.vsix")],
        });
        await openPage(app, "sample", "test-sample-lang");
        // From "Update to …" past "Install Specific Version..." to "Uninstall".
        await app.session.key("ArrowRight");
        await app.session.key("ArrowRight");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Not installed"));

        // No longer in any profile — marked for removal; the running host keeps its files until the next start.
        expect(installedDirs(app)).toEqual(["test.sample-lang-0.0.1"]);
        expect(obsoleteDirs(app)).toEqual(["test.sample-lang-0.0.1"]);
        expect(defaultProfileIds(app)).toEqual([]);
        expect(frameToText(await app.session.captureFrame())).toContain("reload window to apply");
    });

    it("US-16: an incompatible extension is not installed — the button is there but disabled", async () => {
        const app = await openExtensions();
        await openPage(app, "legacy", "old-legacy");

        // An older version could still be compatible: only the registry's version list knows.
        expect(await pageButtons(app)).toEqual([{ label: "Install", enabled: false }, ANOTHER_VERSION]);
        const screen = frameToText(await app.session.captureFrame());
        expect(screen).toContain("Incompatible with this build of Diode");
        // The reason is shown alongside: the registry entry's requirement.
        expect(screen).toContain("Requires: vscode ^99.0.0");
    });

    it("US-17: a broken artifact is not installed, the reason is shown, nothing on disk", async () => {
        const app = await openExtensions();
        await openPage(app, "broken", "broken-artifact");

        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("sha256 mismatch"));

        expect(installedDirs(app)).toEqual([]);
        // The button is enabled again — retrying is possible right away.
        expect(await pageButtons(app)).toEqual([{ label: "Install", enabled: true }, ANOTHER_VERSION]);
    });
});

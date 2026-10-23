import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * ExtensionUpdates stage 1 as the user sees it: `Install Specific Version...` on the extension page and
 * `Extensions: Install Specific Version of Extension...` in the palette, a quick pick of the compatible versions,
 * the rollback pinned in the profile. Hermetic registry (`--registry`), real `.vsix` from pack-vsix.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = resolve(here, "marketplace", "sample-extension");
const ID = "test.pin-ui";
const PAGE = "test-pin-ui";
const NO_VERSIONS_ID = "test.too-new";

/** F6 opens the extensions viewlet: the e2e DSL cannot encode a real Ctrl+Shift+X. */
const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

const DAY = 24 * 60 * 60 * 1000;

let registryRoot: string;
let registry: string;

async function openExtensions(installVsix: string[] = []): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${registry}`],
        keybindings: KEYS,
        installVsix,
        cols: 110,
        rows: 30,
    });
    await app.session.waitForReady();
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
    return app;
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

function vsix(version: string): string {
    return join(registry, "artifacts", `${ID}-${version}.vsix`);
}

/** The Default profile's entry of the extension as `version pinned`. */
function profileEntry(app: HeadlessApp): string | undefined {
    const file = join(app.env.userDataDir, "extensions", "extensions.json");
    const entries = JSON.parse(readFileSync(file, "utf8")) as {
        identifier: { id: string };
        version: string;
        metadata?: { pinned?: boolean };
    }[];
    const found = entries.find((e) => e.identifier.id === ID);
    return found && `${found.version} pinned=${String(found.metadata?.pinned ?? false)}`;
}

function obsoleteDirs(app: HeadlessApp): string[] {
    const file = join(app.env.userDataDir, "extensions", ".obsolete");
    if (!existsSync(file)) return [];
    return Object.keys(JSON.parse(readFileSync(file, "utf8")) as Record<string, true>).sort();
}

function versionDirs(app: HeadlessApp): string[] {
    return readdirSync(join(app.env.userDataDir, "extensions"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith(ID))
        .map((entry) => entry.name)
        .sort();
}

async function screen(app: HeadlessApp): Promise<string> {
    return frameToText(await app.session.captureFrame());
}

async function waitForScreen(app: HeadlessApp, needle: string): Promise<string> {
    return frameToText(await app.session.waitForText((t) => t.includes(needle)));
}

describe("Install Specific Version (ExtensionUpdates stage 1, functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        registryRoot = mkdtempSync(join(tmpdir(), "diode-version-pin-ui-"));
        const now = Date.now();
        registry = await createRegistryFixture(join(registryRoot, "registry"), [
            // Incompatible: not offered by the picker (decision D2, like upstream). Declared first, so the
            // index's latest stays 1.1.0.
            { id: ID, version: "0.9.0", sourceDir: SOURCE, engines: { vscode: "^99.0.0" }, displayName: "Pin UI" },
            {
                id: ID,
                version: "1.0.0",
                sourceDir: SOURCE,
                displayName: "Pin UI",
                publishedAt: new Date(now - 60 * DAY).toISOString(),
            },
            {
                id: ID,
                version: "1.1.0",
                sourceDir: SOURCE,
                displayName: "Pin UI",
                publishedAt: new Date(now - 2 * DAY).toISOString(),
            },
            {
                id: NO_VERSIONS_ID,
                version: "3.0.0",
                sourceDir: SOURCE,
                engines: { vscode: "^99.0.0" },
                displayName: "Too New",
            },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(registryRoot);
    });

    it("US-1.1/US-1.2: the page picker lists compatible versions; picking an older one rolls back, pinned, and survives reload", async () => {
        const app = await openExtensions([vsix("1.1.0")]);
        await openPage(app, "pin", PAGE);
        expect(await pageButtons(app)).toEqual(["Install Specific Version...", "Uninstall"]);

        await pressButton(app, "Install Specific Version...");
        const picker = await waitForScreen(app, "Select Version to Install");
        expect(picker).toMatch(/1\.1\.0\s+2 days ago \(current\)/u);
        expect(picker).toMatch(/1\.0\.0\s+2 mos ago/u);
        expect(picker).not.toContain("0.9.0");

        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Installed 1.0.0"));

        expect(await pageButtons(app)).toEqual([
            "Reload Window",
            "Update to 1.1.0",
            "Install Specific Version...",
            "Uninstall",
        ]);
        expect(await screen(app)).toContain(`Installed ${ID}@1.0.0 — reload window to activate`);
        expect(profileEntry(app)).toBe("1.0.0 pinned=true");
        expect(obsoleteDirs(app)).toEqual([`${ID}-1.1.0`]);

        // The reply to this input may never arrive: the window restarts along with the socket.
        await app.session.sendKey("Enter").catch(() => undefined);
        await app.session.reconnect();
        await app.session.waitForReady();
        expect(versionDirs(app)).toEqual([`${ID}-1.0.0`]);
        await app.session.key("F6");
        await app.session.waitForText((t) => t.includes("EXTENSIONS"));
        await openPage(app, "pin", PAGE);
        await app.session.waitForText((t) => t.includes("Installed 1.0.0"));
    });

    it("US-1.3: Escape and picking the current version change nothing", async () => {
        const app = await openExtensions([vsix("1.1.0")]);
        await openPage(app, "pin", PAGE);
        const before = profileEntry(app);

        await pressButton(app, "Install Specific Version...");
        await app.session.waitForText((t) => t.includes("Select Version to Install"));
        await app.session.key("Escape");
        await app.session.waitForNoNode("#quickInput");

        await app.session.waitForNode("#extensionPage-test-pin-ui");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Select Version to Install"));
        // The first row is the installed 1.1.0.
        await app.session.key("Enter");
        await app.session.waitForNoNode("#quickInput");

        expect(await pageButtons(app)).toEqual(["Install Specific Version...", "Uninstall"]);
        expect(profileEntry(app)).toBe(before);
        expect(obsoleteDirs(app)).toEqual([]);
    });

    it("US-1.4: no compatible versions — upstream's info message, no picker", async () => {
        const app = await openExtensions();
        await openPage(app, "too new", "test-too-new");
        expect(await pageButtons(app)).toEqual(["Install", "Install Specific Version..."]);

        await pressButton(app, "Install Specific Version...");

        const text = await waitForScreen(app, "This extension has no other versions.");
        expect(text).not.toContain("Select Version to Install");
    });

    it("US-1.5/US-1.7: a not installed extension gets the picked version pinned; a plain update keeps the pin", async () => {
        const app = await openExtensions();
        await openPage(app, "pin", PAGE);

        await pressButton(app, "Install Specific Version...");
        await app.session.waitForText((t) => t.includes("Select Version to Install"));
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Update to 1.1.0"));
        expect(profileEntry(app)).toBe("1.0.0 pinned=true");

        await pressButton(app, "Update to 1.1.0");
        await app.session.waitForText((t) => t.includes("Installed 1.1.0"));

        expect(profileEntry(app)).toBe("1.1.0 pinned=true");
    });

    it("US-1.6: the palette command picks an installed extension, then its version, and opens its page", async () => {
        const app = await openExtensions([vsix("1.1.0")]);

        await app.session.key("F1");
        await app.session.waitForNode("#quickInput");
        await app.session.text("Install Specific Version of Extension");
        await app.session.waitForText((t) => t.includes("Extensions: Install Specific Version of Extension..."));
        await app.session.key("Enter");
        const extensions = await waitForScreen(app, "Select Extension");
        expect(extensions).toMatch(new RegExp(`Pin UI\\s+${ID.replace(".", "\\.")}`, "u"));
        await app.session.key("Enter");
        await app.session.waitForText((t) => t.includes("Select Version to Install"));
        await app.session.key("ArrowDown");
        await app.session.key("Enter");

        await app.session.waitForNode(`#extensionPage-${PAGE}`);
        await app.session.waitForText((t) => t.includes("Reload Window") && t.includes("Installed 1.0.0"));
        expect(profileEntry(app)).toBe("1.0.0 pinned=true");
    });
});

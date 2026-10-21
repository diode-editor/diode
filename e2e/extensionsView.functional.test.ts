import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * The file registry fixture is tailored to card states: `acme.sample` is not
 * installed, `test.tab-setter` is 0.0.1 while the registry has 0.0.2 (update),
 * `old.legacy` requires `vscode ^99` (incompatible).
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const REGISTRY = resolve(here, "fixtures", "registry");
const USER_DATA = resolve(here, "fixtures", "user-data-with-tab-setter");

/** F6 opens the extensions viewlet: the e2e DSL can't encode the real Ctrl+Shift+X. */
const KEYS = [{ key: "f6", command: "workbench.view.extensions" }];

async function openExtensions(options: { registry?: string } = {}): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        seedUserData: USER_DATA,
        files: { "hello.txt": "hello\n" },
        extraArgs: [`--registry=${options.registry ?? REGISTRY}`],
        keybindings: KEYS,
        cols: 110,
        rows: 30,
    });
    await app.session.waitForText((t) => t.includes("EXPLORER"));
    await app.session.key("F6");
    await app.session.waitForText((t) => t.includes("EXTENSIONS"));
    return app;
}

/** Editor tab labels: page identity is checked by them. */
async function tabLabels(app: HeadlessApp): Promise<string[]> {
    const strip = await app.session.node("EditorTabStripElement");
    const state = strip?.state as { tabs?: { label: string }[] } | undefined;
    return (state?.tabs ?? []).map((t) => t.label);
}

/** List row text by its id: unlike the frame, it doesn't depend on the sidebar width. */
async function rowText(app: HeadlessApp, id: string): Promise<string> {
    const row = await app.session.node(`#${id}`);
    expect(row, `row #${id} not found`).not.toBeNull();
    return row?.text ?? "";
}

describe("Extensions view (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("US-1: the show command opens the viewlet with a search box and both sections", async () => {
        const app = await openExtensions();
        const screen = frameToText(await app.session.captureFrame());

        expect(screen).toContain("EXTENSIONS");
        expect(screen).toContain("Search Extensions");
        expect(screen).toContain("MARKETPLACE");
        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Acme Sample");
    });

    it("US-4/5/6: installed, update and incompatible badges", async () => {
        const app = await openExtensions();
        // The sidebar is narrow and the badge is clipped in the frame, so read the row text:
        // it doesn't depend on the panel width.
        expect(await rowText(app, "extensionsGroup-marketplace-acme-sample")).toBe("Acme Sample  1.2.0");
        expect(await rowText(app, "extensionsGroup-marketplace-test-tab-setter")).toBe("Tab Setter  0.0.1  Update 0.0.2");
        expect(await rowText(app, "extensionsGroup-installed-test-tab-setter")).toBe("Tab Setter  0.0.1  Update 0.0.2");
        expect(await rowText(app, "extensionsGroup-marketplace-old-legacy")).toBe("Legacy Thing  3.0.0  Incompatible");
    });

    it("US-2: filtering as you type keeps only matching entries", async () => {
        const app = await openExtensions();
        await app.session.text("acme");
        await app.session.waitForNoNode("#extensionsGroup-marketplace-old-legacy");

        const screen = frameToText(await app.session.captureFrame());
        expect(screen).toContain("Acme Sample");
        expect(screen).not.toContain("Legacy Thing");
    });

    it("US-3: no matches — empty state", async () => {
        const app = await openExtensions();
        await app.session.text("zzzz");
        await app.session.waitForText((t) => t.includes("No extensions found"));
    });

    it("US-8: Enter on an entry opens the extension page with the readme", async () => {
        const app = await openExtensions();
        await app.session.text("acme");
        await app.session.waitForText((t) => t.includes("Acme Sample"));
        await app.session.key("Tab");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");

        await app.session.waitForText((t) => t.includes("This readme comes from the registry meta"));
        const screen = frameToText(await app.session.captureFrame());
        expect(screen).toContain("Not installed");
        expect(screen).toContain("Latest version: 1.2.0");
        expect(screen).toContain("Kind: native");
    });

    it("US-9: opening again switches to the same tab instead of creating a second one", async () => {
        const app = await openExtensions();
        await app.session.text("acme");
        await app.session.waitForText((t) => t.includes("Acme Sample"));
        await app.session.key("Tab");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForNode("#extensionPage-acme-sample");
        expect(await tabLabels(app)).toEqual(["Acme Sample"]);

        // Go back to the list and open the same entry again.
        await app.session.key("F6");
        await app.session.key("Tab");
        await app.session.key("ArrowDown");
        await app.session.key("Enter");
        await app.session.waitForNode("#extensionPage-acme-sample");

        // A single tab: the pane's identity is its uri (`extension:acme.sample`),
        // reopening switches to the existing one.
        expect(await tabLabels(app)).toEqual(["Acme Sample"]);
    });

    it("US-18/20: unreachable registry — reason and retry, installed extensions are visible", async () => {
        const app = await openExtensions({ registry: resolve(here, "fixtures", "registry-missing") });
        await app.session.waitForText((t) => t.includes("Retry"));

        const screen = frameToText(await app.session.captureFrame());
        // The failure reason is not "fetch failed" but text with the path/error code.
        expect(screen).toContain("Retry");
        expect(screen).toContain("INSTALLED");
        expect(screen).toContain("Tab Setter");
    });
});

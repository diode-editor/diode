import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The seed puts `hello-lang` into `extensions/` without `extensions.json`, and migration makes it part of Default;
// the extension shows as the `.hello` language in the status bar. Commands go via the palette: the Empty profile
// lacks the scenario keybindings.

const fixture = resolve(repoRoot, "e2e", "fixtures", "profileExtensions");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-hello");

const registry = await createRegistryFixture(join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"), [
    {
        id: "test.sample-lang",
        version: "0.0.2",
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
        displayName: "Sample Lang",
        description: "Synthetic marketplace extension: its own language and grammar",
        readme: "# Sample Lang\n\nThe .diodesample language.",
    },
]);

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

/** The old socket closes and a new one comes up on the same port. */
async function reloaded(editor: ScenarioDriver): Promise<void> {
    await editor.reconnect();
    await editor.waitForText((t) => t.includes("EXPLORER"), { timeoutMs: 60_000 });
}

/** `down`: how many steps down from "Empty" in the contents picker. */
async function newProfile(editor: ScenarioDriver, name: string, down: number): Promise<void> {
    await runCommand(editor, "Profiles: New Profile...");
    await editor.waitForText((t) => t.includes("Profile name"));
    await editor.sendText(name);
    await editor.sendKey("Enter");
    await editor.waitForText((t) => t.includes("Empty") && t.includes("Copy from current"));
    for (let i = 0; i < down; i++) await editor.sendKey("ArrowDown");
    await editor.sendKey("Enter").catch(() => undefined);
    await reloaded(editor);
}

async function expectLanguage(editor: ScenarioDriver, language: string): Promise<void> {
    await editor.waitForText((t) => t.split("\n").some((line) => line.trimEnd().endsWith(language)));
}

async function showExtensions(editor: ScenarioDriver): Promise<void> {
    await runCommand(editor, "View: Show Extensions");
    await editor.waitForText((t) => t.includes("MARKETPLACE") && t.includes("Sample Lang"));
}

export default defineScenario({
    name: "profile-extensions",
    title: "Profiles: per-profile extension sets — migration, Copy from current, Empty, install into a profile",
    seedUserData: userData,
    open: [fixture, resolve(fixture, "greeting.hello")],
    extraArgs: [`--registry=${registry}`],
    cols: 110,
    rows: 28,
    // On Windows, Reload Window from a scenario brings the window up without a sidebar (docs/TODO/E2E.md).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await expectLanguage(editor, "Hello Language");
        await editor.capture("default");

        // Copy from current: Default's set (hello-lang) carries over to the new profile.
        await newProfile(editor, "copied", 1);
        await expectLanguage(editor, "Hello Language");
        await editor.capture("copied");

        // Empty: no extensions, so `.hello` opens as plain text.
        await newProfile(editor, "clean", 0);
        await expectLanguage(editor, "Plain Text");
        await editor.capture("empty");

        // The empty profile's marketplace view: hello-lang is on disk but not in this
        // profile, so there is no INSTALLED section at all.
        await showExtensions(editor);
        await editor.waitForText((t) => !t.includes("INSTALLED"));
        await editor.capture("empty-view");

        // Installing from the marketplace adds to the active profile.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-sample-lang");
        await editor.waitForText((t) => t.includes("Not installed"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Reload Window") && t.includes("INSTALLED"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await editor.sendKey("Ctrl+P");
        await editor.sendText("notes.diodesample");
        await editor.waitForText((t) => t.includes("notes.diodesample"));
        await editor.sendKey("Enter");
        await expectLanguage(editor, "Diode Sample");
        await editor.capture("installed");

        // Default: hello-lang is there, and Sample Lang isn't installed in it.
        await runCommand(editor, "Profiles: Switch Profile...");
        await editor.waitForText((t) => t.includes("Select Profile"));
        await editor.sendText("Default");
        await editor.waitForText((t) => t.includes("Default") && !t.includes("clean"));
        await editor.sendKey("Enter").catch(() => undefined);
        await reloaded(editor);
        await expectLanguage(editor, "Hello Language");
        await showExtensions(editor);
        // Sample Lang has a single catalog card; in the empty profile after install
        // there were two (catalog and INSTALLED).
        await editor.waitForText((t) => t.includes("INSTALLED") && t.split("Sample Lang").length === 2);
        await editor.capture("default-again");
    },
});

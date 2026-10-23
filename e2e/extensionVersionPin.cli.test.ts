import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";

/**
 * ExtensionUpdates stage 1 in the CLI: `--install-extension id@version` installs exactly that version and pins
 * it in the profile (upstream `installGivenVersion`), like a `.vsix`. Real artifacts packed by pack-vsix.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = resolve(here, "marketplace", "sample-extension");
const ID = "test.pin-demo";

let root: string;
let registry: string;

interface ICliResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

async function runCli(userDataDir: string, ...args: string[]): Promise<ICliResult> {
    const binary = await getBinaryPath();
    return new Promise((resolveRun, reject) => {
        const child = spawn(binary, [`--user-data-dir=${userDataDir}`, `--registry=${registry}`, ...args], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            resolveRun({ code, stdout, stderr });
        });
    });
}

/** The Default profile's entries as `version pinned`. */
function profileEntries(userDataDir: string): string[] {
    const file = join(userDataDir, "extensions", "extensions.json");
    const entries = JSON.parse(readFileSync(file, "utf8")) as {
        identifier: { id: string };
        version: string;
        metadata?: { pinned?: boolean };
    }[];
    return entries.map((e) => `${e.identifier.id}@${e.version} pinned=${String(e.metadata?.pinned ?? false)}`);
}

let counter = 0;
function freshUserData(): string {
    counter++;
    return join(root, `user-data-${String(counter)}`);
}

describe("CLI --install-extension id@version (ExtensionUpdates stage 1)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-version-pin-cli-"));
        registry = await createRegistryFixture(join(root, "registry"), [
            { id: ID, version: "1.0.0", sourceDir: SOURCE },
            { id: ID, version: "1.1.0", sourceDir: SOURCE },
            // Too new for this build: the highest compatible is 1.1.0, but an exact version bypasses engines.
            { id: ID, version: "2.0.0", sourceDir: SOURCE, engines: { vscode: "^99.0.0" } },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(root);
    });

    it("US-1.10: over a newer version installs exactly the given one, pinned; the newer one is marked for removal", async () => {
        const userData = freshUserData();
        const latest = await runCli(userData, "--install-extension", ID);
        expect(latest.stdout).toContain(`Installed ${ID}@1.1.0`);
        expect(profileEntries(userData)).toEqual([`${ID}@1.1.0 pinned=false`]);

        const rollback = await runCli(userData, "--install-extension", `${ID}@1.0.0`);

        expect(rollback.stderr).toBe("");
        expect(rollback.code).toBe(0);
        expect(rollback.stdout).toContain(`Installed ${ID}@1.0.0`);
        expect(rollback.stdout).toContain("Previous version(s) will be removed on next start: 1.1.0");
        expect(profileEntries(userData)).toEqual([`${ID}@1.0.0 pinned=true`]);
        const list = await runCli(userData, "--list-extensions");
        expect(list.stdout.trim()).toBe(`${ID}@1.0.0`);
    });

    it("US-1.12: the version already in the profile is a message and exit 0, and the entry gets pinned (decision D4)", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", ID);

        const again = await runCli(userData, "--install-extension", `${ID}@1.1.0`);

        expect(again.stderr).toBe("");
        expect(again.code).toBe(0);
        expect(again.stdout.trim()).toBe(`Extension '${ID}@1.1.0' is already installed.`);
        expect(profileEntries(userData)).toEqual([`${ID}@1.1.0 pinned=true`]);
    });

    it("US-1.7: a plain install over a pinned version updates and keeps the pin", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", `${ID}@1.0.0`);

        const update = await runCli(userData, "--install-extension", ID);

        expect(update.stdout).toContain(`Installed ${ID}@1.1.0`);
        expect(profileEntries(userData)).toEqual([`${ID}@1.1.0 pinned=true`]);
    });

    it("an exact version bypasses engines, like before", async () => {
        const userData = freshUserData();

        const install = await runCli(userData, "--install-extension", `${ID}@2.0.0`);

        expect(install.code).toBe(0);
        expect(install.stdout).toContain(`Installed ${ID}@2.0.0`);
        expect(profileEntries(userData)).toEqual([`${ID}@2.0.0 pinned=true`]);
    });

    it("a version the registry does not have fails with the list of available ones, nothing installed", async () => {
        const userData = freshUserData();

        const install = await runCli(userData, "--install-extension", `${ID}@9.9.9`);

        expect(install.code).toBe(1);
        expect(install.stderr).toContain(`Extension "${ID}" has no version 9.9.9 for this host`);
        expect(install.stderr).toContain("available: 1.0.0");
        const list = await runCli(userData, "--list-extensions");
        expect(list.stdout.trim()).toBe("");
    });

    it("US-1.11: a .vsix is a given version too — pinned", async () => {
        const userData = freshUserData();

        const install = await runCli(userData, "--install-extension", join(registry, "artifacts", `${ID}-1.0.0.vsix`));

        expect(install.code).toBe(0);
        expect(profileEntries(userData)).toEqual([`${ID}@1.0.0 pinned=true`]);
    });

    it("the help names the version form", async () => {
        const help = await runCli(freshUserData(), "--help");

        expect(help.stdout).toContain("--install-extension <path.vsix | id[@version]>");
    });
});

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * ExtensionUpdates stage 0 as the user sees it: an extension updated from another terminal keeps working in
 * the running window until reload (its lazily required module is still on disk), and the reload picks up the
 * new version and removes the old one. The fixture's command reads a module from its own directory on every call.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const LAZY_SOURCE = resolve(here, "marketplace", "lazy-extension");
const ID = "test.lazy-version";

let registryRoot: string;
let registry: string;

interface ICliResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/** Another process, like `diode --install-extension` in a second terminal. */
async function runCli(args: readonly string[]): Promise<ICliResult> {
    const binary = await getBinaryPath();
    return new Promise((resolveRun, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
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

/** Extension directories, without `extensions.json` and the service entries. */
function versionDirs(app: HeadlessApp): string[] {
    return readdirSync(join(app.env.userDataDir, "extensions"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort();
}

async function lazyVersionAfterCommand(app: HeadlessApp, calls: number): Promise<string> {
    await app.session.executeCommand("lazyVersion.show");
    const output = await waitUntil(
        () => app.session.getOutput("Lazy Version"),
        (text) =>
            text
                .trim()
                .split("\n")
                .filter((line) => line.startsWith("lazy ")).length >= calls,
        { describe: "Lazy Version output", timeoutMs: 30_000, diagnose: (text) => String(text) },
    );
    return output.trim().split("\n").at(-1) ?? "";
}

describe("Extension update under a running host (ExtensionUpdates stage 0)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        registryRoot = mkdtempSync(join(tmpdir(), "diode-update-registry-"));
        registry = await createRegistryFixture(join(registryRoot, "registry"), [
            { id: ID, version: "1.0.0", sourceDir: LAZY_SOURCE },
            { id: ID, version: "1.1.0", sourceDir: LAZY_SOURCE },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(registryRoot);
    });

    it("US-0.1/US-0.2: the running window keeps the old version until reload, the reload loads the new one and deletes the old", async () => {
        const app = await useHeadlessApp({
            files: { "hello.txt": "hello\n" },
            extraArgs: [`--registry=${registry}`],
            installVsix: [join(registry, "artifacts", `${ID}-1.0.0.vsix`)],
        });
        await app.session.waitForReady();
        const extensionsDir = join(app.env.userDataDir, "extensions");
        // The window leases what it loaded (decision V1).
        expect(readdirSync(join(extensionsDir, ".inuse"))).toHaveLength(1);

        const update = await runCli([
            `--user-data-dir=${app.env.userDataDir}`,
            `--registry=${registry}`,
            "--install-extension",
            ID,
        ]);
        expect(update.stderr).toBe("");
        expect(update.code).toBe(0);
        expect(update.stdout).toContain(`Installed ${ID}@1.1.0`);
        expect(update.stdout).toContain("Previous version(s) will be removed on next start: 1.0.0");
        expect(versionDirs(app)).toEqual([`${ID}-1.0.0`, `${ID}-1.1.0`]);
        expect(JSON.parse(readFileSync(join(extensionsDir, ".obsolete"), "utf8"))).toEqual({ [`${ID}-1.0.0`]: true });

        // The command loads its module only now — from the directory the window started with.
        expect(await lazyVersionAfterCommand(app, 1)).toBe("lazy version 1.0.0");

        // The reply may never arrive: the window restarts along with the socket.
        await app.session.executeCommand("workbench.action.reloadWindow").catch(() => undefined);
        await app.session.reconnect();
        await app.session.waitForReady();

        expect(versionDirs(app)).toEqual([`${ID}-1.1.0`]);
        expect(existsSync(join(extensionsDir, ".obsolete"))).toBe(false);
        // The output channel lives in the window: a new window starts with an empty one.
        expect(await lazyVersionAfterCommand(app, 1)).toBe("lazy version 1.1.0");
    });
});

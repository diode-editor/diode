import {
    chmodSync,
    createWriteStream,
    existsSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import * as crypto from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AppEnvOptions, type HeadlessApp, removeTempDir, startHeadlessApp } from "./helpers/appSession.ts";
import {
    cliOk,
    createNamedProfile,
    defaultProfileFile,
    extensionsDir,
    namedProfileFile,
    obsoleteFile,
    obsoleteKeys,
    readObsolete,
    readProfile,
    replacedLeftovers,
    runCli,
    seedVersionDirs,
    versionDirs,
    writeProfile,
} from "./helpers/extensionsDisk.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Acceptance tests of ExtensionUpdates stage 0 — safe version replacement (docs/TODO/ExtensionUpdates.md,
 * "Спека этапа 0"). Black box: the CLI, the extensions directory, the profile's `extensions.json`,
 * `extensions/.obsolete` and a live window with the extension's own OUTPUT channel.
 */

const ID = "acme.probe";
const PROBE_SOURCE = resolve(import.meta.dirname, "fixtures", "extensionUpdates", "version-probe");
const PROBE_CHANNEL = "Version Probe";
const LIVE_TIMEOUT = 180_000;
const CLI_TIMEOUT = 120_000;

let tempRoot: string;
/** Only `1.0.0` — the registry the user had before the update. */
let registryV1: string;
/** `1.0.0` and `1.1.0`: `latest` is `1.1.0`. */
let registryV2: string;
/** Only a source of `.vsix` files whose order differs by string and by semver. */
let registrySemver: string;
/** `acme.probe@1.1.0` whose archive passes the sha check but cannot be extracted, depending on `acme.lib`. */
let registryBroken: string;

function vsixOf(version: string): string {
    const registry = version === "1.0.0" || version === "1.1.0" ? registryV2 : registrySemver;
    return join(registry, "artifacts", `${ID}-${version}.vsix`);
}

function dirOf(version: string): string {
    return `${ID}-${version}`;
}

beforeAll(async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "diode-ext-updates-"));
    const probe = (version: string) => ({ id: ID, version, sourceDir: PROBE_SOURCE });
    registryV1 = await createRegistryFixture(join(tempRoot, "registry-v1"), [probe("1.0.0")]);
    registryV2 = await createRegistryFixture(join(tempRoot, "registry-v2"), [probe("1.0.0"), probe("1.1.0")]);
    registrySemver = await createRegistryFixture(join(tempRoot, "registry-semver"), [probe("1.9.0"), probe("1.10.0")]);
    registryBroken = await createBrokenRegistry(join(tempRoot, "registry-broken"));
}, CLI_TIMEOUT);

afterAll(() => {
    removeTempDir(tempRoot);
});

/** A fresh isolated root; the window and the CLI share its `user-data-dir`. */
function newRoot(): { root: string; userDataDir: string } {
    const root = mkdtempSync(join(tempRoot, "case-"));
    return { root, userDataDir: join(root, "user-data-dir") };
}

function udd(userDataDir: string): string {
    return `--user-data-dir=${userDataDir}`;
}

async function install(userDataDir: string, target: string, registry = registryV2, profile?: string) {
    return cliOk([
        udd(userDataDir),
        `--registry=${registry}`,
        ...(profile === undefined ? [] : ["--profile", profile]),
        "--install-extension",
        target,
    ]);
}

async function listed(userDataDir: string, profile?: string): Promise<string[]> {
    const result = await cliOk([
        udd(userDataDir),
        ...(profile === undefined ? [] : ["--profile", profile]),
        "--list-extensions",
    ]);
    return result.stdout
        .trim()
        .split(/\r?\n/u)
        .filter((line) => line !== "");
}

/** The window is started by the test and disposed by it: several tests restart on the same root. */
const windows = new Set<HeadlessApp>();

async function openWindow(root: string, options: AppEnvOptions = {}): Promise<HeadlessSession> {
    const app = await startHeadlessApp({ root, keepRoot: true, ...options });
    windows.add(app);
    await app.session.waitForReady();
    return app.session;
}

async function closeWindow(session: HeadlessSession): Promise<void> {
    for (const app of windows) {
        if (app.session !== session) continue;
        windows.delete(app);
        await app.dispose();
    }
}

afterAll(async () => {
    await Promise.all([...windows].map((app) => app.dispose()));
});

async function outputOf(session: HeadlessSession, channel: string): Promise<string> {
    try {
        return await session.getOutput(channel);
    } catch {
        // the channel does not exist yet: the extension has not activated (or never will)
        return "";
    }
}

async function waitForProbe(session: HeadlessSession, line: string): Promise<string> {
    return waitUntil(
        () => outputOf(session, PROBE_CHANNEL),
        (text) => text.includes(line),
        { timeoutMs: 30_000, describe: `"${line}" in ${PROBE_CHANNEL}`, diagnose: (last) => String(last) },
    );
}

/** Output lines carry a timestamp and a level (`12:00:00.000 [info] lazy …`): only the probe's own answers, message only. */
function probeAnswers(text: string): string[] {
    return text.split("\n").flatMap((line) => /\blazy (?:version|failed).*$/u.exec(line)?.[0] ?? []);
}

/** Runs the probe command and returns the line it printed: the lazy `require` happens right here. */
async function callProbe(session: HeadlessSession): Promise<string> {
    const before = probeAnswers(await outputOf(session, PROBE_CHANNEL)).length;
    await session.executeCommand("acme.probe.version");
    const text = await waitUntil(
        () => outputOf(session, PROBE_CHANNEL),
        (t) => probeAnswers(t).length > before,
        { timeoutMs: 30_000, describe: "probe command output", diagnose: (last) => String(last) },
    );
    return probeAnswers(text).at(-1) ?? "";
}

async function reloadWindow(session: HeadlessSession): Promise<void> {
    // The process is replaced: the request never gets its answer.
    void session.executeCommand("workbench.action.reloadWindow").catch(() => undefined);
    await session.reconnect(60_000);
    await session.waitForReady();
}

describe("ExtensionUpdates stage 0 — safe version replacement", () => {
    it(
        "US-0.1: an update from another process leaves the running version's directory intact and its lazy require working",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);

            await install(userDataDir, ID, registryV2);

            // What the user sees: the running extension keeps answering from the version it was started on.
            expect(await callProbe(window)).toBe(`lazy version 1.0.0 from ${dirOf("1.0.0")}`);
            expect(await outputOf(window, PROBE_CHANNEL)).not.toContain("lazy failed");
            // What is on disk until the next start.
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
            expect(existsSync(join(extensionsDir(userDataDir), dirOf("1.0.0"), "lazy.js"))).toBe(true);
            expect(readProfile(defaultProfileFile(userDataDir))).toEqual([
                expect.objectContaining({ identifier: { id: ID }, version: "1.1.0", relativeLocation: dirOf("1.1.0") }),
            ]);
            expect(readObsolete(userDataDir)).toEqual({ [dirOf("1.0.0")]: true });
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.2: the next start loads the new version, deletes the old directory and leaves no .obsolete",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            await install(userDataDir, ID, registryV2);

            const window = await openWindow(root);

            await waitForProbe(window, `activated from ${dirOf("1.1.0")}`);
            expect(await callProbe(window)).toBe(`lazy version 1.1.0 from ${dirOf("1.1.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.1.0")]);
            expect(existsSync(obsoleteFile(userDataDir))).toBe(false);
        },
        LIVE_TIMEOUT,
    );

    // The first reload turns the original process into a supervisor that stays alive (restartProcess.ts):
    // whatever protects a live window's directories (decision В1) must not outlive its extension host.
    it(
        "US-0.2: Reload Window after an update loads the new version and deletes the old one",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);
            await install(userDataDir, ID, registryV2);

            await reloadWindow(window);

            await waitForProbe(window, `activated from ${dirOf("1.1.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.1.0")]);
            expect(existsSync(obsoleteFile(userDataDir))).toBe(false);
        },
        LIVE_TIMEOUT,
    );

    for (const chosen of ["1.0.0", "1.1.0"]) {
        it(
            `US-0.3: with 1.0.0 and 1.1.0 on disk the profile entry decides — ${chosen}`,
            async () => {
                const { root, userDataDir } = newRoot();
                await seedVersionDirs(userDataDir, join(root, "seed"), [vsixOf("1.0.0"), vsixOf("1.1.0")]);
                writeProfile(defaultProfileFile(userDataDir), [
                    { identifier: { id: ID }, version: chosen, relativeLocation: dirOf(chosen) },
                ]);

                expect(await listed(userDataDir)).toEqual([`${ID}@${chosen}`]);
                const window = await openWindow(root);
                await waitForProbe(window, `activated from ${dirOf(chosen)}`);
                expect(await callProbe(window)).toBe(`lazy version ${chosen} from ${dirOf(chosen)}`);
            },
            LIVE_TIMEOUT,
        );
    }

    it(
        "US-0.4: uninstall under a live host leaves the directory to the next start, marked in .obsolete",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);

            const uninstall = await cliOk([udd(userDataDir), "--uninstall-extension", ID]);

            expect(uninstall.stdout).toContain(`Uninstalled ${ID}`);
            expect(await listed(userDataDir)).toEqual([]);
            expect(readProfile(defaultProfileFile(userDataDir))).toEqual([]);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0")]);
            expect(readObsolete(userDataDir)).toEqual({ [dirOf("1.0.0")]: true });
            expect(await callProbe(window)).toBe(`lazy version 1.0.0 from ${dirOf("1.0.0")}`);

            await closeWindow(window);
            const next = await openWindow(root);
            expect(await outputOf(next, PROBE_CHANNEL)).toBe("");
            expect(versionDirs(userDataDir, ID)).toEqual([]);
            expect(existsSync(obsoleteFile(userDataDir))).toBe(false);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.4: uninstall from one profile keeps the version another profile uses, unmarked",
        async () => {
            const { userDataDir } = newRoot();
            createNamedProfile(userDataDir, "work");
            await install(userDataDir, ID, registryV1);
            await install(userDataDir, ID, registryV1, "work");

            await cliOk([udd(userDataDir), "--uninstall-extension", ID]);

            expect(await listed(userDataDir)).toEqual([]);
            expect(await listed(userDataDir, "work")).toEqual([`${ID}@1.0.0`]);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0")]);
            expect(obsoleteKeys(userDataDir)).toEqual([]);
        },
        CLI_TIMEOUT,
    );

    it(
        "US-0.5: reinstalling the previous version from the registry unmarks it and reuses its directory",
        async () => {
            const { userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            // Survives only if the directory is reused rather than extracted again.
            const marker = join(extensionsDir(userDataDir), dirOf("1.0.0"), "reuse-marker");
            writeFileSync(marker, "");
            await install(userDataDir, ID, registryV2);
            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.0.0")]);

            const back = await install(userDataDir, ID, registryV1);

            expect(back.stdout).toContain(`Installed ${ID}@1.0.0`);
            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.1.0")]);
            expect(existsSync(marker)).toBe(true);
            expect(await listed(userDataDir)).toEqual([`${ID}@1.0.0`]);
        },
        CLI_TIMEOUT,
    );

    it(
        "US-0.5: a .vsix of the same version replaces the directory and unmarks it; the other version goes on the next start",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, vsixOf("1.0.0"));
            const marker = join(extensionsDir(userDataDir), dirOf("1.0.0"), "reuse-marker");
            writeFileSync(marker, "");
            await install(userDataDir, vsixOf("1.1.0"));
            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.0.0")]);

            await install(userDataDir, vsixOf("1.0.0"));

            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.1.0")]);
            expect(existsSync(join(extensionsDir(userDataDir), dirOf("1.0.0"), "package.json"))).toBe(true);
            expect(existsSync(marker)).toBe(false);
            // Upstream deletes the replaced copy right away; only a failed delete waits for cleanup.
            expect(replacedLeftovers(userDataDir)).toEqual([]);
            expect(await listed(userDataDir)).toEqual([`${ID}@1.0.0`]);

            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0")]);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.5: a dependency left in .obsolete is reused by a new install and unmarked",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            await cliOk([udd(userDataDir), "--uninstall-extension", ID]);
            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.0.0")]);

            const dependent = await createDependentVsix(join(root, "acme.dependent-1.0.0.vsix"));
            await install(userDataDir, dependent, registryV1);

            expect(await listed(userDataDir)).toEqual(["acme.dependent@1.0.0", `${ID}@1.0.0`]);
            expect(obsoleteKeys(userDataDir)).toEqual([]);
            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0")]);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.6: an update in one profile leaves the other profile on the old version",
        async () => {
            const { root, userDataDir } = newRoot();
            createNamedProfile(userDataDir, "work");
            await install(userDataDir, ID, registryV1);
            await install(userDataDir, ID, registryV1, "work");

            await install(userDataDir, ID, registryV2);

            expect(await listed(userDataDir)).toEqual([`${ID}@1.1.0`]);
            expect(await listed(userDataDir, "work")).toEqual([`${ID}@1.0.0`]);
            expect(readProfile(namedProfileFile(userDataDir, "work"))).toEqual([
                expect.objectContaining({ identifier: { id: ID }, version: "1.0.0" }),
            ]);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
            expect(obsoleteKeys(userDataDir)).toEqual([]);

            const window = await openWindow(root, { extraArgs: ["--profile", "work"] });
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);
            // Default still needs 1.1.0: a start in another profile deletes nothing.
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
        },
        LIVE_TIMEOUT,
    );

    /**
     * `it.fails` until the extraction stops crashing the CLI (docs/TESTING.md, "Тесты, ждущие фичу или починку"):
     * `extractExtensionPayload` calls `fs.mkdirSync` inside the `openReadStream` callback, its EEXIST escapes as an
     * uncaught exception, the process dies with a Node stack and no rollback runs — `acme.lib-1.0.0` and the
     * `.vsix-install-*` temp stay on disk, referenced by no profile. Fixed — the test turns red: drop the marker.
     */
    it.fails(
        "US-0.7: a root install failing after its dependencies rolls back only what this call created",
        async () => {
            const { userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);

            const failed = await runCli([udd(userDataDir), `--registry=${registryBroken}`, "--install-extension", ID]);

            expect(failed.code).toBe(1);
            // A failed install is an error message, not a crashed process.
            expect(failed.stderr).not.toContain("Node.js v");
            expect(readdirSync(extensionsDir(userDataDir)).filter((n) => n.startsWith(".vsix-install-"))).toEqual([]);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0")]);
            expect(existsSync(join(extensionsDir(userDataDir), dirOf("1.0.0"), "lazy.js"))).toBe(true);
            expect(versionDirs(userDataDir, "acme.lib")).toEqual([]);
            expect(await listed(userDataDir)).toEqual([`${ID}@1.0.0`]);
            expect(obsoleteKeys(userDataDir)).toEqual([]);
        },
        CLI_TIMEOUT,
    );

    it(
        "US-0.8: deleting a profile marks the versions nobody uses any more; the next start deletes them",
        async () => {
            const { root, userDataDir } = newRoot();
            createNamedProfile(userDataDir, "work");
            await install(userDataDir, ID, registryV1);
            await install(userDataDir, ID, registryV1, "work");
            await install(userDataDir, ID, registryV2);

            const window = await openWindow(root);
            await deleteProfileFromUi(window, "work");

            await waitUntil(
                () => obsoleteKeys(userDataDir),
                (keys) => keys.includes(dirOf("1.0.0")),
                { timeoutMs: 10_000, describe: "1.0.0 marked after the profile is deleted" },
            );
            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.0.0")]);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);

            await closeWindow(window);
            await openWindow(root);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.1.0")]);
            expect(existsSync(obsoleteFile(userDataDir))).toBe(false);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.9: an entry without relativeLocation resolves to <id>-<version>, and the file is not rewritten",
        async () => {
            const { root, userDataDir } = newRoot();
            await seedVersionDirs(userDataDir, join(root, "seed"), [vsixOf("1.0.0"), vsixOf("1.1.0")]);
            const legacy = JSON.stringify([{ identifier: { id: ID }, version: "1.0.0" }]);
            writeFileSync(defaultProfileFile(userDataDir), legacy);

            expect(await listed(userDataDir)).toEqual([`${ID}@1.0.0`]);
            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);
            expect(readFileSync(defaultProfileFile(userDataDir), "utf8")).toBe(legacy);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.9: an entry whose directory is gone falls back to the highest semver on disk, with a warning",
        async () => {
            const { root, userDataDir } = newRoot();
            // 1.10.0 > 1.9.0 only by semver: as strings (and in many readdir orders) it is the other way round.
            await seedVersionDirs(userDataDir, join(root, "seed"), [vsixOf("1.9.0"), vsixOf("1.10.0")]);
            const legacy = JSON.stringify([{ identifier: { id: ID }, version: "1.0.0" }]);
            writeFileSync(defaultProfileFile(userDataDir), legacy);

            expect(await listed(userDataDir)).toEqual([`${ID}@1.10.0`]);
            const window = await openWindow(root);
            await waitForProbe(window, `activated from ${dirOf("1.10.0")}`);
            expect(await outputOf(window, "extensions")).toMatch(/\[warn\].*acme\.probe/iu);
            expect(readFileSync(defaultProfileFile(userDataDir), "utf8")).toBe(legacy);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.10: a corrupt .obsolete logs an error, deletes nothing and the editor starts",
        async () => {
            const { root, userDataDir } = newRoot();
            await seedVersionDirs(userDataDir, join(root, "seed"), [vsixOf("1.0.0"), vsixOf("1.1.0")]);
            writeProfile(defaultProfileFile(userDataDir), [
                { identifier: { id: ID }, version: "1.1.0", relativeLocation: dirOf("1.1.0") },
            ]);
            writeFileSync(obsoleteFile(userDataDir), `["${dirOf("1.0.0")}"]`);

            const window = await openWindow(root);

            await waitForProbe(window, `activated from ${dirOf("1.1.0")}`);
            expect(await outputOf(window, "extensions")).toMatch(/\[error\].*obsolete/iu);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
        },
        LIVE_TIMEOUT,
    );

    // A read-only subdirectory makes the recursive delete fail with EACCES; root ignores permissions.
    const canLockDirectory = process.platform !== "win32" && process.getuid?.() !== 0;
    (canLockDirectory ? it : it.skip)(
        "US-0.10: a directory that fails to delete keeps its key; the others are deleted",
        async () => {
            const { root, userDataDir } = newRoot();
            await seedVersionDirs(userDataDir, join(root, "seed"), [vsixOf("1.0.0"), vsixOf("1.9.0"), vsixOf("1.1.0")]);
            writeProfile(defaultProfileFile(userDataDir), [
                { identifier: { id: ID }, version: "1.1.0", relativeLocation: dirOf("1.1.0") },
            ]);
            writeFileSync(
                obsoleteFile(userDataDir),
                JSON.stringify({ [dirOf("1.0.0")]: true, [dirOf("1.9.0")]: true }),
            );
            const locked = join(extensionsDir(userDataDir), dirOf("1.0.0"));
            chmodSync(locked, 0o555);
            try {
                const window = await openWindow(root);

                await waitForProbe(window, `activated from ${dirOf("1.1.0")}`);
                expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
                expect(readObsolete(userDataDir)).toEqual({ [dirOf("1.0.0")]: true });
                expect(await outputOf(window, "extensions")).toMatch(/\[warn\].*acme\.probe-1\.0\.0/iu);
            } finally {
                chmodSync(locked, 0o755);
            }
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.10: a directory in .obsolete that a profile references again is kept and unmarked",
        async () => {
            const { root, userDataDir } = newRoot();
            await seedVersionDirs(userDataDir, join(root, "seed"), [vsixOf("1.0.0")]);
            writeProfile(defaultProfileFile(userDataDir), [
                { identifier: { id: ID }, version: "1.0.0", relativeLocation: dirOf("1.0.0") },
            ]);
            writeFileSync(obsoleteFile(userDataDir), JSON.stringify({ [dirOf("1.0.0")]: true }));

            const window = await openWindow(root);

            await waitForProbe(window, `activated from ${dirOf("1.0.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0")]);
            expect(existsSync(obsoleteFile(userDataDir))).toBe(false);
        },
        LIVE_TIMEOUT,
    );

    it(
        "US-0.11: the CLI announces a deferred removal, lists the profile's version and deletes nothing itself",
        async () => {
            const { userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);

            const update = await install(userDataDir, ID, registryV2);

            expect(update.stdout).toContain(`Installed ${ID}@1.1.0`);
            expect(update.stdout).toContain("Previous version(s) will be removed on next start: 1.0.0");
            expect(update.stdout).not.toContain("Removed previous version(s)");
            expect(await listed(userDataDir)).toEqual([`${ID}@1.1.0`]);
            // More CLI calls do not run the cleanup: only the editor's start does.
            await cliOk([udd(userDataDir), "--uninstall-extension", ID]);
            await install(userDataDir, ID, registryV2);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
            expect(obsoleteKeys(userDataDir)).toEqual([dirOf("1.0.0")]);
        },
        CLI_TIMEOUT,
    );

    it(
        "US-0.12: a second window started after an update keeps the first window's version until it exits",
        async () => {
            const { root, userDataDir } = newRoot();
            await install(userDataDir, ID, registryV1);
            const first = await openWindow(root);
            await waitForProbe(first, `activated from ${dirOf("1.0.0")}`);
            await install(userDataDir, ID, registryV2);

            const second = await openWindow(root);

            await waitForProbe(second, `activated from ${dirOf("1.1.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.0.0"), dirOf("1.1.0")]);
            expect(await callProbe(first)).toBe(`lazy version 1.0.0 from ${dirOf("1.0.0")}`);

            await closeWindow(first);
            await closeWindow(second);
            const third = await openWindow(root);
            await waitForProbe(third, `activated from ${dirOf("1.1.0")}`);
            expect(versionDirs(userDataDir, ID)).toEqual([dirOf("1.1.0")]);
            expect(existsSync(obsoleteFile(userDataDir))).toBe(false);
        },
        LIVE_TIMEOUT,
    );
});

/** Palette → quick pick of profiles → toggle the one → accept, as the user does it. */
async function deleteProfileFromUi(session: HeadlessSession, profile: string): Promise<void> {
    await session.key("F1");
    await session.waitForNode("#quickInput");
    await session.text("Profiles: Delete Profile");
    await session.waitForText((t) => t.includes("Profiles: Delete Profile"));
    await session.key("Enter");
    await session.waitForText((t) => t.includes("Select Profiles to Delete") && t.includes(profile));
    await session.text(profile);
    await session.key("Space");
    await session.key("Enter");
    await session.waitForNoNode("#quickInput");
}

/** A `.vsix` with an `extensionDependencies` on the probe: its install pulls the probe from the registry. */
async function createDependentVsix(file: string): Promise<string> {
    await writeZip(file, {
        "extension/package.json": JSON.stringify({
            name: "dependent",
            publisher: "acme",
            version: "1.0.0",
            engines: { vscode: "^1.0.0" },
            extensionDependencies: [ID],
        }),
    });
    return file;
}

/**
 * `acme.probe@1.1.0` depends on `acme.lib`, and its archive has a file and a directory under one name: the
 * manifest reads and the sha matches (everything is prepared), but the extraction fails after `acme.lib` is
 * already installed — exactly the rollback US-0.7 is about.
 */
async function createBrokenRegistry(dir: string): Promise<string> {
    await createRegistryFixture(dir, [{ id: "acme.lib", version: "1.0.0", sourceDir: PROBE_SOURCE }]);
    const rel = `artifacts/${ID}-1.1.0.vsix`;
    await writeZip(join(dir, rel), {
        "extension/package.json": JSON.stringify({
            name: "probe",
            publisher: "acme",
            version: "1.1.0",
            engines: { vscode: "^1.0.0" },
            extensionDependencies: ["acme.lib"],
        }),
        "extension/clash": "a file",
        "extension/clash/inside.txt": "and a directory of the same name",
    });
    const sha256 = crypto
        .createHash("sha256")
        .update(readFileSync(join(dir, rel)))
        .digest("hex");
    const engines = { vscode: "^1.0.0" };
    writeFileSync(
        join(dir, "meta", `${ID}.json`),
        JSON.stringify({
            schemaVersion: 1,
            id: ID,
            publisher: "acme",
            name: "probe",
            displayName: "Probe",
            description: "",
            kind: "native",
            versions: [{ version: "1.1.0", engines, artifact: { type: "path", path: rel }, sha256 }],
        }),
    );
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { extensions: unknown[] };
    index.extensions.push({
        id: ID,
        publisher: "acme",
        name: "probe",
        displayName: "Probe",
        description: "",
        kind: "native",
        latest: { version: "1.1.0", engines },
    });
    writeFileSync(join(dir, "index.json"), JSON.stringify(index));
    return dir;
}

function writeZip(file: string, entries: Record<string, string>): Promise<void> {
    return new Promise((resolveZip, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name);
        const out = createWriteStream(file);
        out.on("close", () => {
            resolveZip();
        });
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

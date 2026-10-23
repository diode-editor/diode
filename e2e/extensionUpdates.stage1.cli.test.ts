import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentTargetPlatform } from "../src/vs/platform/extensionManagement/node/targetPlatform.ts";
import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { createNamedProfile } from "./helpers/extensionsDisk.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";

/**
 * Acceptance tests for ExtensionUpdates stage 1 in the CLI (the "stage 1 spec" of the closed tracker,
 * `git show 188ea93e:docs/TODO/ExtensionUpdates.md`): the edge cases around `--install-extension id@version` and the
 * `pinned` rule the implementer's suite does not cover. A test marked `it.fails` is a found bug; the comment names the
 * item of the QA report in PR #785.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(here, "marketplace", "sample-extension");
/** `extensionDependencies: ["test.sample-lang"]`. */
const DEPENDENT = resolve(here, "marketplace", "dependent-extension");
const ID = "test.qa-pin";
const DEP = "test.sample-lang";
const ROOT = "test.lang-pack";

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
        // A test may name its own registry.
        const registryArg = args.some((a) => a.startsWith("--registry=")) ? [] : [`--registry=${registry}`];
        const child = spawn(binary, [`--user-data-dir=${userDataDir}`, ...registryArg, ...args], {
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

interface IEntry {
    identifier: { id: string };
    version: string;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}

function defaultProfileFile(userDataDir: string): string {
    return join(userDataDir, "extensions", "extensions.json");
}

function readEntries(file: string): IEntry[] {
    return JSON.parse(readFileSync(file, "utf8")) as IEntry[];
}

/** Entries as `id@version pinned=…`, sorted by id. */
function describeEntries(file: string): string[] {
    return readEntries(file)
        .map((e) => `${e.identifier.id}@${e.version} pinned=${String(e.metadata?.["pinned"] ?? false)}`)
        .sort();
}

function obsolete(userDataDir: string): string[] {
    const file = join(userDataDir, "extensions", ".obsolete");
    if (!existsSync(file)) return [];
    return Object.keys(JSON.parse(readFileSync(file, "utf8")) as Record<string, true>).sort();
}

let counter = 0;
function freshUserData(): string {
    counter++;
    return join(root, `user-data-${String(counter)}`);
}

describe("CLI id@version edge cases (ExtensionUpdates stage 1 QA)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-stage1-qa-cli-"));
        registry = await createRegistryFixture(join(root, "registry"), [
            { id: ID, version: "1.0.0", sourceDir: SAMPLE },
            { id: ID, version: "1.1.0", sourceDir: SAMPLE },
            { id: DEP, version: "1.0.0", sourceDir: SAMPLE },
            { id: ROOT, version: "1.0.0", sourceDir: DEPENDENT },
            { id: ROOT, version: "1.1.0", sourceDir: DEPENDENT },
        ]);
    }, 300_000);

    afterAll(() => {
        removeTempDir(root);
    });

    // Regression test, QA report #1 (fixed in this PR): the dependencies are passed to `ProfileExtensions.add` as roots, so they get the root's pin.
    it(
        "a dependency installed together with id@version is not pinned (upstream: dependency tasks pinned: false)",
        async () => {
            const userData = freshUserData();

            const install = await runCli(userData, "--install-extension", `${ROOT}@1.0.0`);

            expect(install.code).toBe(0);
            expect(install.stdout).toContain(`Installed ${DEP}@1.0.0 (dependency of ${ROOT})`);
            expect(describeEntries(defaultProfileFile(userData))).toEqual([
                `${ROOT}@1.0.0 pinned=true`,
                `${DEP}@1.0.0 pinned=false`,
            ]);
        },
    );

    // Regression test, QA report #1 (fixed in this PR): the same for a `.vsix` whose dependency comes from the registry.
    it("a dependency pulled by a .vsix is not pinned", async () => {
        const userData = freshUserData();

        const install = await runCli(
            userData,
            "--install-extension",
            join(registry, "artifacts", `${ROOT}-1.1.0.vsix`),
        );

        expect(install.code).toBe(0);
        expect(describeEntries(defaultProfileFile(userData))).toEqual([
            `${ROOT}@1.1.0 pinned=true`,
            `${DEP}@1.0.0 pinned=false`,
        ]);
    });

    it("a plain install with a dependency pins nothing", async () => {
        const userData = freshUserData();

        await runCli(userData, "--install-extension", ROOT);

        expect(describeEntries(defaultProfileFile(userData))).toEqual([
            `${ROOT}@1.1.0 pinned=false`,
            `${DEP}@1.0.0 pinned=false`,
        ]);
    });

    it("a dependency the user pinned keeps its pin when a dependent is installed", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", `${DEP}@1.0.0`);

        await runCli(userData, "--install-extension", ROOT);

        expect(describeEntries(defaultProfileFile(userData))).toEqual([
            `${ROOT}@1.1.0 pinned=false`,
            `${DEP}@1.0.0 pinned=true`,
        ]);
    });

    it("rollback back and forth: each given version is pinned, only the unused one is in .obsolete", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", `${ID}@1.1.0`);
        await runCli(userData, "--install-extension", `${ID}@1.0.0`);
        expect(obsolete(userData)).toEqual([`${ID}-1.1.0`]);

        const forth = await runCli(userData, "--install-extension", `${ID}@1.1.0`);

        expect(forth.code).toBe(0);
        expect(forth.stdout).toContain(`Installed ${ID}@1.1.0`);
        expect(describeEntries(defaultProfileFile(userData))).toEqual([`${ID}@1.1.0 pinned=true`]);
        // 1.1.0 is reused and unmarked (stage 0, US-0.5); 1.0.0 goes.
        expect(obsolete(userData)).toEqual([`${ID}-1.0.0`]);
        const list = await runCli(userData, "--list-extensions");
        expect(list.stdout.trim()).toBe(`${ID}@1.1.0`);
    });

    it("the id in id@version is matched case-insensitively, like a plain id", async () => {
        const userData = freshUserData();
        const plain = await runCli(userData, "--install-extension", ID.toUpperCase());
        const plainOk = plain.code === 0;

        const given = await runCli(freshUserData(), "--install-extension", `${ID.toUpperCase()}@1.0.0`);

        // Whatever the registry decides about the case, both forms decide the same.
        expect(given.code === 0).toBe(plainOk);
    });

    it("the same version given in another case is still 'already installed', not a reinstall", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", `${ID}@1.0.0`);

        const again = await runCli(userData, "--install-extension", `${ID.toUpperCase()}@1.0.0`);

        expect(again.code).toBe(0);
        expect(again.stdout).toContain("is already installed.");
        expect(describeEntries(defaultProfileFile(userData))).toEqual([`${ID}@1.0.0 pinned=true`]);
    });

    it("a version that is not semver (`@latest`, `@1.0`) is part of the id, like upstream: not found, nothing installed", async () => {
        const userData = freshUserData();

        const latest = await runCli(userData, "--install-extension", `${ID}@latest`);
        const short = await runCli(userData, "--install-extension", `${ID}@1.0`);

        expect(latest.code).toBe(1);
        expect(latest.stderr).toContain(`${ID}@latest`);
        expect(short.code).toBe(1);
        expect(existsSync(defaultProfileFile(userData)) ? readEntries(defaultProfileFile(userData)) : []).toEqual([]);
    });

    it("US-1.9: id@version in profile B leaves profile A's entry and its version on disk alone", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", ID);
        createNamedProfile(userData, "B");
        await runCli(userData, "--profile", "B", "--install-extension", ID);

        const rollback = await runCli(userData, "--profile", "B", "--install-extension", `${ID}@1.0.0`);

        expect(rollback.code).toBe(0);
        expect(describeEntries(defaultProfileFile(userData))).toEqual([`${ID}@1.1.0 pinned=false`]);
        const listB = await runCli(userData, "--profile", "B", "--list-extensions");
        expect(listB.stdout.trim()).toBe(`${ID}@1.0.0`);
        // Profile A still uses 1.1.0: nothing is marked.
        expect(obsolete(userData)).toEqual([]);
    });

    it("US-1.8: uninstall drops the pin; a plain install after it is not pinned", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", `${ID}@1.0.0`);

        const uninstall = await runCli(userData, "--uninstall-extension", ID);
        await runCli(userData, "--install-extension", ID);

        expect(uninstall.code).toBe(0);
        expect(describeEntries(defaultProfileFile(userData))).toEqual([`${ID}@1.1.0 pinned=false`]);
    });

    it("the other metadata fields and unknown entry fields survive a rollback and an update", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", ID);
        const file = defaultProfileFile(userData);
        const [entry] = readEntries(file);
        writeFileSync(
            file,
            JSON.stringify([{ ...entry, extra: "kept", metadata: { installedTimestamp: 42, source: "gallery" } }]),
        );

        await runCli(userData, "--install-extension", `${ID}@1.0.0`);
        const afterRollback = readEntries(file)[0];
        await runCli(userData, "--install-extension", ID);
        const afterUpdate = readEntries(file)[0];

        expect(afterRollback).toMatchObject({
            version: "1.0.0",
            extra: "kept",
            metadata: { installedTimestamp: 42, source: "gallery", pinned: true },
        });
        expect(afterUpdate).toMatchObject({
            version: "1.1.0",
            extra: "kept",
            metadata: { installedTimestamp: 42, source: "gallery", pinned: true },
        });
    });

    it("an explicit pinned: false in the entry is kept as not pinned by a plain update", async () => {
        const userData = freshUserData();
        await runCli(userData, "--install-extension", `${ID}@1.0.0`);
        const file = defaultProfileFile(userData);
        const [entry] = readEntries(file);
        writeFileSync(file, JSON.stringify([{ ...entry, metadata: { pinned: false } }]));

        await runCli(userData, "--install-extension", ID);

        expect(describeEntries(file)).toEqual([`${ID}@1.1.0 pinned=false`]);
    });

    it("US-1.13: a broken artifact for id@version changes neither the disk nor the profile", async () => {
        const broken = join(root, "broken-registry");
        await createRegistryFixture(broken, [
            { id: ID, version: "1.0.0", sourceDir: SAMPLE, corruptSha: true },
            { id: ID, version: "1.1.0", sourceDir: SAMPLE },
        ]);
        const userData = freshUserData();
        await runCli(userData, "--install-extension", ID);
        const before = readFileSync(defaultProfileFile(userData), "utf8");

        const rollback = await runCli(userData, `--registry=${broken}`, "--install-extension", `${ID}@1.0.0`);

        expect(rollback.code).toBe(1);
        expect(rollback.stderr).toContain("sha256 mismatch");
        expect(readFileSync(defaultProfileFile(userData), "utf8")).toBe(before);
        expect(existsSync(join(userData, "extensions", `${ID}-1.0.0`))).toBe(false);
        expect(obsolete(userData)).toEqual([]);
    });

    it("US-1.10: a version published only for another platform is an error naming the available ones", async () => {
        const platformRegistry = join(root, "platform-registry");
        await createRegistryFixture(platformRegistry, [{ id: ID, version: "1.1.0", sourceDir: SAMPLE }]);
        const metaFile = join(platformRegistry, "meta", `${ID}.json`);
        const meta = JSON.parse(readFileSync(metaFile, "utf8")) as { versions: Record<string, unknown>[] };
        const universal = meta.versions[0]!;
        const foreign = process.platform === "win32" ? "linux-x64" : "win32-x64";
        meta.versions.push({ ...universal, version: "1.0.0", targetPlatform: foreign });
        writeFileSync(metaFile, JSON.stringify(meta));
        const userData = freshUserData();

        const install = await runCli(userData, `--registry=${platformRegistry}`, "--install-extension", `${ID}@1.0.0`);

        expect(install.code).toBe(1);
        expect(install.stderr).toContain(`Extension "${ID}" has no version 1.0.0 for this host`);
        expect(existsSync(defaultProfileFile(userData)) ? readEntries(defaultProfileFile(userData)) : []).toEqual([]);
    });

    // Regression test, QA report #3 (fixed in this PR): an exact version takes the FIRST record of that version for the host (`find`), not the platform
    // one over universal like `resolveCompatibleVersion` and the picker (`compatibleVersions`) do.
    it.skipIf(currentTargetPlatform() === undefined)(
        "US-1.10: id@version takes the host platform's record over the universal one, like a plain install",
        async () => {
            const platformRegistry = join(root, "universal-and-platform-registry");
            // The universal record is listed first and is broken: taking it is the bug.
            await createRegistryFixture(platformRegistry, [
                { id: ID, version: "1.0.0", sourceDir: SAMPLE, corruptSha: true },
            ]);
            const metaFile = join(platformRegistry, "meta", `${ID}.json`);
            const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
                versions: { artifact: { path: string } }[];
            };
            const universal = meta.versions[0]!;
            const sha256 = createHash("sha256")
                .update(readFileSync(join(platformRegistry, universal.artifact.path)))
                .digest("hex");
            meta.versions.push({ ...universal, sha256, targetPlatform: currentTargetPlatform() } as typeof universal);
            writeFileSync(metaFile, JSON.stringify(meta));

            const plain = await runCli(freshUserData(), `--registry=${platformRegistry}`, "--install-extension", ID);
            const given = await runCli(
                freshUserData(),
                `--registry=${platformRegistry}`,
                "--install-extension",
                `${ID}@1.0.0`,
            );

            expect(plain.code).toBe(0);
            expect(given.stderr).toBe("");
            expect(given.code).toBe(0);
            expect(given.stdout).toContain(`Installed ${ID}@1.0.0`);
        },
    );
});

import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { currentTargetPlatform } from "../src/vs/platform/extensionManagement/node/targetPlatform.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";

/**
 * The wiring cliArgs → main → FileExtensionRegistrySource → installFromRegistry and the lazy
 * `import("yauzl")` in SEA — unit tests cover these modules only in isolation.
 */

interface CliResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function runCli(binary: string, args: readonly string[], cwd?: string): Promise<CliResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], cwd });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
        child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}

function buildVsix(vsixPath: string, entries: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        for (const [name, content] of Object.entries(entries)) {
            zip.addBuffer(Buffer.from(content), name);
        }
        const out = fs.createWriteStream(vsixPath);
        out.on("close", () => resolve());
        out.on("error", reject);
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

describe("SEA binary — install from file registry", () => {
    let binary: string;
    let tempRoot: string;
    let registryDir: string;
    let userDataDir: string;

    beforeAll(async () => {
        binary = await getBinaryPath();
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-registry-e2e-"));
        registryDir = path.join(tempRoot, "registry");
        userDataDir = path.join(tempRoot, "user-data-root");

        // Registry directory in the published format of the registry repository.
        const artifactRel = "artifacts/acme.demo-1.2.3.vsix";
        await fs.promises.mkdir(path.join(registryDir, "artifacts"), { recursive: true });
        await fs.promises.mkdir(path.join(registryDir, "meta"), { recursive: true });
        const vsixPath = path.join(registryDir, artifactRel);
        await buildVsix(vsixPath, {
            "extension/package.json": JSON.stringify({
                name: "demo",
                publisher: "acme",
                version: "1.2.3",
                engines: { vscode: "^1.100.0" },
            }),
            "extension.vsixmanifest": "<PackageManifest/>",
        });
        const sha256 = crypto
            .createHash("sha256")
            .update(await fs.promises.readFile(vsixPath))
            .digest("hex");
        await fs.promises.writeFile(
            path.join(registryDir, "meta", "acme.demo.json"),
            JSON.stringify({
                schemaVersion: 1,
                id: "acme.demo",
                publisher: "acme",
                name: "demo",
                displayName: "Demo",
                description: "Demo extension",
                kind: "native",
                versions: [
                    {
                        version: "1.2.3",
                        engines: { vscode: "^1.100.0" },
                        artifact: { type: "path", path: artifactRel },
                        sha256,
                    },
                ],
            }),
        );
        // Platform-specific records of one version: the CURRENT target with a real artifact and a foreign
        // one with a broken path. Installs only if main.ts actually passes the host's targetPlatform
        // to resolution — unit tests pass it by hand.
        const hostTarget = currentTargetPlatform();
        if (hostTarget !== undefined) {
            const platformedRel = `artifacts/acme.platformed-2.0.0@${hostTarget}.vsix`;
            const platformedVsix = path.join(registryDir, platformedRel);
            await buildVsix(platformedVsix, {
                "extension/package.json": JSON.stringify({
                    name: "platformed",
                    publisher: "acme",
                    version: "2.0.0",
                    engines: { vscode: "^1.100.0" },
                }),
                "extension.vsixmanifest": "<PackageManifest/>",
            });
            const platformedSha = crypto
                .createHash("sha256")
                .update(await fs.promises.readFile(platformedVsix))
                .digest("hex");
            await fs.promises.writeFile(
                path.join(registryDir, "meta", "acme.platformed.json"),
                JSON.stringify({
                    schemaVersion: 1,
                    id: "acme.platformed",
                    publisher: "acme",
                    name: "platformed",
                    displayName: "Platformed",
                    description: "Platform-specific artifacts",
                    kind: "native",
                    versions: [
                        {
                            version: "2.0.0",
                            engines: { vscode: "^1.100.0" },
                            artifact: { type: "path", path: platformedRel },
                            sha256: platformedSha,
                            targetPlatform: hostTarget,
                        },
                        {
                            version: "2.0.0",
                            engines: { vscode: "^1.100.0" },
                            artifact: { type: "path", path: "artifacts/does-not-exist.vsix" },
                            sha256: "0".repeat(64),
                            targetPlatform: hostTarget === "darwin-arm64" ? "linux-x64" : "darwin-arm64",
                        },
                    ],
                }),
            );
        }
    }, 180_000);

    afterAll(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    it.skipIf(currentTargetPlatform() === undefined)(
        "platform-specific record of the host's target is picked over the foreign one",
        async () => {
            const userData = path.join(tempRoot, "user-data-platformed");
            const install = await runCli(binary, [
                "--user-data-dir",
                userData,
                "--registry",
                registryDir,
                "--install-extension",
                "acme.platformed",
            ]);
            expect(install.stderr).toBe("");
            expect(install.code).toBe(0);
            expect(install.stdout).toContain("Installed acme.platformed@2.0.0");
            expect(fs.existsSync(path.join(userData, "extensions", "acme.platformed-2.0.0", "package.json"))).toBe(
                true,
            );
        },
    );

    it("installs by id from --registry and lists it", async () => {
        const install = await runCli(binary, [
            "--user-data-dir",
            userDataDir,
            "--registry",
            registryDir,
            "--install-extension",
            "acme.demo",
        ]);
        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain("Installed acme.demo@1.2.3");

        // The layout scanExtensions expects.
        expect(fs.existsSync(path.join(userDataDir, "extensions", "acme.demo-1.2.3", "package.json"))).toBe(true);

        const list = await runCli(binary, ["--user-data-dir", userDataDir, "--list-extensions"]);
        expect(list.code).toBe(0);
        expect(list.stdout.trim()).toBe("acme.demo@1.2.3");
    });

    it("id is not shadowed by a same-named file in the working directory", async () => {
        // Discrimination is strictly by the .vsix suffix: a nearby `acme.demo` file must not
        // hijack the install from the registry.
        const cwd = path.join(tempRoot, "cwd-with-decoy");
        await fs.promises.mkdir(cwd, { recursive: true });
        await fs.promises.writeFile(path.join(cwd, "acme.demo"), "not a vsix at all");
        const userData = path.join(tempRoot, "user-data-decoy");

        const install = await runCli(
            binary,
            ["--user-data-dir", userData, "--registry", registryDir, "--install-extension", "acme.demo"],
            cwd,
        );
        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain("Installed acme.demo@1.2.3");
    });

    /** Publishes to the file registry a single-version `1.0.0` extension with manifest fields `extra`. */
    async function publish(
        id: string,
        extra: Record<string, unknown>,
        engines: Record<string, string> = { vscode: "*" },
    ): Promise<void> {
        const [publisher, name] = id.split(".");
        const rel = `artifacts/${id}-1.0.0.vsix`;
        const vsix = path.join(registryDir, rel);
        await buildVsix(vsix, {
            "extension/package.json": JSON.stringify({ name, publisher, version: "1.0.0", ...extra }),
        });
        const sha256 = crypto
            .createHash("sha256")
            .update(await fs.promises.readFile(vsix))
            .digest("hex");
        await fs.promises.writeFile(
            path.join(registryDir, "meta", `${id}.json`),
            JSON.stringify({
                schemaVersion: 1,
                id,
                publisher,
                name,
                displayName: name,
                description: "",
                kind: "native",
                versions: [{ version: "1.0.0", engines, artifact: { type: "path", path: rel }, sha256 }],
            }),
        );
    }

    it("installs extensionDependencies along with the extension; a dependency missing from the registry is a warning", async () => {
        await publish("acme.plugin", { extensionDependencies: ["acme.demo", "acme.absent"] });
        const userData = path.join(tempRoot, "user-data-deps");

        const install = await runCli(binary, [
            "--user-data-dir",
            userData,
            "--registry",
            registryDir,
            "--install-extension",
            "acme.plugin",
        ]);

        expect(install.code).toBe(0);
        expect(install.stdout).toContain("Installed acme.plugin@1.0.0");
        expect(install.stdout).toContain("Installed acme.demo@1.2.3 (dependency of acme.plugin)");
        expect(install.stderr).toContain(
            'Warning: acme.plugin depends on "acme.absent", which is not in the registry — acme.plugin will not activate until it is installed',
        );
        const list = await runCli(binary, ["--user-data-dir", userData, "--list-extensions"]);
        expect(list.stdout.trim().split(/\r?\n/u)).toEqual(["acme.demo@1.2.3", "acme.plugin@1.0.0"]);
    });

    it(".vsix with extensionDependencies pulls them from --registry", async () => {
        const vsix = path.join(tempRoot, "acme.local-1.0.0.vsix");
        await buildVsix(vsix, {
            "extension/package.json": JSON.stringify({
                name: "local",
                publisher: "acme",
                version: "1.0.0",
                extensionDependencies: ["acme.demo"],
            }),
        });
        const userData = path.join(tempRoot, "user-data-vsix-deps");

        const install = await runCli(binary, [
            "--user-data-dir",
            userData,
            "--registry",
            registryDir,
            "--install-extension",
            vsix,
        ]);

        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        expect(install.stdout).toContain("Installed acme.local@1.0.0");
        expect(install.stdout).toContain("Installed acme.demo@1.2.3 (dependency of acme.local)");
    });

    it(".vsix whose dependency cannot be installed is still installed, with a warning", async () => {
        // The registry entry requires a future vscode — there is no compatible version.
        await publish("acme.future", {}, { vscode: "^99.0.0" });
        const vsix = path.join(tempRoot, "acme.needsfuture-1.0.0.vsix");
        await buildVsix(vsix, {
            "extension/package.json": JSON.stringify({
                name: "needsfuture",
                publisher: "acme",
                version: "1.0.0",
                extensionDependencies: ["acme.future"],
            }),
        });
        const userData = path.join(tempRoot, "user-data-vsix-bad-dep");

        const install = await runCli(binary, [
            "--user-data-dir",
            userData,
            "--registry",
            registryDir,
            "--install-extension",
            vsix,
        ]);

        expect(install.code).toBe(0);
        expect(install.stdout).toContain("Installed acme.needsfuture@1.0.0");
        expect(install.stderr).toContain(
            'Warning: Cannot install acme.needsfuture: its dependency "acme.future" cannot be installed',
        );
        const list = await runCli(binary, ["--user-data-dir", userData, "--list-extensions"]);
        expect(list.stdout.trim()).toBe("acme.needsfuture@1.0.0");
    });

    // semver is a lazy chunk (`lazy/semver.cjs`): it is not in main.cjs, and a
    // fallback import("semver") would fail in SEA. The version pick below is parsing
    // meta versions (semver.valid), matching engines (satisfies) and comparing (gt)
    // entirely inside the binary: the right version proves the chunk
    // loaded and computes correctly.
    it("picks the highest version whose engines match this build, skipping a newer incompatible one", async () => {
        const id = "acme.versioned";
        const versions = [
            { version: "1.0.0", engines: { vscode: "^1.0.0" } },
            { version: "1.10.0", engines: { vscode: ">=1.0.0 <99.0.0" } },
            { version: "1.9.0", engines: { vscode: "*" } },
            { version: "2.0.0", engines: { vscode: "^99.0.0" } },
        ];
        const records = [];
        for (const { version, engines } of versions) {
            const rel = `artifacts/${id}-${version}.vsix`;
            const vsix = path.join(registryDir, rel);
            await buildVsix(vsix, {
                "extension/package.json": JSON.stringify({ name: "versioned", publisher: "acme", version }),
            });
            const sha256 = crypto
                .createHash("sha256")
                .update(await fs.promises.readFile(vsix))
                .digest("hex");
            records.push({ version, engines, artifact: { type: "path", path: rel }, sha256 });
        }
        await fs.promises.writeFile(
            path.join(registryDir, "meta", `${id}.json`),
            JSON.stringify({
                schemaVersion: 1,
                id,
                publisher: "acme",
                name: "versioned",
                displayName: "Versioned",
                description: "",
                kind: "native",
                versions: records,
            }),
        );
        const userData = path.join(tempRoot, "user-data-versioned");

        const install = await runCli(binary, [
            "--user-data-dir",
            userData,
            "--registry",
            registryDir,
            "--install-extension",
            id,
        ]);

        expect(install.stderr).toBe("");
        expect(install.code).toBe(0);
        // 1.10.0 > 1.9.0 only by semver (as strings it would be the reverse); 2.0.0 is cut off by engines.
        expect(install.stdout).toContain(`Installed ${id}@1.10.0`);
        const list = await runCli(binary, ["--user-data-dir", userData, "--list-extensions"]);
        expect(list.stdout.trim()).toBe(`${id}@1.10.0`);
    });

    /** Publishes `versions` of `acme.updated` (the meta lists exactly these); returns each artifact path. */
    async function publishUpdated(versions: readonly string[]): Promise<Record<string, string>> {
        const records = [];
        const artifacts: Record<string, string> = {};
        for (const version of versions) {
            const rel = `artifacts/acme.updated-${version}.vsix`;
            const vsix = path.join(registryDir, rel);
            await buildVsix(vsix, {
                "extension/package.json": JSON.stringify({ name: "updated", publisher: "acme", version }),
            });
            const sha256 = crypto
                .createHash("sha256")
                .update(await fs.promises.readFile(vsix))
                .digest("hex");
            records.push({ version, engines: { vscode: "*" }, artifact: { type: "path", path: rel }, sha256 });
            artifacts[version] = vsix;
        }
        await fs.promises.writeFile(
            path.join(registryDir, "meta", "acme.updated.json"),
            JSON.stringify({
                schemaVersion: 1,
                id: "acme.updated",
                publisher: "acme",
                name: "updated",
                displayName: "Updated",
                description: "",
                kind: "native",
                versions: records,
            }),
        );
        return artifacts;
    }

    it("ExtensionUpdates stage 0: an update keeps the previous version until the next editor start; the CLI deletes nothing", async () => {
        const userData = path.join(tempRoot, "user-data-updated");
        const extensionsDir = path.join(userData, "extensions");
        const obsolete = (): unknown => JSON.parse(fs.readFileSync(path.join(extensionsDir, ".obsolete"), "utf8"));
        const versionDirs = (): string[] =>
            fs
                .readdirSync(extensionsDir, { withFileTypes: true })
                .filter((e) => e.isDirectory() && !e.name.startsWith("."))
                .map((e) => e.name)
                .sort();
        const cli = (...args: string[]) => runCli(binary, ["--user-data-dir", userData, "--registry", registryDir, ...args]);
        await publishUpdated(["1.0.0"]);
        expect((await cli("--install-extension", "acme.updated")).stdout).toContain("Installed acme.updated@1.0.0");

        // US-0.1 via the CLI: the new version lands next to the old one.
        const artifacts = await publishUpdated(["1.0.0", "1.1.0"]);
        const update = await cli("--install-extension", "acme.updated");
        expect(update.stderr).toBe("");
        expect(update.code).toBe(0);
        expect(update.stdout).toContain("Installed acme.updated@1.1.0");
        expect(update.stdout).toContain("Previous version(s) will be removed on next start: 1.0.0");
        expect(update.stdout).not.toContain("Removed previous version");
        expect(versionDirs()).toEqual(["acme.updated-1.0.0", "acme.updated-1.1.0"]);
        expect(obsolete()).toEqual({ "acme.updated-1.0.0": true });
        // US-0.11: the profile's version, not whichever directory comes first.
        expect((await cli("--list-extensions")).stdout.trim()).toBe("acme.updated@1.1.0");
        // The CLI never cleans up (decision V1): both versions are still there.
        expect(versionDirs()).toEqual(["acme.updated-1.0.0", "acme.updated-1.1.0"]);

        // US-0.5: back to the marked version from a .vsix — it is unmarked, the replaced one is marked.
        const back = await cli("--install-extension", artifacts["1.0.0"]!);
        expect(back.code).toBe(0);
        expect(back.stdout).toContain("Installed acme.updated@1.0.0");
        expect(back.stdout).toContain("Previous version(s) will be removed on next start: 1.1.0");
        expect(obsolete()).toEqual({ "acme.updated-1.1.0": true });
        expect((await cli("--list-extensions")).stdout.trim()).toBe("acme.updated@1.0.0");

        // US-0.4: uninstall marks instead of deleting.
        const uninstall = await cli("--uninstall-extension", "acme.updated");
        expect(uninstall.code).toBe(0);
        expect(versionDirs()).toEqual(["acme.updated-1.0.0", "acme.updated-1.1.0"]);
        expect(obsolete()).toEqual({ "acme.updated-1.0.0": true, "acme.updated-1.1.0": true });
        expect((await cli("--list-extensions")).stdout.trim()).toBe("");
    });

    it("unknown id fails with a registry error", async () => {
        const res = await runCli(binary, [
            "--user-data-dir",
            userDataDir,
            "--registry",
            registryDir,
            "--install-extension",
            "acme.nosuch",
        ]);
        expect(res.code).toBe(1);
        expect(res.stderr).toMatch(/not found in registry/);
    });
});

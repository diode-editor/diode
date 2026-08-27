import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";

/**
 * E2E установки из файлового реестра (`--registry <dir> --install-extension <id>`)
 * против собранного SEA-бинаря. Юниты покрывают модули по отдельности; здесь
 * проверяется склейка cliArgs → main → FileExtensionRegistrySource →
 * installFromRegistry и ленивый `import("yauzl")` на новом кодовом пути в SEA.
 */

interface CliResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

function runCli(binary: string, args: readonly string[]): Promise<CliResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
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

        // Каталог реестра в публикуемом формате registry-репозитория.
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
        const sha256 = crypto.createHash("sha256").update(await fs.promises.readFile(vsixPath)).digest("hex");
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
    }, 180_000);

    afterAll(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

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

        // Layout, который ждёт scanExtensions.
        expect(fs.existsSync(path.join(userDataDir, "extensions", "acme.demo-1.2.3", "package.json"))).toBe(true);

        const list = await runCli(binary, ["--user-data-dir", userDataDir, "--list-extensions"]);
        expect(list.code).toBe(0);
        expect(list.stdout.trim()).toBe("acme.demo@1.2.3");
    });

    it("install by id without --registry fails with a clear message", async () => {
        const res = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", "acme.unknown"]);
        expect(res.code).toBe(1);
        expect(res.stderr).toMatch(/requires --registry/);
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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { REGISTRY_SCHEMA_VERSION, type IRegistryEngines } from "../common/registryFormat.ts";
import type { IHostVersions } from "../common/resolveCompatibleVersion.ts";
import { listInstalledExtensions } from "./extensionInstaller.ts";
import { FileExtensionRegistrySource } from "./fileRegistrySource.ts";
import { installFromRegistry, sha256File } from "./installFromRegistry.ts";

const HOST: IHostVersions = { diode: "0.3.0", vscode: "1.127.0" };

/** Собирает `.vsix` (zip) с манифестом расширения и возвращает его байты. */
function buildVsixBuffer(manifest: object): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "extension/package.json");
        const chunks: Buffer[] = [];
        zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
        zip.outputStream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        zip.outputStream.on("error", reject);
        zip.end();
    });
}

interface IVersionSeed {
    readonly version: string;
    readonly engines: IRegistryEngines;
    readonly manifest?: object;
    /** Подменить sha256 в записи реестра (для mismatch-кейса). */
    readonly sha256?: string;
}

describe("installFromRegistry", () => {
    let tempRoot: string;
    let registryDir: string;
    let extensionsDir: string;

    beforeEach(async () => {
        tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-registry-test-"));
        registryDir = path.join(tempRoot, "registry");
        extensionsDir = path.join(tempRoot, "extensions");
        await fs.promises.mkdir(path.join(registryDir, "meta"), { recursive: true });
        await fs.promises.mkdir(path.join(registryDir, "artifacts"), { recursive: true });
    });

    afterEach(async () => {
        await fs.promises.rm(tempRoot, { recursive: true, force: true });
    });

    /** Кладёт в каталог реестра мету расширения и `.vsix`-артефакты его версий. */
    async function seedExtension(publisher: string, name: string, versions: readonly IVersionSeed[]): Promise<void> {
        const id = `${publisher}.${name}`;
        const versionRecords = [];
        for (const seed of versions) {
            const relPath = `artifacts/${id}-${seed.version}.vsix`;
            const vsix = await buildVsixBuffer(seed.manifest ?? { publisher, name, version: seed.version });
            await fs.promises.writeFile(path.join(registryDir, relPath), vsix);
            versionRecords.push({
                version: seed.version,
                engines: seed.engines,
                artifact: { type: "path", path: relPath },
                sha256: seed.sha256 ?? (await sha256File(path.join(registryDir, relPath))),
            });
        }
        const meta = {
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            id,
            publisher,
            name,
            displayName: name,
            description: "",
            kind: "native",
            versions: versionRecords,
        };
        await fs.promises.writeFile(path.join(registryDir, "meta", `${id}.json`), JSON.stringify(meta));
    }

    function source(): FileExtensionRegistrySource {
        return new FileExtensionRegistrySource(registryDir);
    }

    it("устанавливает наивысшую совместимую версию, listInstalledExtensions её видит", async () => {
        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { vscode: "^1.90.0" } },
            { version: "1.2.0", engines: { vscode: "^1.90.0" } },
            { version: "2.0.0", engines: { vscode: "^99.0.0" } },
        ]);

        const result = await installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST });

        expect(result).toEqual({ id: "acme.hello", version: "1.2.0", previous: [] });
        expect(listInstalledExtensions(extensionsDir).map((e) => `${e.id}@${e.version}`)).toEqual(["acme.hello@1.2.0"]);
    });

    it("апгрейд: прежняя версия сносится после успешной установки новой", async () => {
        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { vscode: "*" } },
            { version: "1.1.0", engines: { vscode: "*" } },
        ]);
        const first = await installFromRegistry(source(), "acme.hello", {
            extensionsDir,
            host: HOST,
            version: "1.0.0",
        });
        expect(first.version).toBe("1.0.0");

        const second = await installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST });

        expect(second).toEqual({ id: "acme.hello", version: "1.1.0", previous: ["1.0.0"] });
        expect(listInstalledExtensions(extensionsDir).map((e) => e.version)).toEqual(["1.1.0"]);
    });

    it("точная запрошенная версия ставится, даже если есть выше", async () => {
        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { vscode: "*" } },
            { version: "1.1.0", engines: { vscode: "*" } },
        ]);
        const result = await installFromRegistry(source(), "acme.hello", {
            extensionsDir,
            host: HOST,
            version: "1.0.0",
        });
        expect(result.version).toBe("1.0.0");
    });

    it("запрошенной версии нет — ошибка с перечислением имеющихся через запятую", async () => {
        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { vscode: "*" } },
            { version: "1.1.0", engines: { vscode: "*" } },
        ]);
        await expect(
            installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST, version: "9.9.9" }),
        ).rejects.toThrow(/no version 9\.9\.9 .*available: 1\.0\.0, 1\.1\.0/);
    });

    it("нет совместимой версии — ошибка перечисляет версии и их engines", async () => {
        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { diode: "^9.0.0", vscode: "^1.90.0" } },
            { version: "1.1.0", engines: { vscode: "^99.0.0" } },
            { version: "1.2.0", engines: { diode: "^9.0.0" } },
        ]);
        await expect(installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST })).rejects.toThrow(
            /no version compatible .*diode 0\.3\.0, vscode 1\.127\.0.*1\.0\.0 \(diode \^9\.0\.0, vscode \^1\.90\.0\), 1\.1\.0 \(vscode \^99\.0\.0\), 1\.2\.0 \(diode \^9\.0\.0\)/,
        );
        expect(listInstalledExtensions(extensionsDir)).toEqual([]);
    });

    it("неизвестный id — ошибка «not found in registry»", async () => {
        await expect(installFromRegistry(source(), "acme.unknown", { extensionsDir, host: HOST })).rejects.toThrow(
            /"acme\.unknown" not found in registry/,
        );
    });

    it("sha256 mismatch — отказ, ничего не установлено", async () => {
        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { vscode: "*" }, sha256: "b".repeat(64) },
        ]);
        await expect(installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST })).rejects.toThrow(
            /sha256 mismatch .*refusing to install/,
        );
        expect(listInstalledExtensions(extensionsDir)).toEqual([]);
    });

    // Временный каталог заводится в os.tmpdir() (не в extensionsDir, где свой temp
    // держит installVsix) и обязан убираться на обоих исходах.
    it.each([
        ["успешной установки", "1.0.0", false],
        ["провалившейся установки", "b".repeat(64), true],
    ] satisfies [string, string, boolean][])("temp-каталог не остаётся после %s", async (_label, seedSha, fails) => {
        const countTempDirs = async (): Promise<number> =>
            (await fs.promises.readdir(os.tmpdir())).filter((e) => e.startsWith("diode-registry-install-")).length;

        await seedExtension("acme", "hello", [
            { version: "1.0.0", engines: { vscode: "*" }, sha256: fails ? seedSha : undefined },
        ]);
        const before = await countTempDirs();

        const install = installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST });
        if (fails) {
            await expect(install).rejects.toThrow();
        } else {
            await install;
        }

        expect(await countTempDirs()).toBe(before);
    });

    it("реестр указывает на чужой .vsix — установка откатывается", async () => {
        // Манифест внутри артефакта принадлежит другому расширению.
        await seedExtension("acme", "hello", [
            {
                version: "1.0.0",
                engines: { vscode: "*" },
                manifest: { publisher: "evil", name: "impostor", version: "1.0.0" },
            },
        ]);
        await expect(installFromRegistry(source(), "acme.hello", { extensionsDir, host: HOST })).rejects.toThrow(
            /points to a \.vsix of "evil\.impostor" — installation rolled back/,
        );
        expect(listInstalledExtensions(extensionsDir)).toEqual([]);
    });
});

describe("sha256File", () => {
    it("считает sha256 содержимого файла", async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-sha-"));
        try {
            const file = path.join(dir, "data.bin");
            await fs.promises.writeFile(file, "hello");
            // Известный sha256("hello").
            await expect(sha256File(file)).resolves.toBe(
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            );
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });

    it("несуществующий файл — reject", async () => {
        await expect(sha256File("/nonexistent/definitely-missing")).rejects.toThrow();
    });
});

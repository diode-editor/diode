import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import { type IRegistryEngines, REGISTRY_SCHEMA_VERSION } from "../common/registryFormat.ts";
import type { IHostVersions } from "../common/resolveCompatibleVersion.ts";

import { listInstalledExtensions } from "./extensionInstaller.ts";
import { FileExtensionRegistrySource } from "./fileRegistrySource.ts";
import {
    describeDependencyInstall,
    installDependenciesFromRegistry,
    installFromRegistry,
    sha256File,
} from "./installFromRegistry.ts";

/**
 * `extensionDependencies` при установке из реестра — как VS Code
 * (`getAllDepsAndPackExtensions`): зависимости ставятся следом без вопросов,
 * транзитивно; уже установленные не трогаются; нет в реестре — расширение
 * всё равно ставится (отказ будет на активации); найдена, но поставить нельзя —
 * отказ, и диск не тронут.
 */

const HOST: IHostVersions = { diode: "0.3.0", vscode: "1.127.0" };

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

interface ISeed {
    readonly version?: string;
    readonly engines?: IRegistryEngines;
    /** Поля манифеста поверх `publisher`/`name`/`version` (зависимости — здесь). */
    readonly manifest?: Record<string, unknown>;
    /** Подменить sha256 в записи реестра. */
    readonly sha256?: string;
}

let tempRoot: string;
let registryDir: string;
let extensionsDir: string;

beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "diode-registry-deps-"));
    registryDir = path.join(tempRoot, "registry");
    extensionsDir = path.join(tempRoot, "extensions");
    await fs.promises.mkdir(path.join(registryDir, "meta"), { recursive: true });
    await fs.promises.mkdir(path.join(registryDir, "artifacts"), { recursive: true });
});

afterEach(async () => {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

/** Кладёт в реестр версии расширения `id` (`publisher.name`). */
async function seed(id: string, ...seeds: ISeed[]): Promise<void> {
    const [publisher, name] = id.split(".");
    const versions = [];
    for (const one of seeds.length === 0 ? [{}] : seeds) {
        const version = one.version ?? "1.0.0";
        const relPath = `artifacts/${id}-${version}.vsix`;
        const vsix = await buildVsixBuffer({ publisher, name, version, ...one.manifest });
        await fs.promises.writeFile(path.join(registryDir, relPath), vsix);
        versions.push({
            version,
            engines: one.engines ?? { vscode: "*" },
            artifact: { type: "path", path: relPath },
            sha256: one.sha256 ?? (await sha256File(path.join(registryDir, relPath))),
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
        versions,
    };
    await fs.promises.writeFile(path.join(registryDir, "meta", `${id}.json`), JSON.stringify(meta));
}

const source = (): FileExtensionRegistrySource => new FileExtensionRegistrySource(registryDir);
const install = (id: string, version?: string) =>
    installFromRegistry(source(), id, { extensionsDir, host: HOST, ...(version === undefined ? {} : { version }) });
const installed = (): string[] => listInstalledExtensions(extensionsDir).map((e) => `${e.id}@${e.version}`);

describe("installFromRegistry — extensionDependencies", () => {
    it("ставит зависимости следом, транзитивно и без дублей", async () => {
        await seed("acme.plugin", { manifest: { extensionDependencies: ["acme.base", "acme.base", "acme.tools"] } });
        await seed("acme.base", { manifest: { extensionDependencies: ["acme.core"] } });
        await seed("acme.tools", { manifest: { extensionDependencies: ["acme.core"] } });
        await seed("acme.core");

        const result = await install("acme.plugin");

        expect(result).toEqual({
            id: "acme.plugin",
            version: "1.0.0",
            previous: [],
            dependencies: [
                { id: "acme.base", version: "1.0.0", previous: [] },
                { id: "acme.tools", version: "1.0.0", previous: [] },
                { id: "acme.core", version: "1.0.0", previous: [] },
            ],
            missingDependencies: [],
        });
        expect(installed()).toEqual(["acme.base@1.0.0", "acme.core@1.0.0", "acme.plugin@1.0.0", "acme.tools@1.0.0"]);
    });

    it("уже установленная зависимость не трогается — ни версия, ни id в другом регистре", async () => {
        await seed("acme.base", { version: "1.0.0" }, { version: "2.0.0" });
        await install("acme.base", "1.0.0");
        await seed("acme.plugin", { manifest: { extensionDependencies: ["ACME.Base"] } });

        const result = await install("acme.plugin");

        expect(result.dependencies).toEqual([]);
        // Узнана как установленная, а не «нет в реестре»: реестр под другим
        // регистром её бы и не нашёл.
        expect(result.missingDependencies).toEqual([]);
        expect(installed()).toEqual(["acme.base@1.0.0", "acme.plugin@1.0.0"]);
    });

    it("цикл зависимостей не зацикливает установку", async () => {
        await seed("acme.a", { manifest: { extensionDependencies: ["acme.b"] } });
        await seed("acme.b", { manifest: { extensionDependencies: ["acme.a"] } });

        const result = await install("acme.a");

        expect(result.dependencies.map((d) => d.id)).toEqual(["acme.b"]);
        expect(installed()).toEqual(["acme.a@1.0.0", "acme.b@1.0.0"]);
    });

    it("зависимости нет в реестре — расширение и остальные зависимости всё равно ставятся, пропавшая названа", async () => {
        await seed("acme.plugin", { manifest: { extensionDependencies: ["acme.missing", "acme.base"] } });
        await seed("acme.base");

        const result = await install("acme.plugin");

        expect(result.missingDependencies).toEqual(["acme.missing"]);
        expect(installed()).toEqual(["acme.base@1.0.0", "acme.plugin@1.0.0"]);
    });

    it("точная версия — только для самого расширения, зависимость берётся наивысшей совместимой", async () => {
        await seed(
            "acme.plugin",
            { version: "1.0.0", manifest: { extensionDependencies: ["acme.base"] } },
            { version: "2.0.0" },
        );
        await seed("acme.base", { version: "1.0.0" }, { version: "3.0.0" });

        await install("acme.plugin", "1.0.0");

        expect(installed()).toEqual(["acme.base@3.0.0", "acme.plugin@1.0.0"]);
    });

    it("зависимость найдена, но совместимой версии нет — отказ с причиной, диск не тронут (прежняя версия на месте)", async () => {
        await seed("acme.plugin", { version: "0.9.0" });
        await install("acme.plugin");
        await seed(
            "acme.plugin",
            { version: "0.9.0" },
            { version: "1.0.0", manifest: { extensionDependencies: ["acme.base"] } },
        );
        await seed("acme.base", { engines: { vscode: "^99.0.0" } });

        const error = await install("acme.plugin").then(
            () => undefined,
            (reason: unknown) => reason,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
            /^Cannot install acme\.plugin: its dependency "acme\.base" cannot be installed — Extension "acme\.base" has no version compatible with this build/u,
        );
        // Исходная причина не теряется — она в `cause`.
        expect((error as Error).cause).toBeInstanceOf(Error);
        expect(((error as Error).cause as Error).message).toMatch(/^Extension "acme\.base" has no version compatible/u);
        expect(installed()).toEqual(["acme.plugin@0.9.0"]);
    });

    it("транзитивная зависимость с битым sha256 — отказ, ни одна из цепочки не поставлена", async () => {
        await seed("acme.plugin", { manifest: { extensionDependencies: ["acme.base"] } });
        await seed("acme.base", { manifest: { extensionDependencies: ["acme.core"] } });
        await seed("acme.core", { sha256: "0".repeat(64) });

        await expect(install("acme.plugin")).rejects.toThrow(
            /Cannot install acme\.plugin: its dependency "acme\.core" cannot be installed — sha256 mismatch for acme\.core@1\.0\.0/u,
        );
        expect(installed()).toEqual([]);
    });

    it("сбой установки самого расширения снимает уже поставленные зависимости", async () => {
        // Манифест без version: подготовка его пропускает (id сходится), а
        // установка отвергает — сбой случается ПОСЛЕ установки зависимости.
        await seed("acme.plugin", { manifest: { version: undefined, extensionDependencies: ["acme.base"] } });
        await seed("acme.base");

        await expect(install("acme.plugin")).rejects.toThrow(/version/u);
        expect(installed()).toEqual([]);
    });

    it("отказ зависимости, которую мета реестра выдаёт не за себя, — та же причина, что у корня", async () => {
        await seed("acme.plugin", { manifest: { extensionDependencies: ["acme.base"] } });
        await seed("acme.base", { manifest: { publisher: "evil", name: "impostor" } });

        await expect(install("acme.plugin")).rejects.toThrow(
            'its dependency "acme.base" cannot be installed — Registry entry "acme.base" points to a .vsix of "evil.impostor" — refusing to install',
        );
        expect(installed()).toEqual([]);
    });

    it("источник отказал зависимости не-Error значением — причина всё равно в тексте", async () => {
        await seed("acme.plugin", { manifest: { extensionDependencies: ["acme.base"] } });
        await seed("acme.base");
        const files = source();
        const flaky: IExtensionRegistrySource = {
            getIndex: () => files.getIndex(),
            getMeta: (id) => files.getMeta(id),
            fetchArtifact: (version, tempDir) =>
                version.artifact.type === "path" && version.artifact.path.includes("acme.base")
                    ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- предмет теста: чужой код отказывает не-Error значением
                      Promise.reject("network down")
                    : files.fetchArtifact(version, tempDir),
        };

        await expect(installFromRegistry(flaky, "acme.plugin", { extensionsDir, host: HOST })).rejects.toThrow(
            'Cannot install acme.plugin: its dependency "acme.base" cannot be installed — network down',
        );
        expect(installed()).toEqual([]);
    });

    it("мусор вместо extensionDependencies — обычная установка", async () => {
        await seed("acme.solo", { manifest: { extensionDependencies: "acme.base" } });

        const result = await install("acme.solo");

        expect(result.dependencies).toEqual([]);
        expect(result.missingDependencies).toEqual([]);
    });
});

describe("describeDependencyInstall", () => {
    it("поставленные — строками в stdout, пропавшие — предупреждением", () => {
        expect(
            describeDependencyInstall("acme.plugin", {
                dependencies: [{ id: "acme.base", version: "1.2.3", previous: [] }],
                missingDependencies: ["x.y"],
            }),
        ).toEqual({
            info: ["Installed acme.base@1.2.3 (dependency of acme.plugin)"],
            warnings: [
                'Warning: acme.plugin depends on "x.y", which is not in the registry — acme.plugin will not activate until it is installed',
            ],
        });
    });
});

describe("installDependenciesFromRegistry (расширение поставлено из .vsix)", () => {
    it("ставит зависимости манифеста и называет пропавшие; само расширение не ставит", async () => {
        await seed("acme.base");
        const manifest = {
            publisher: "acme",
            name: "local",
            version: "1.0.0",
            extensionDependencies: ["acme.base", "x.y"],
        };

        const result = await installDependenciesFromRegistry(source(), "acme.local", manifest, {
            extensionsDir,
            host: HOST,
        });

        expect(result).toEqual({
            dependencies: [{ id: "acme.base", version: "1.0.0", previous: [] }],
            missingDependencies: ["x.y"],
        });
        expect(installed()).toEqual(["acme.base@1.0.0"]);
    });

    it("зависимость поставить нельзя — отказ с причиной, ничего не поставлено", async () => {
        await seed("acme.base", { engines: { vscode: "^99.0.0" } });
        const manifest = { extensionDependencies: ["acme.base"] };

        await expect(
            installDependenciesFromRegistry(source(), "acme.local", manifest, { extensionsDir, host: HOST }),
        ).rejects.toThrow('Cannot install acme.local: its dependency "acme.base" cannot be installed');
        expect(installed()).toEqual([]);
    });
});

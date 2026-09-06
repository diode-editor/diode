import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Файловый реестр-фикстура с НАСТОЯЩИМИ `.vsix`: то же, что раздаёт публичный
 * магазин, только на диске и под контролем теста. Нужен там, где проверяется
 * установка целиком — от кнопки до распакованного каталога.
 *
 * Артефакты пакует продовый `scripts/pack-vsix.mjs` — тот же упаковщик, которым
 * публикуются настоящие расширения; своего zip-кода здесь нет, иначе фикстура
 * проверяла бы сама себя.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(here, "..", "..");
const PACK_VSIX = join(REPO_ROOT, "scripts", "pack-vsix.mjs");

export interface IFixtureExtension {
    /** `publisher.name` — id записи реестра и каталога установки. */
    readonly id: string;
    readonly version: string;
    /** Каталог расширения-исходника; его `package.json` перезаписывается под id/версию. */
    readonly sourceDir: string;
    /** Требования к сборке; по умолчанию — совместимые. */
    readonly engines?: Readonly<Record<string, string>>;
    readonly displayName?: string;
    readonly description?: string;
    readonly readme?: string;
    /** Объявить неверный sha256: установка обязана отказаться и не оставить мусора. */
    readonly corruptSha?: boolean;
}

/**
 * Раскладывает каталог реестра (`index.json`, `meta/`, `artifacts/`) в `dir` и
 * возвращает путь к нему — его и передают редактору через `--registry`.
 * Несколько версий одного id объявляются несколькими записями с одним id.
 */
export async function createRegistryFixture(
    dir: string,
    extensions: readonly IFixtureExtension[],
): Promise<string> {
    mkdirSync(join(dir, "meta"), { recursive: true });
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    mkdirSync(join(dir, "sources"), { recursive: true });

    const metas = new Map<string, Record<string, unknown>>();
    const index: Record<string, unknown>[] = [];

    for (const extension of extensions) {
        const engines = extension.engines ?? { vscode: "^1.0.0" };
        const [publisher, name] = extension.id.split(".");
        const relArtifact = `artifacts/${extension.id}-${extension.version}.vsix`;
        const source = join(dir, "sources", `${extension.id}-${extension.version}`);
        // Копия исходника с переписанным манифестом: id и версия артефакта
        // обязаны совпадать с записью реестра, иначе установка откатится.
        cpSync(extension.sourceDir, source, { recursive: true });
        const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as Record<string, unknown>;
        writeFileSync(
            join(source, "package.json"),
            JSON.stringify({ ...manifest, publisher, name, version: extension.version, engines }, null, 2),
        );
        await packVsix(source, join(dir, relArtifact));

        const version = {
            version: extension.version,
            engines,
            artifact: { type: "path", path: relArtifact },
            sha256: extension.corruptSha === true ? "0".repeat(64) : sha256(join(dir, relArtifact)),
        };
        const displayName = extension.displayName ?? (manifest["displayName"] as string | undefined) ?? name!;
        const description = extension.description ?? (manifest["description"] as string | undefined) ?? "";

        const meta = metas.get(extension.id);
        if (meta === undefined) {
            metas.set(extension.id, {
                schemaVersion: 1,
                id: extension.id,
                publisher,
                name,
                displayName,
                description,
                kind: "native",
                ...(extension.readme === undefined ? {} : { readme: extension.readme }),
                versions: [version],
            });
            index.push({
                id: extension.id,
                publisher,
                name,
                displayName,
                description,
                kind: "native",
                latest: { version: extension.version, engines },
            });
        } else {
            // Вторая версия того же id: индекс называет последнюю объявленную.
            (meta["versions"] as unknown[]).push(version);
            const entry = index.find((e) => e["id"] === extension.id)!;
            entry["latest"] = { version: extension.version, engines };
        }
    }

    for (const [id, meta] of metas) {
        writeFileSync(join(dir, "meta", `${id}.json`), JSON.stringify(meta, null, 2));
    }
    writeFileSync(join(dir, "index.json"), JSON.stringify({ schemaVersion: 1, extensions: index }, null, 2));
    return dir;
}

function sha256(file: string): string {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function packVsix(sourceDir: string, outFile: string): Promise<void> {
    return new Promise((resolvePack, reject) => {
        const child = spawn(process.execPath, [PACK_VSIX, sourceDir, outFile], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolvePack();
            else reject(new Error(`pack-vsix ${sourceDir} exited ${String(code)}: ${stderr}`));
        });
    });
}

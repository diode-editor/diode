import * as fs from "node:fs";
import * as path from "node:path";

import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import {
    parseRegistryIndex,
    parseRegistryMeta,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryVersion,
} from "../common/registryFormat.ts";

/**
 * Файловый источник реестра: читает каталог в публикуемом формате
 * registry-репозитория (`index.json` + `meta/<id>.json` + `artifacts/**`).
 * Фундамент системы тестирования расширений и способ гонять весь install-флоу
 * без сети; артефакты — только `type: "path"` (локальные `.vsix`).
 *
 * Работает по реальным путям через `node:fs`, а не через `IAssetAccess`:
 * каталог реестра — внешние данные, а не ассеты поставки, и `fetchArtifact`
 * обязан вернуть физический путь для `installVsix` (тот же довод, что у
 * `extensionInstaller.ts`). Модуль чистый: без DI/логгера; диагностики парсера
 * уходят в необязательный `onProblem`.
 */

/** Безопасный для имени файла id `publisher.name` (участвует в пути `meta/<id>.json`). */
const EXTENSION_ID_RE = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/i;

export class FileExtensionRegistrySource implements IExtensionRegistrySource {
    private readonly rootDir: string;
    private readonly onProblem: ((message: string) => void) | undefined;

    constructor(rootDir: string, onProblem?: (message: string) => void) {
        this.rootDir = path.resolve(rootDir);
        this.onProblem = onProblem;
    }

    private report(problems: readonly string[]): void {
        for (const problem of problems) {
            this.onProblem?.(problem);
        }
    }

    /** Читает и парсит файл; ошибки парсинга оборачиваются путём файла. */
    private async readAndParse<T>(filePath: string, parse: (text: string) => { value: T; problems: string[] }): Promise<T> {
        const text = await fs.promises.readFile(filePath, "utf8");
        try {
            const { value, problems } = parse(text);
            this.report(problems);
            return value;
        } catch (error) {
            // Парсеры формата бросают только Error.
            throw new Error(`${filePath}: ${(error as Error).message}`);
        }
    }

    async getIndex(): Promise<IRegistryIndex> {
        return this.readAndParse(path.join(this.rootDir, "index.json"), (text) => {
            const { index, problems } = parseRegistryIndex(text);
            return { value: index, problems };
        });
    }

    async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (!EXTENSION_ID_RE.test(id)) {
            throw new Error(`Invalid extension id: "${id}"`);
        }
        const metaPath = path.join(this.rootDir, "meta", `${id}.json`);
        try {
            return await this.readAndParse(metaPath, (text) => {
                const { meta, problems } = parseRegistryMeta(text, id);
                return { value: meta, problems };
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }

    async fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string> {
        // Файловому источнику скачивать нечего — tempDir не нужен.
        void tempDir;
        const artifact = version.artifact;
        if (artifact.type !== "path") {
            throw new Error(`Artifact type "${artifact.type}" is not supported by the file registry source`);
        }
        const resolved = path.resolve(this.rootDir, artifact.path);
        // Defense-in-depth: парсер формата отвергает `..`/абсолютные пути, но
        // IRegistryVersion может быть собран программно, минуя парсер.
        if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
            throw new Error(`Refusing artifact path outside the registry root: ${artifact.path}`);
        }
        if (!fs.existsSync(resolved)) {
            throw new Error(`Artifact file not found in registry: ${resolved}`);
        }
        return resolved;
    }
}

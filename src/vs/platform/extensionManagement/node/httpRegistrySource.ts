import * as fs from "node:fs";
import * as path from "node:path";

import { DIODE_VERSION } from "../../../base/common/version.ts";
import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import {
    EXTENSION_ID_RE,
    parseRegistryIndex,
    parseRegistryMeta,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryVersion,
} from "../common/registryFormat.ts";

/**
 * HTTP-источник реестра: читает опубликованный вид registry-репозитория по сети
 * (`<base>/index.json` + `<base>/meta/<id>.json`) и качает `url`-артефакты.
 * Формат тот же, что у {@link FileExtensionRegistrySource}, — публикуемая
 * раскладка одна на оба транспорта.
 *
 * Модуль чистый: без DI/логгера, диагностики парсера уходят в необязательный
 * `onProblem`. Проверку `sha256` скачанного делает вызывающий
 * ({@link installFromRegistry}) — она одинакова для всех источников и потому не
 * дублируется здесь.
 *
 * Целостность байтов держится на `sha256` из меты, а не на транспорте, поэтому
 * `http:` разрешён наравне с `https:`: локальный каталог, поднятый по http, и своё
 * зеркало — законные сценарии, а выбор транспорта делает тот, кто передал адрес.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
/** Индекс всего реестра и мета одного расширения — это текст; мегабайты тут аномалия. */
// Stryker disable next-line ArithmeticOperator: арифметика тут только ради читаемости «8 МиБ»; сам дефолт в тестах не наблюдаем — лимит там задаётся явно, иначе кейс на превышение гонял бы мегабайты
const DEFAULT_MAX_JSON_BYTES = 8 * 1024 * 1024;
// Stryker disable next-line ArithmeticOperator: то же — «64 МиБ» читаемо, а проверять дефолт значило бы качать их в юните
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

export interface IHttpRegistrySourceOptions {
    /** Таймаут одного запроса, мс (default 30000). */
    readonly timeoutMs?: number;
    /** Лимит на `index.json`/`meta/<id>.json` (default 8 МиБ). */
    readonly maxJsonBytes?: number;
    /** Лимит на `.vsix` (default 64 МиБ). */
    readonly maxArtifactBytes?: number;
}

/** Приводит базу к URL, пригодному для относительного резолва путей реестра. */
function toBaseUrl(raw: string): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`Invalid registry URL: "${raw}"`);
    }
    requireHttp(url, `Registry URL must be http(s): "${raw}"`);
    // `new URL("index.json", base)` отбрасывает последний сегмент базы, если та не
    // кончается слешем: без нормализации `…/registry/v1` дал бы `…/registry/index.json`.
    if (!url.pathname.endsWith("/")) {
        url.pathname += "/";
    }
    return url;
}

function requireHttp(url: URL, message: string): void {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(message);
    }
}

/**
 * `fetch` отдаёт лаконичное «fetch failed», а настоящую причину (DNS, отказ в
 * соединении, TLS) прячет в `cause` — без неё сообщение ничего не объясняет.
 */
function describeFetchError(error: unknown): string {
    const message = (error as Error).message;
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${message} (${cause.message})` : message;
}

/**
 * Читает тело ответа целиком, обрывая чтение за `limit` байт. `Content-Length` не
 * используем как разрешение читать: заголовок необязателен и может врать —
 * считаем фактические байты.
 *
 * Артефакт тоже буферизуется в памяти, а не льётся в файл потоком: лимит и так
 * ограничивает пик, зато нет полуфайла, который надо убирать на любой ошибке.
 */
async function readCapped(response: Response, limit: number, url: URL): Promise<Buffer> {
    // Ответы без тела (204 и прочие null body status) — ноль байт, читать нечего.
    if (response.body === null) {
        return Buffer.alloc(0);
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
            chunk = await reader.read();
        } catch (error) {
            // Обрыв соединения на середине тела — сеть, а не данные реестра.
            throw new Error(`${url.href}: download failed: ${(error as Error).message}`);
        }
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > limit) {
            await reader.cancel();
            throw new Error(`${url.href}: response exceeds the ${String(limit)}-byte limit`);
        }
        chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks);
}

export class HttpExtensionRegistrySource implements IExtensionRegistrySource {
    private readonly baseUrl: URL;
    private readonly onProblem: ((message: string) => void) | undefined;
    private readonly timeoutMs: number;
    private readonly maxJsonBytes: number;
    private readonly maxArtifactBytes: number;

    constructor(baseUrl: string, onProblem?: (message: string) => void, options: IHttpRegistrySourceOptions = {}) {
        this.baseUrl = toBaseUrl(baseUrl);
        this.onProblem = onProblem;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;
        this.maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    }

    /** GET с таймаутом; сетевой сбой оборачивается адресом, иначе он безымянный. */
    private async request(url: URL): Promise<Response> {
        try {
            return await fetch(url, {
                headers: { "user-agent": `diode/${DIODE_VERSION}` },
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            throw new Error(`${url.href}: ${describeFetchError(error)}`);
        }
    }

    private ensureOk(response: Response, url: URL): void {
        if (!response.ok) {
            throw new Error(`${url.href}: HTTP ${String(response.status)} ${response.statusText}`);
        }
    }

    /** Запускает парсер формата: диагностики — в `onProblem`, ошибка файла — с адресом. */
    private parse<T>(url: URL, parse: () => { value: T; problems: string[] }): T {
        try {
            const { value, problems } = parse();
            for (const problem of problems) {
                this.onProblem?.(problem);
            }
            return value;
        } catch (error) {
            // Парсеры формата бросают только Error.
            throw new Error(`${url.href}: ${(error as Error).message}`);
        }
    }

    /** Проверяет статус и читает тело как JSON-текст под лимитом. */
    private async readJson(response: Response, url: URL): Promise<string> {
        this.ensureOk(response, url);
        return (await readCapped(response, this.maxJsonBytes, url)).toString("utf8");
    }

    async getIndex(): Promise<IRegistryIndex> {
        const url = new URL("index.json", this.baseUrl);
        const text = await this.readJson(await this.request(url), url);
        return this.parse(url, () => {
            const { index, problems } = parseRegistryIndex(text);
            return { value: index, problems };
        });
    }

    async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (!EXTENSION_ID_RE.test(id)) {
            throw new Error(`Invalid extension id: "${id}"`);
        }
        const url = new URL(`meta/${id}.json`, this.baseUrl);
        const response = await this.request(url);
        // 404 — «реестр не знает такого id», ровно как ENOENT у файлового источника;
        // прочие не-2xx это сбой реестра, а не отсутствие записи.
        if (response.status === 404) {
            return undefined;
        }
        const text = await this.readJson(response, url);
        return this.parse(url, () => {
            const { meta, problems } = parseRegistryMeta(text, id);
            return { value: meta, problems };
        });
    }

    async fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string> {
        const artifact = version.artifact;
        if (artifact.type !== "url") {
            throw new Error(`Artifact type "${artifact.type}" is not supported by the HTTP registry source`);
        }
        let url: URL;
        try {
            url = new URL(artifact.url);
        } catch {
            throw new Error(`Invalid artifact URL: "${artifact.url}"`);
        }
        requireHttp(url, `Artifact URL must be http(s): "${artifact.url}"`);

        const response = await this.request(url);
        this.ensureOk(response, url);
        const bytes = await readCapped(response, this.maxArtifactBytes, url);

        // Имя фиксировано, а не выведено из URL: `tempDir` заводится вызывающим на
        // одну установку (и им же убирается), а имя из чужих данных — только лишний
        // путь для трюков. Настоящие id и версию `installVsix` всё равно читает из
        // манифеста.
        const target = path.join(tempDir, "artifact.vsix");
        fs.writeFileSync(target, bytes);
        return target;
    }
}

import * as fs from "node:fs";
import * as path from "node:path";

/** Лоток адресуется id расширения, который подставляет субпроцесс, а не сам вызов: чужой лоток расширению не достать. */
export interface IExtensionSecretStore {
    keys(extensionId: string): readonly string[];
    get(extensionId: string, key: string): string | undefined;
    store(extensionId: string, key: string, value: string): void;
    delete(extensionId: string, key: string): void;
}

type SecretBucket = Partial<Record<string, string>>;

/** `Partial`: ключи произвольные — защитные проверки ниже настоящие, а не декоративные. */
type SecretsFile = Partial<Record<string, SecretBucket>>;

/** Одна копия правил на оба хранилища — две разъедутся. */
function secretStoreOps(read: () => SecretsFile, afterWrite: (data: SecretsFile) => void): IExtensionSecretStore {
    return {
        keys: (extensionId) => Object.keys(read()[extensionId] ?? {}),
        get: (extensionId, key) => read()[extensionId]?.[key],
        store: (extensionId, key, value) => {
            const data = read();
            (data[extensionId] ??= {})[key] = value;
            afterWrite(data);
        },
        delete: (extensionId, key) => {
            const data = read();
            const own = data[extensionId];
            if (own === undefined) return;
            Reflect.deleteProperty(own, key);
            // Опустевший лоток убираем, иначе файл копил бы пустышки.
            if (Object.keys(own).length === 0) Reflect.deleteProperty(data, extensionId);
            afterWrite(data);
        },
    };
}

export function createInMemoryExtensionSecretStore(): IExtensionSecretStore {
    const data: SecretsFile = {};
    return secretStoreOps(
        () => data,
        () => undefined,
    );
}

/**
 * **Шифрования нет**: связки ключей ОС у нас нет, значения лежат открытым текстом под `0600`
 * (то же в матрице готовности API) — поэтому значения секретов не попадают ни в один лог.
 * Пишем синхронно на каждую правку: потерять токен на неожиданном выходе нельзя.
 *
 * @param onError значений не получает никогда — только путь и причину
 */
export function createFileExtensionSecretStore(
    filePath: string,
    onError?: (message: string, err: unknown) => void,
): IExtensionSecretStore {
    let data: SecretsFile | null = null;

    const load = (): SecretsFile => {
        if (data !== null) return data;
        data = readSecretsFile(filePath, onError);
        return data;
    };

    const flush = (next: SecretsFile): void => {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            // Stryker disable next-line ObjectLiteral,StringLiteral: `mode` дублирует chmodSync строкой ниже, а `encoding` совпадает с дефолтом writeFileSync для строки — разница мутанта с оригиналом только в окне между созданием файла и chmod, наблюдаемом лишь планировщиком ОС. Создавать секреты сразу с 0600 при этом обязательно: это как раз та гонка
            fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: 0o600 });
            // `mode` действует только при создании файла: у существующего (из чужой копии
            // user-data) права остались бы мировыми.
            fs.chmodSync(filePath, 0o600);
        } catch (err) {
            onError?.(`failed to write extension secrets to "${filePath}"`, err);
        }
    };

    return secretStoreOps(load, flush);
}

/** Любая беда — пустое хранилище: нечитаемый секрет стоит повторного вопроса человеку, а не смерти редактора. */
function readSecretsFile(filePath: string, onError?: (message: string, err: unknown) => void): SecretsFile {
    let raw: string;
    try {
        // Stryker disable next-line StringLiteral: пустую кодировку Node трактует как «кодировки нет» и отдаёт Buffer, который JSON.parse ниже коерсит в ту же строку (проверено) — мутант эквивалентен
        raw = fs.readFileSync(filePath, "utf-8");
    } catch {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        onError?.(`failed to parse extension secrets at "${filePath}"`, err);
        return {};
    }
    // Stryker disable next-line ConditionalExpression: снятие левого операнда эквивалентно — JSON.parse отдаёт только object/array/string/number/boolean/null, а любой скаляр и без `typeof` даёт тот же пустой результат (`Object.entries(42)` пуст, символы строки отсеет проверка лотка ниже). Оставлен как формулировка намерения «сверху — обычный объект»; `=== null` и `Array.isArray` рядом мутантов не прощают — их закрывают тесты на `null` и непустой массив
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: SecretsFile = {};
    for (const [extensionId, own] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof own !== "object" || own === null || Array.isArray(own)) continue;
        const bucket: SecretBucket = {};
        for (const [key, value] of Object.entries(own as Record<string, unknown>)) {
            if (typeof value === "string") bucket[key] = value;
        }
        if (Object.keys(bucket).length > 0) result[extensionId] = bucket;
    }
    return result;
}

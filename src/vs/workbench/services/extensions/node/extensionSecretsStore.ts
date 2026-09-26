import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Хранилище `ExtensionContext.secrets` на стороне ХОСТА.
 *
 * Лоток у каждого расширения свой — ключ хранения составной: id расширения плюс
 * ключ секрета. Расширение чужой лоток не адресует вовсе: id ему подставляет
 * субпроцесс, а не сам вызов (см. `extensionSecrets.ts`).
 *
 * Отличие от {@link createExtensionMemento}: memento живёт в памяти субпроцесса
 * и обнуляется с перезапуском, секреты — переживают его. Это не украшение: в
 * них лежит токен сервиса, который расширение спрашивает у человека один раз.
 */
export interface IExtensionSecretStore {
    /** Ключи, которые есть у этого расширения (`SecretStorage.keys`). */
    keys(extensionId: string): readonly string[];
    get(extensionId: string, key: string): string | undefined;
    store(extensionId: string, key: string, value: string): void;
    delete(extensionId: string, key: string): void;
}

/** Лоток одного расширения: ключ секрета → значение. */
type SecretBucket = Partial<Record<string, string>>;

/**
 * Содержимое файла: id расширения → его лоток. `Partial`, потому что ключи тут
 * произвольные (id расширения, ключ секрета) — чтение по незнакомому честно
 * даёт `undefined`, и защитные проверки ниже настоящие, а не декоративные.
 */
type SecretsFile = Partial<Record<string, SecretBucket>>;

/**
 * Операции над картой секретов — ОДНА копия на оба хранилища. Разница между
 * ними только в том, откуда карта берётся (`read`) и что делать после правки
 * (`afterWrite`); сами правила (свой лоток у каждого расширения, опустевший
 * лоток убирается) дублировать нельзя — разъедутся.
 */
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
            // Опустевший лоток убираем целиком: иначе файл копил бы пустышки
            // расширений, которые когда-то что-то хранили.
            if (Object.keys(own).length === 0) Reflect.deleteProperty(data, extensionId);
            afterWrite(data);
        },
    };
}

/**
 * Хранилище в памяти процесса — дефолт для хоста, поднятого без user-data
 * (юнит-тесты, харнессы). Ведёт себя как настоящее в пределах прогона; за
 * персистентность отвечает {@link createFileExtensionSecretStore}.
 */
export function createInMemoryExtensionSecretStore(): IExtensionSecretStore {
    const data: SecretsFile = {};
    return secretStoreOps(
        () => data,
        () => undefined,
    );
}

/**
 * Хранилище в файле user-data (`<profileDir>/secrets.json`).
 *
 * **Шифрования нет.** В VS Code секреты уходят в связку ключей ОС; у нас их
 * нет, поэтому значения лежат открытым текстом в файле с правами `0600` —
 * защита ровно уровня прав ФС. Замалчивать это нельзя: расширение кладёт туда
 * токен, и пользователь вправе знать цену (то же самое написано в матрице
 * готовности API). Именно поэтому значения секретов не попадают ни в один лог.
 *
 * Читаем один раз лениво, пишем синхронно на каждую правку: секретов единицы,
 * а живучесть важнее — потерять токен на неожиданном выходе нельзя.
 *
 * @param filePath путь к файлу секретов (`IUserDataPaths.secretsFile`)
 * @param onError сообщение о нечитаемом/незаписываемом файле; значений не
 *        получает НИКОГДА — только путь и причину
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
            // `mode` у writeFileSync действует только при СОЗДАНИИ файла: у уже
            // существующего (например, приехавшего из чужой копии user-data)
            // права так и остались бы мировыми.
            fs.chmodSync(filePath, 0o600);
        } catch (err) {
            onError?.(`failed to write extension secrets to "${filePath}"`, err);
        }
    };

    return secretStoreOps(load, flush);
}

/**
 * Читает файл секретов. Любая беда (нет файла, битый JSON, чужая форма) — это
 * пустое хранилище, а не падение: нечитаемый секрет должен стоить расширению
 * повторного вопроса человеку, а не смерти редактора. Нестроковые значения
 * отбрасываются поштучно — уцелевшие ключи остаются рабочими.
 */
function readSecretsFile(filePath: string, onError?: (message: string, err: unknown) => void): SecretsFile {
    let raw: string;
    try {
        // Stryker disable next-line StringLiteral: пустую кодировку Node трактует как «кодировки нет» и отдаёт Buffer, который JSON.parse ниже коерсит в ту же строку (проверено) — мутант эквивалентен
        raw = fs.readFileSync(filePath, "utf-8");
    } catch {
        // Файла ещё нет — штатное состояние чистой установки, не ошибка.
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

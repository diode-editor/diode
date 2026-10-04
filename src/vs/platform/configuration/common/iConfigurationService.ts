import type { IDisposable } from "../../../base/common/lifecycle.ts";

/**
 * Сервис настроек приложения. Аналог `IConfigurationService` из VS Code,
 * урезанный до набора, который реально нужен: чтение значений по слоям
 * (defaults реестра → user → profile), запись в settings.json активного
 * профиля и событие изменения (live-reload файла и собственные записи).
 *
 * Реализации: `ConfigurationService` (node, файлы на диске) и
 * `InMemoryConfigurationService` (тестовый профиль и юниты — те же дефолты
 * реестра, запись в память).
 */
export interface IConfigurationService {
    /**
     * Ключ из схемы приложения ({@link IConfigurationKeys}): тип выведен из узла
     * конфигурации, `undefined` не бывает — дефолт гарантирует реестр, а
     * значение вне схемы (не тот тип, не из `enum`, вне `minimum`/`maximum`)
     * реализация заменяет дефолтом.
     */
    get<K extends keyof IConfigurationKeys>(key: K, overrides?: IConfigurationOverrides): IConfigurationKeys[K];
    /**
     * Чужой ключ (настройки расширений, `git.*`) или ключ с явным типом:
     * значение по точечному ключу, `undefined`, если его нет ни в одном слое.
     * `T` здесь — приведение для удобства: тип значения вне схемы приложения не
     * проверяется.
     *
     * `overrides.overrideIdentifier` — язык: поверх итогового значения ложится
     * секция `"[<язык>]"` (из любого слоя, включая дефолты расширений) — как
     * `getValue(section, { overrideIdentifier })` у VS Code. В секции действуют
     * только ключи ядра со `scope: "language-overridable"`; прочие ключи ядра там
     * игнорируются.
     */
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T — приведение для чужих ключей, как у ConfigurationModel.get
    get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined;

    /**
     * Возвращает всё дерево настроек или поддерево по dotted-section.
     * Без аргументов — корень. Возвращает иммутабельный «срез»; мутация
     * объектов не отражается обратно в модели.
     */
    getValue(section?: string): unknown;

    /**
     * Слои настроек деревьями — для extension host'а, который собирает из них ту
     * же модель на своей стороне (аналог `getConfigurationData` vscode). Значения
     * как записаны, без валидации по схеме.
     */
    getConfigurationData(): IConfigurationData;

    /**
     * Покомпонентный inspect — полезно для отладки/UI «User vs Default vs Profile».
     * Любое из полей `default/user/profile` может быть `undefined`,
     * если в соответствующем слое ключ не задан. `value` — итоговое
     * значение (то же, что вернёт `get(key)`).
     */
    inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T>;

    /**
     * Подписка на изменения: правка settings.json на диске (live-reload) и
     * собственные записи через {@link updateValue}. Событие несёт только ключи,
     * значение которых действительно поменялось.
     */
    onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): IDisposable;

    /**
     * Записывает значение в настройки активного профиля (аналог `updateValue`
     * VS Code с неявной целью `ConfigurationTarget.USER`) и обновляет модель,
     * чтобы последующие `get`/`inspect` сразу видели новое значение. У файловой
     * реализации — JSONC-правка settings.json с сохранением комментариев и
     * форматирования (`jsonc-parser.modify`).
     */
    updateValue(key: string, value: unknown): Promise<void>;
}

/**
 * Типы ключей настроек приложения по их схемам. В platform — пусто: слой не
 * знает узлов конфигурации фич. Наполняет его `workbench/common/configuration`
 * (module augmentation от `CONFIGURATION_CONTRIBUTIONS`), так что
 * `get("editor.tabSize")` типизирован как `number`, а опечатка в ключе
 * уходит во вторую, нетипизированную перегрузку `get<T>` — и требует явного `T`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- точка расширения для module augmentation
export interface IConfigurationKeys {}

/** Слои настроек вложенными деревьями (`{ editor: { tabSize: 4 } }`). */
export interface IConfigurationData {
    /** Дефолты: ядро, настройки расширений и их переопределения (`configurationDefaults`). */
    readonly defaults: Readonly<Record<string, unknown>>;
    /** Пользовательские настройки активного профиля (user, поверх него — profile). */
    readonly user: Readonly<Record<string, unknown>>;
}

export interface IConfigurationInspectResult<T> {
    /** Значение из default-слоя (хардкод приложения). */
    readonly default: T | undefined;
    /** Значение из User/settings.json (default-профиль). */
    readonly user: T | undefined;
    /** Значение из активного профиля (если он не default). */
    readonly profile: T | undefined;
    /** Итоговое значение после слияния слоёв. */
    readonly value: T | undefined;
}

/** Уточнение чтения: язык, для которого нужно значение (аналог `IConfigurationOverrides` vscode). */
export interface IConfigurationOverrides {
    readonly overrideIdentifier?: string;
}

export interface IConfigurationChangeEvent {
    /** Список изменившихся точечных ключей — в основном дереве или в секции языка. */
    readonly affectedKeys: readonly string[];
    /** Языки, чья секция (`"[go]"`) поменялась. */
    readonly overrideIdentifiers: readonly string[];
    /** Удобный helper: проверяет, затронут ли ключ или его префикс. */
    affectsConfiguration(key: string): boolean;
}

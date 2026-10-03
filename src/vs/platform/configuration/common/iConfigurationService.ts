import type { IDisposable } from "../../../base/common/lifecycle.ts";

/**
 * Сервис настроек приложения. Аналог `IConfigurationService` из VS Code,
 * урезанный до набора, который реально нужен на текущем этапе:
 * чтение значений, иммутабельная модель, событие изменения (зарезервировано
 * под будущий watch/reload).
 *
 * Запись и persist пока не предусмотрены — `settings.json` редактируется
 * руками, изменения подхватываются после перезапуска.
 */
export interface IConfigurationService {
    /**
     * Достаёт значение по точечному ключу (`"editor.tabSize"`). Если ключ
     * не найден или тип не совпадает — возвращает `defaultValue` (или
     * `undefined`, если он не передан). `T` — для удобства, проверки типа
     * на стороне реализации нет.
     */
    get<T>(key: string, defaultValue?: T): T | undefined;

    /**
     * Возвращает всё дерево настроек или поддерево по dotted-section.
     * Без аргументов — корень. Возвращает иммутабельный «срез»; мутация
     * объектов не отражается обратно в модели.
     */
    getValue(section?: string): unknown;

    /**
     * Покомпонентный inspect — полезно для отладки/UI «User vs Default vs Profile».
     * Любое из полей `default/user/profile` может быть `undefined`,
     * если в соответствующем слое ключ не задан. `value` — итоговое
     * значение (то же, что вернёт `get(key)`).
     */
    inspect<T>(key: string): IConfigurationInspectResult<T>;

    /**
     * Подписка на изменения. В этой итерации событие не эмитится (нет
     * live-reload), но API стабилен — будущий watcher включится без правок
     * потребителей.
     */
    onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): IDisposable;

    /**
     * Записывает значение в settings.json активного профиля (аналог
     * `ConfigurationTarget.USER` в VS Code) и обновляет in-memory модель, чтобы
     * последующие `get`/`inspect` сразу видели новое значение. JSONC-правка
     * сохраняет комментарии и форматирование файла (`jsonc-parser.modify`).
     *
     * Опционально: заглушки (`NULL_CONFIGURATION_SERVICE`, тестовые моки) persist
     * не поддерживают — потребитель вызывает через optional chaining.
     */
    updateUserValue?(key: string, value: unknown): Promise<void>;
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

export interface IConfigurationChangeEvent {
    /** Список изменившихся точечных ключей. */
    readonly affectedKeys: readonly string[];
    /** Удобный helper: проверяет, затронут ли ключ или его префикс. */
    affectsConfiguration(key: string): boolean;
}

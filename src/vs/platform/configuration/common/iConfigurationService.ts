import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Слои чтения: defaults реестра → user → profile → workspace. */
export interface IConfigurationService {
    /** `undefined` не бывает: значение вне схемы (тип, `enum`, `minimum`/`maximum`) реализация заменяет дефолтом. */
    get<K extends keyof IConfigurationKeys>(key: K, overrides?: IConfigurationOverrides): IConfigurationKeys[K];
    /**
     * `T` — только приведение: тип значения вне схемы приложения не проверяется.
     * В секции `"[<язык>]"` действуют только ключи ядра со `scope: "language-overridable"`.
     */
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T — приведение для чужих ключей, как у ConfigurationModel.get
    get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined;

    /** Срез: мутация объектов не отражается обратно в модели. */
    getValue(section?: string): unknown;

    /** Значения как записаны, без валидации по схеме. */
    getConfigurationData(): IConfigurationData;

    inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T>;

    /** Событие несёт только ключи, значение которых действительно поменялось. */
    onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): IDisposable;

    /**
     * Модель обновляется сразу, до записи на диск; `value: undefined` снимает ключ.
     * Записи сериализуются, параллельные вызовы не теряют друг друга. Ключ со `scope`
     * `application`/`machine` в воркспейс и ключ вне `FOLDER_SCOPES` в папку
     * отклоняются — при чтении они туда тоже не ложатся (`filterWorkspaceSettings`).
     */
    updateValue(key: string, value: unknown, target?: ConfigurationTarget): Promise<void>;
}

/** Папка пока единственная, поэтому ресурса цель-папка не несёт. */
export type ConfigurationTarget = "user" | "workspace" | "workspaceFolder";

/**
 * В platform — пусто: наполняет `workbench/common/configuration` (module augmentation),
 * опечатка в ключе уходит в нетипизированную перегрузку `get<T>` и требует явного `T`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- точка расширения для module augmentation
export interface IConfigurationKeys {}

export interface IConfigurationData {
    readonly defaults: Readonly<Record<string, unknown>>;
    readonly user: Readonly<Record<string, unknown>>;
    /** Уже без ключей, чей `scope` воркспейсу не положен. */
    readonly workspace: Readonly<Record<string, unknown>>;
    /** Только у окна из `.code-workspace`; у окна из папки её файл — уже слой воркспейса. */
    readonly workspaceFolder?: Readonly<Record<string, unknown>>;
}

export interface IConfigurationInspectResult<T> {
    readonly default: T | undefined;
    readonly user: T | undefined;
    readonly profile: T | undefined;
    readonly workspace: T | undefined;
    readonly workspaceFolder: T | undefined;
    readonly value: T | undefined;
}

export interface IConfigurationOverrides {
    readonly overrideIdentifier?: string;
}

export interface IConfigurationChangeEvent {
    readonly affectedKeys: readonly string[];
    readonly overrideIdentifiers: readonly string[];
    /** Затронут ли ключ или его префикс. */
    affectsConfiguration(key: string): boolean;
}

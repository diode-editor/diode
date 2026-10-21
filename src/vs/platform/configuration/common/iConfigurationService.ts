import type { IDisposable } from "../../../base/common/lifecycle.ts";

/** Read layers: registry defaults → user → profile → workspace. */
export interface IConfigurationService {
    /** Never `undefined`: the implementation replaces a value outside the schema (type, `enum`, `minimum`/`maximum`) with the default. */
    get<K extends keyof IConfigurationKeys>(key: K, overrides?: IConfigurationOverrides): IConfigurationKeys[K];
    /**
     * `T` is only a cast: the type of a value outside the app schema is not checked.
     * In a `"[<language>]"` section only core keys with `scope: "language-overridable"` apply.
     */
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is a cast for foreign keys, like ConfigurationModel.get
    get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined;

    /** A snapshot: mutating its objects does not reflect back into the model. */
    getValue(section?: string): unknown;

    /** Values as written, without schema validation. */
    getConfigurationData(): IConfigurationData;

    inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T>;

    /** The event carries only keys whose value actually changed. */
    onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): IDisposable;

    /**
     * The model updates immediately, before the disk write; `value: undefined` removes the key.
     * Writes are serialized, so concurrent calls do not lose each other. A key with `scope`
     * `application`/`machine` targeting the workspace and a key outside `FOLDER_SCOPES` targeting the folder
     * are rejected; reads would not place them there either (`filterWorkspaceSettings`).
     */
    updateValue(key: string, value: unknown, target?: ConfigurationTarget): Promise<void>;
}

/** There is only one folder for now, so the folder target carries no resource. */
export type ConfigurationTarget = "user" | "workspace" | "workspaceFolder";

/**
 * Empty in platform: `workbench/common/configuration` fills it (module augmentation);
 * a typo in a key falls through to the untyped `get<T>` overload and needs an explicit `T`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- extension point for module augmentation
export interface IConfigurationKeys {}

export interface IConfigurationData {
    readonly defaults: Readonly<Record<string, unknown>>;
    readonly user: Readonly<Record<string, unknown>>;
    /** Already stripped of keys whose `scope` is not allowed in the workspace. */
    readonly workspace: Readonly<Record<string, unknown>>;
    /** Only for a window opened from `.code-workspace`; for a folder window its file already is the workspace layer. */
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
    /** Whether the key or its prefix is affected. */
    affectsConfiguration(key: string): boolean;
}

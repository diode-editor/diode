import { Emitter } from "../../../base/common/event.ts";

import { ConfigurationModel } from "./configurationModel.ts";
import type {
    ConfigurationRegistry,
    ConfigurationScope,
    IConfigurationPropertySchema,
} from "./configurationRegistry.ts";
import { ConfigurationSnapshot } from "./configurationSnapshot.ts";
import { filterWorkspaceSettings } from "./configurationValidation.ts";
import type {
    ConfigurationTarget,
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationKeys,
    IConfigurationOverrides,
    IConfigurationService,
} from "./iConfigurationService.ts";
import { folderScopeWriteError, NO_WORKSPACE_OPENED_ERROR, workspaceScopeWriteError } from "./workspaceSettings.ts";

/**
 * No profile: a single user layer. No `.code-workspace` window: the folder target writes to
 * the workspace layer with its own scope check.
 */
export class InMemoryConfigurationService implements IConfigurationService {
    private readonly defaultsLayer: ConfigurationModel;
    private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>;
    private readonly scopes: ReadonlyMap<string, ConfigurationScope>;
    /** In settings.json shape: a write replaces the whole key, as in the file. */
    private readonly userSettings: Record<string, unknown>;
    /** `null` means no folder is open. */
    private readonly workspaceSettings: Record<string, unknown> | null;
    private userLayer: ConfigurationModel;
    private workspaceLayer: ConfigurationModel;
    private snapshot: ConfigurationSnapshot;
    private readonly onDidChangeConfigurationEmitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

    /** @param workspace omitted means no folder is open (an empty `{}` means open). */
    public constructor(
        registry?: ConfigurationRegistry,
        initial: Readonly<Record<string, unknown>> = {},
        workspace?: Readonly<Record<string, unknown>>,
    ) {
        this.defaultsLayer = ConfigurationModel.fromRaw(registry?.getDefaultConfiguration() ?? {});
        this.schemas = registry?.getConfigurationProperties() ?? new Map();
        this.scopes = registry?.getConfigurationScopes() ?? new Map();
        this.userSettings = { ...initial };
        this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        this.workspaceSettings = workspace === undefined ? null : { ...workspace };
        this.workspaceLayer = this.computeWorkspaceLayer();
        this.snapshot = this.computeSnapshot();
    }

    private computeWorkspaceLayer(): ConfigurationModel {
        // Stryker disable next-line ConditionalExpression: fromRaw(null) is the same empty layer; the branch is for the type checker
        if (this.workspaceSettings === null) return ConfigurationModel.EMPTY;
        return filterWorkspaceSettings(ConfigurationModel.fromRaw(this.workspaceSettings), this.scopes).model;
    }

    private computeSnapshot(): ConfigurationSnapshot {
        return new ConfigurationSnapshot(
            ConfigurationModel.merge(this.defaultsLayer, this.userLayer, this.workspaceLayer),
            this.schemas,
        );
    }

    public get<K extends keyof IConfigurationKeys>(key: K, overrides?: IConfigurationOverrides): IConfigurationKeys[K];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is a cast for foreign keys, like ConfigurationModel.get
    public get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined;
    public get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined {
        return this.snapshot.model(overrides).get<T>(key);
    }

    public getValue(section?: string): unknown {
        return this.snapshot.model().getValue(section);
    }

    public getConfigurationData(): IConfigurationData {
        return {
            defaults: this.defaultsLayer.toRaw(),
            user: this.userLayer.toRaw(),
            workspace: this.workspaceLayer.toRaw(),
            workspaceFolder: {},
        };
    }

    public inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: undefined,
            workspace: this.workspaceLayer.get<T>(key),
            workspaceFolder: undefined,
            value: this.snapshot.model(overrides).get<T>(key),
        };
    }

    // Stryker disable next-line StringLiteral: any target other than "workspace" writes to user; the default matters only to the type checker
    public updateValue(key: string, value: unknown, target: ConfigurationTarget = "user"): Promise<void> {
        const prev = this.snapshot;
        if (target === "workspace" || target === "workspaceFolder") {
            if (this.workspaceSettings === null) return Promise.reject(new Error(NO_WORKSPACE_OPENED_ERROR));
            const scope = this.scopes.get(key);
            const scopeError =
                target === "workspace" ? workspaceScopeWriteError(key, scope) : folderScopeWriteError(key, scope);
            if (scopeError !== null) return Promise.reject(new Error(scopeError));
            writeKey(this.workspaceSettings, key, value);
            this.workspaceLayer = this.computeWorkspaceLayer();
        } else {
            writeKey(this.userSettings, key, value);
            this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        }
        this.snapshot = this.computeSnapshot();
        const event = this.snapshot.changeFrom(prev);
        if (event !== null) this.onDidChangeConfigurationEmitter.fire(event);
        return Promise.resolve();
    }
}

function writeKey(settings: Record<string, unknown>, key: string, value: unknown): void {
    if (value === undefined) {
        Reflect.deleteProperty(settings, key);
    } else {
        settings[key] = value;
    }
}

import { diffOverrideIdentifiers } from "../../../platform/configuration/common/configurationChangeEvent.ts";
import { ConfigurationModel, isOverrideKey } from "../../../platform/configuration/common/configurationModel.ts";

/**
 * `get` is synchronous in extensions, so main-process layers arrive via push
 * rather than RPC-per-get, and are merged by the same {@link ConfigurationModel}.
 * `workspaceFolder` is a single layer instead of upstream `folders`: we have one folder.
 * No `language-overridable` filter — the subprocess does not know the core schemas.
 */

export interface IConfigInspectResult {
    readonly key: string;
    readonly defaultValue: unknown;
    readonly globalValue: unknown;
    readonly workspaceValue: unknown;
    readonly workspaceFolderValue: unknown;
    readonly value: unknown;
}

export class WorkspaceConfigStore {
    private defaults = ConfigurationModel.EMPTY;
    private user = ConfigurationModel.EMPTY;
    private workspace = ConfigurationModel.EMPTY;
    private workspaceFolder = ConfigurationModel.EMPTY;
    private merged = ConfigurationModel.EMPTY;
    private settingIds: ReadonlySet<string> = new Set();

    /**
     * Anything that is not an object becomes an empty layer; anything but strings among the ids is dropped.
     * Returns the `[lang]` keys whose section changed: upstream counts them among the event's keys.
     */
    public setData(data: unknown, settingIds?: unknown): string[] {
        const before = this.merged;
        this.settingIds = new Set(Array.isArray(settingIds) ? settingIds.filter((id) => typeof id === "string") : []);
        const layers = isPlainObject(data) ? data : {};
        this.defaults = ConfigurationModel.fromRaw(layers.defaults);
        this.user = ConfigurationModel.fromRaw(layers.user);
        this.workspace = ConfigurationModel.fromRaw(layers.workspace);
        this.workspaceFolder = ConfigurationModel.fromRaw(layers.workspaceFolder);
        this.merged = ConfigurationModel.merge(this.defaults, this.user, this.workspace, this.workspaceFolder);
        return diffOverrideIdentifiers(before, this.merged).map((identifier) => `[${identifier}]`);
    }

    public get(dottedKey: string, defaultValue?: unknown, languageId?: string): unknown {
        return this.value(dottedKey, languageId) ?? defaultValue;
    }

    public has(dottedKey: string, languageId?: string): boolean {
        return this.value(dottedKey, languageId) !== undefined;
    }

    public inspect(dottedKey: string, languageId?: string): IConfigInspectResult {
        return {
            key: dottedKey,
            defaultValue: this.defaults.get(dottedKey),
            globalValue: this.user.get(dottedKey),
            workspaceValue: this.workspace.get(dottedKey),
            workspaceFolderValue: this.workspaceFolder.get(dottedKey),
            value: this.model(languageId).get(dottedKey),
        };
    }

    /** VS Code exposes the section values as `WorkspaceConfiguration` fields. */
    public sectionKeys(section: string | undefined, languageId?: string): string[] {
        const node = this.model(languageId).getValue(section);
        return isPlainObject(node) ? Object.keys(node) : [];
    }

    /** Upstream `inspect(...).<layer>.override`: writes use it to decide whether to target the language section. */
    public hasLanguageOverride(
        dottedKey: string,
        languageId: string,
        layer: "user" | "workspace" | "workspaceFolder",
    ): boolean {
        return this[layer].getOverride(languageId).get(dottedKey) !== undefined;
    }

    private value(dottedKey: string, languageId: string | undefined): unknown {
        return isOverrideKey(dottedKey) ? this.languageSection(dottedKey) : this.model(languageId).get(dottedKey);
    }

    /**
     * Upstream keeps `[lang]` in `contents`, so `get('[go]')` is the merged section keyed by setting ids.
     * Here the section arrives as a nested tree: a registered id is a setting whatever its value, and
     * an unregistered key (a removed extension's leftover) is guessed by {@link isSettingGroup}.
     * A combined `[a][b]` key is split into its languages on the way, so it has no section of its own.
     */
    private languageSection(key: string): Record<string, unknown> | undefined {
        const identifier = key.slice(1, -1);
        if (!this.merged.getOverrideIdentifiers().includes(identifier)) return undefined;
        const section: Record<string, unknown> = {};
        this.collectSettings(this.merged.getOverride(identifier).getValue() as Record<string, unknown>, "", section);
        return section;
    }

    private collectSettings(
        group: Readonly<Record<string, unknown>>,
        prefix: string,
        out: Record<string, unknown>,
    ): void {
        for (const [key, value] of Object.entries(group)) {
            const id = prefix + key;
            if (!this.settingIds.has(id) && isSettingGroup(value)) this.collectSettings(value, `${id}.`, out);
            else out[id] = value;
        }
    }

    private model(languageId: string | undefined): ConfigurationModel {
        // Stryker disable next-line ConditionalExpression: override() without a section returns the same model anyway — the branch is only for the type
        return languageId === undefined ? this.merged : this.merged.override(languageId);
    }
}

/**
 * For an unregistered key: a non-empty object whose keys all look like name segments is a group,
 * anything else is a value. An unregistered object-valued setting with such keys comes out split.
 */
function isSettingGroup(value: unknown): value is Record<string, unknown> {
    if (!isPlainObject(value)) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every((key) => /^[A-Za-z][\w-]*$/.test(key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";

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

    /** Anything that is not an object becomes an empty layer. */
    public setData(data: unknown): void {
        const layers = isPlainObject(data) ? data : {};
        this.defaults = ConfigurationModel.fromRaw(layers.defaults);
        this.user = ConfigurationModel.fromRaw(layers.user);
        this.workspace = ConfigurationModel.fromRaw(layers.workspace);
        this.workspaceFolder = ConfigurationModel.fromRaw(layers.workspaceFolder);
        this.merged = ConfigurationModel.merge(this.defaults, this.user, this.workspace, this.workspaceFolder);
    }

    public get(dottedKey: string, defaultValue?: unknown, languageId?: string): unknown {
        return this.model(languageId).get(dottedKey) ?? defaultValue;
    }

    public has(dottedKey: string, languageId?: string): boolean {
        return this.model(languageId).get(dottedKey) !== undefined;
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

    private model(languageId: string | undefined): ConfigurationModel {
        // Stryker disable next-line ConditionalExpression: override() without a section returns the same model anyway — the branch is only for the type
        return languageId === undefined ? this.merged : this.merged.override(languageId);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

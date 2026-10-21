import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";

/**
 * `get` в расширениях синхронный, поэтому слои главного процесса приезжают
 * push-моделью, а не RPC-per-get, и сливаются той же {@link ConfigurationModel}.
 * `workspaceFolder` — один слой, а не `folders` эталона: папка у нас одна. Фильтра
 * `language-overridable` нет — схем ядра субпроцесс не знает.
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

    /** Всё, что не объект, — пустой слой. */
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

    /** VS Code выставляет значения секции полями `WorkspaceConfiguration`. */
    public sectionKeys(section: string | undefined, languageId?: string): string[] {
        const node = this.model(languageId).getValue(section);
        return isPlainObject(node) ? Object.keys(node) : [];
    }

    /** `inspect(...).<layer>.override` эталона: по нему запись решает, писать ли в секцию языка. */
    public hasLanguageOverride(
        dottedKey: string,
        languageId: string,
        layer: "user" | "workspace" | "workspaceFolder",
    ): boolean {
        return this[layer].getOverride(languageId).get(dottedKey) !== undefined;
    }

    private model(languageId: string | undefined): ConfigurationModel {
        // Stryker disable next-line ConditionalExpression: override() без секции и так отдаёт ту же модель — ветка нужна только типу
        return languageId === undefined ? this.merged : this.merged.override(languageId);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

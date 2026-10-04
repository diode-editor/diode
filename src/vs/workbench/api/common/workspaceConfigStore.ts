import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";

/**
 * Хранилище конфигурации на стороне subprocess.
 *
 * `getConfiguration(...).get(...)` в расширениях синхронный, поэтому конфиг
 * доставляется push-моделью (см. host: `workspace.initialize` /
 * `workspace.configurationChanged`), а не RPC-per-get. Приезжают **слои**
 * главного процесса (`IConfigurationService.getConfigurationData()`):
 *
 * - `defaults` — дефолты из общего реестра: ядро, `contributes.configuration`
 *   всех расширений (в том числе ещё не активированных и декларативных) и их
 *   переопределения;
 * - `user` — пользовательские настройки активного профиля.
 *
 * Слияние — та же {@link ConfigurationModel}, что в главном процессе (аналог
 * `ExtHostConfigProvider` vscode поверх `configurationModels.ts`): своего
 * merge-кода и своего defaults-слоя у субпроцесса нет. Секции языков
 * (`"[python]"`) приезжают в тех же слоях; `languageId` у чтений выбирает
 * значение для языка. Фильтра `language-overridable` здесь нет — схем ядра
 * субпроцесс не знает.
 */

/** Результат покомпонентного inspect (подмножество `vscode`). */
export interface IConfigInspectResult {
    readonly key: string;
    readonly defaultValue: unknown;
    readonly globalValue: unknown;
    readonly value: unknown;
}

export class WorkspaceConfigStore {
    private defaults = ConfigurationModel.EMPTY;
    private user = ConfigurationModel.EMPTY;
    private merged = ConfigurationModel.EMPTY;

    /**
     * Заменяет слои данными главного процесса (`{ defaults, user }` — деревья).
     * Всё, что не объект, трактуется как пустой слой.
     */
    public setData(data: unknown): void {
        const layers = isPlainObject(data) ? data : {};
        this.defaults = ConfigurationModel.fromRaw(layers.defaults);
        this.user = ConfigurationModel.fromRaw(layers.user);
        this.merged = ConfigurationModel.merge(this.defaults, this.user);
    }

    /** Значение по dotted-ключу (для языка `languageId`, если задан); `defaultValue`, если ключа нет. */
    public get(dottedKey: string, defaultValue?: unknown, languageId?: string): unknown {
        return this.model(languageId).get(dottedKey) ?? defaultValue;
    }

    /** Есть ли ключ (в любом слое). */
    public has(dottedKey: string, languageId?: string): boolean {
        return this.model(languageId).get(dottedKey) !== undefined;
    }

    public inspect(dottedKey: string, languageId?: string): IConfigInspectResult {
        return {
            key: dottedKey,
            defaultValue: this.defaults.get(dottedKey),
            globalValue: this.user.get(dottedKey),
            value: this.model(languageId).get(dottedKey),
        };
    }

    /**
     * Собственные ключи поддерева `section` (для зеркалирования на объект
     * `WorkspaceConfiguration` — VS Code выставляет значения секции как поля).
     */
    public sectionKeys(section: string | undefined, languageId?: string): string[] {
        const node = this.model(languageId).getValue(section);
        return isPlainObject(node) ? Object.keys(node) : [];
    }

    private model(languageId: string | undefined): ConfigurationModel {
        // Stryker disable next-line ConditionalExpression: override() без секции и так отдаёт ту же модель — ветка нужна только типу
        return languageId === undefined ? this.merged : this.merged.override(languageId);
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

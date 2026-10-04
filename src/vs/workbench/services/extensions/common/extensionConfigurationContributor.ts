import type { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { collectConfigurationProperties } from "../../../../platform/extensions/common/configurationProperties.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/**
 * Расширение глазами контрибьютора: идентичность и `contributes` манифеста.
 * Подходит и запись скана (`IExtension`), и регистрация в host'е.
 */
export interface IConfigurationContributingExtension {
    readonly id: string;
    readonly manifest: object;
}

/**
 * Применяет вклад расширений в настройки к общему {@link ConfigurationRegistry}
 * (аналог `configurationExtPoint` vscode, `configurationExtensionPoint.ts`):
 *
 *   - `contributes.configuration` каждого расширения — включая декларативные и
 *     ещё не активированные — регистрируется как его ключи: ядро видит их
 *     дефолты, а валидатор settings.json перестаёт помечать их «unknown»;
 *   - `contributes.configurationDefaults` (плоские ключи и секции языков) и
 *     инъекции хоста (`configInjection`: курируемые дефолты сторонних
 *     расширений, пути вшитого сервера встроенного TS) ложатся переопределениями
 *     дефолтов — ниже пользовательских настроек.
 *
 * Регистрация разовая, на bootstrap и до сборки сервиса настроек: установка
 * расширения требует перезапуска, так что дельт и события изменения дефолтов,
 * как у vscode, не нужно. Дубль ключа — предупреждение в лог и пропуск.
 */
export class ExtensionConfigurationContributor<E extends IConfigurationContributingExtension> {
    public constructor(
        private readonly extensions: readonly E[],
        private readonly registry: ConfigurationRegistry,
        private readonly configInjection: (ext: E) => Readonly<Record<string, unknown>>,
        private readonly logger?: ILogger,
    ) {}

    public apply(): void {
        for (const ext of this.extensions) {
            this.registry.registerExtensionConfiguration(
                ext.id,
                collectConfigurationProperties(
                    (ext.manifest as { readonly contributes?: IExtensionContributions }).contributes?.configuration,
                ),
                (message) => this.logger?.warn(message),
            );
        }
        // Переопределения — после всех ключей: они могут касаться ключа соседнего
        // расширения. Сначала манифестные `configurationDefaults` (в том числе
        // секции языков: `"[makefile]": { "editor.insertSpaces": false }`), поверх —
        // инъекции хоста.
        for (const ext of this.extensions) {
            const contributes = (ext.manifest as { readonly contributes?: IExtensionContributions }).contributes;
            this.registry.registerDefaultConfigurations(contributes?.configurationDefaults ?? {});
        }
        for (const ext of this.extensions) {
            this.registry.registerDefaultConfigurations(this.configInjection(ext));
        }
    }
}

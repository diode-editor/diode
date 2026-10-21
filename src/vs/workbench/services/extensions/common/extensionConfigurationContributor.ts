import type { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { collectConfigurationProperties } from "../../../../platform/extensions/common/configurationProperties.ts";
import type { IExtensionContributions } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

export interface IConfigurationContributingExtension {
    readonly id: string;
    readonly manifest: object;
}

/**
 * Counterpart of vscode `configurationExtPoint`; keys are registered for non-activated extensions too.
 * Registration is one-shot, before the configuration service is built: installing an extension needs a restart.
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
        // Overrides go after all keys: they may touch a key of a neighboring extension.
        // Host injections go on top of manifest `configurationDefaults`.
        for (const ext of this.extensions) {
            const contributes = (ext.manifest as { readonly contributes?: IExtensionContributions }).contributes;
            this.registry.registerDefaultConfigurations(contributes?.configurationDefaults ?? {});
        }
        for (const ext of this.extensions) {
            this.registry.registerDefaultConfigurations(this.configInjection(ext));
        }
    }
}

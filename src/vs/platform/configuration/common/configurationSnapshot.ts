import {
    createConfigurationChangeEvent,
    diffConfigurationKeys,
    diffOverrideIdentifiers,
} from "./configurationChangeEvent.ts";
import type { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationPropertySchema } from "./configurationRegistry.ts";
import { languageConfiguration, sanitizeConfiguration } from "./configurationValidation.ts";
import type { IConfigurationChangeEvent, IConfigurationOverrides } from "./iConfigurationService.ts";

/** `merged` is the raw merge for diffing; read models are schema-validated, per-language ones lazily. */
export class ConfigurationSnapshot {
    private readonly base: ConfigurationModel;
    private readonly languages = new Map<string, ConfigurationModel>();

    public constructor(
        public readonly merged: ConfigurationModel,
        private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>,
    ) {
        this.base = sanitizeConfiguration(merged, schemas);
    }

    public model(overrides?: IConfigurationOverrides): ConfigurationModel {
        const identifier = overrides?.overrideIdentifier;
        // Stryker disable next-line ConditionalExpression: without a language the section path yields an equal model (no section); the branch saves a rebuild
        if (identifier === undefined) return this.base;
        let model = this.languages.get(identifier);
        if (model === undefined) {
            model = languageConfiguration(this.merged, identifier, this.schemas);
            this.languages.set(identifier, model);
        }
        return model;
    }

    public changeFrom(prev: ConfigurationSnapshot): IConfigurationChangeEvent | null {
        const affectedKeys = diffConfigurationKeys(prev.merged, this.merged);
        if (affectedKeys.length === 0) return null;
        return createConfigurationChangeEvent(affectedKeys, diffOverrideIdentifiers(prev.merged, this.merged));
    }
}

import {
    createConfigurationChangeEvent,
    diffConfigurationKeys,
    diffOverrideIdentifiers,
} from "./configurationChangeEvent.ts";
import type { ConfigurationModel } from "./configurationModel.ts";
import type { IConfigurationPropertySchema } from "./configurationRegistry.ts";
import { languageConfiguration, sanitizeConfiguration } from "./configurationValidation.ts";
import type { IConfigurationChangeEvent, IConfigurationOverrides } from "./iConfigurationService.ts";

/**
 * Итог слияния слоёв настроек на один момент — общий для файловой и
 * in-memory реализаций сервиса. Хранит сырую слитую модель (с секциями
 * языков) и лениво выводит из неё модели для чтения: основную и по языку,
 * обе прошедшие схему ключей ядра.
 */
export class ConfigurationSnapshot {
    private readonly base: ConfigurationModel;
    private readonly languages = new Map<string, ConfigurationModel>();

    /**
     * @param merged слитые слои (defaults → user → profile) как есть.
     * @param schemas схемы ключей ядра — для валидации значений и фильтра секций языков.
     */
    public constructor(
        public readonly merged: ConfigurationModel,
        private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>,
    ) {
        this.base = sanitizeConfiguration(merged, schemas);
    }

    /** Модель для чтения: основная или для языка `overrides.overrideIdentifier`. */
    public model(overrides?: IConfigurationOverrides): ConfigurationModel {
        const identifier = overrides?.overrideIdentifier;
        // Stryker disable next-line ConditionalExpression: без языка путь через секцию даёт равную модель (секции нет) — ветка экономит пересборку
        if (identifier === undefined) return this.base;
        let model = this.languages.get(identifier);
        if (model === undefined) {
            model = languageConfiguration(this.merged, identifier, this.schemas);
            this.languages.set(identifier, model);
        }
        return model;
    }

    /** Событие изменения относительно `prev`; `null`, если ничего не поменялось. */
    public changeFrom(prev: ConfigurationSnapshot): IConfigurationChangeEvent | null {
        const affectedKeys = diffConfigurationKeys(prev.merged, this.merged);
        if (affectedKeys.length === 0) return null;
        return createConfigurationChangeEvent(affectedKeys, diffOverrideIdentifiers(prev.merged, this.merged));
    }
}

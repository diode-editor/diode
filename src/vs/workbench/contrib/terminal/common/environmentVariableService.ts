import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IStateDescriptor,
    type IStateService,
    StateServiceDIToken,
} from "../../../../platform/state/common/iStateService.ts";
import {
    type IEnvironmentVariableCollectionStore,
    type IEnvironmentVariableCollectionWithPersistence,
    MergedEnvironmentVariableCollection,
    type SerializableEnvironmentDescriptionMap,
    type SerializableEnvironmentVariableCollection,
} from "../../../../platform/terminal/common/environmentVariable.ts";
import {
    parseWireEnvironmentDescriptions,
    parseWireEnvironmentVariableEntries,
} from "../../../api/common/wireTypes.ts";

interface ISerializableExtensionEnvironmentVariableCollection {
    readonly extensionIdentifier: string;
    readonly collection: SerializableEnvironmentVariableCollection;
    readonly description?: SerializableEnvironmentDescriptionMap;
}

/** Ключ и область эталона (`TerminalStorageKeys.EnvironmentVariableCollections`); у эталона значение — JSON-строка, у нас массив. */
export const ENVIRONMENT_VARIABLE_COLLECTIONS_STATE: IStateDescriptor<unknown> = {
    key: "terminal.integrated.environmentVariableCollectionsV2",
    scope: "workspace",
    default: [],
};

export const EnvironmentVariableServiceDIToken = token<EnvironmentVariableService>("EnvironmentVariableService");

/**
 * `EnvironmentVariableService` эталона. Коллекции с `persistent` живут в состоянии воркспейса;
 * коллекции удалённых расширений забываются, как только известен состав установленных.
 */
export class EnvironmentVariableService extends Disposable implements IEnvironmentVariableCollectionStore {
    private collectionsValue = new Map<string, IEnvironmentVariableCollectionWithPersistence>();
    private merged = new MergedEnvironmentVariableCollection(this.collectionsValue);
    /** Установлено ли расширение; до {@link setInstalledExtensions} — любое. */
    private isInstalled: (extensionIdentifier: string) => boolean = () => true;

    public static dependencies = [StateServiceDIToken] as const;

    public constructor(private readonly state: IStateService) {
        super();
        this.load();
        this.register(
            state.onDidOpenWorkspace(() => {
                this.load();
            }),
        );
    }

    public get collections(): ReadonlyMap<string, IEnvironmentVariableCollectionWithPersistence> {
        return this.collectionsValue;
    }

    public get mergedCollection(): MergedEnvironmentVariableCollection {
        return this.merged;
    }

    public set(extensionIdentifier: string, collection: IEnvironmentVariableCollectionWithPersistence): void {
        this.collectionsValue.set(extensionIdentifier, collection);
        this.update();
    }

    /** Коллекции удалённых — забыть, в том числе в состоянии. */
    public setInstalledExtensions(isInstalled: (extensionIdentifier: string) => boolean): void {
        this.isInstalled = isInstalled;
        const stale = [...this.collectionsValue.keys()].filter((id) => !isInstalled(id));
        if (stale.length === 0) return;
        for (const id of stale) this.collectionsValue.delete(id);
        this.update();
    }

    public delete(extensionIdentifier: string): void {
        this.collectionsValue.delete(extensionIdentifier);
        this.update();
    }

    private update(): void {
        this.persist();
        this.merged = new MergedEnvironmentVariableCollection(this.collectionsValue);
    }

    private persist(): void {
        const json: ISerializableExtensionEnvironmentVariableCollection[] = [];
        for (const [extensionIdentifier, collection] of this.collectionsValue) {
            if (!collection.persistent) continue;
            json.push({
                extensionIdentifier,
                collection: [...collection.map.entries()],
                description: [...(collection.descriptionMap ?? new Map()).entries()],
            });
        }
        this.state.store(ENVIRONMENT_VARIABLE_COLLECTIONS_STATE, json);
    }

    private load(): void {
        const raw = this.state.get(ENVIRONMENT_VARIABLE_COLLECTIONS_STATE);
        const collections = new Map<string, IEnvironmentVariableCollectionWithPersistence>();
        let dropped = false;
        // Stryker disable next-line ArrayDeclaration: эквивалентный — элемент-заглушка не объект с id и отбрасывается ниже
        for (const entry of Array.isArray(raw) ? (raw as unknown[]) : []) {
            const { extensionIdentifier, collection, description } = (
                typeof entry === "object" && entry !== null ? entry : {}
            ) as { extensionIdentifier?: unknown; collection?: unknown; description?: unknown };
            if (typeof extensionIdentifier !== "string") continue;
            if (!this.isInstalled(extensionIdentifier)) {
                dropped = true;
                continue;
            }
            collections.set(extensionIdentifier, {
                persistent: true,
                map: new Map(parseWireEnvironmentVariableEntries(collection)),
                descriptionMap: new Map(parseWireEnvironmentDescriptions(description)),
            });
        }
        this.collectionsValue = collections;
        this.merged = new MergedEnvironmentVariableCollection(collections);
        if (dropped) this.persist();
    }
}

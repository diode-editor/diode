import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type {
    ILanguageStatus,
    LanguageStatusService,
} from "../../services/languageStatus/common/languageStatusService.ts";
import type { ILanguageStatusSink } from "../common/iLanguageStatusSink.ts";
import type { IWireLanguageStatusItem } from "../common/wireTypes.ts";

/** Upstream `MainThreadLanguages.$setLanguageStatus`: every update replaces the item's status in the service. */
export class ExtensionLanguageStatusAdapter implements ILanguageStatusSink {
    private readonly items = new Map<number, IDisposable>();

    public constructor(private readonly service: LanguageStatusService) {}

    public update(item: IWireLanguageStatusItem): void {
        const previous = this.items.get(item.handle);
        // Add first, then drop the old one: the segment never sees a moment without the item.
        this.items.set(item.handle, this.service.addStatus(toLanguageStatus(item)));
        previous?.dispose();
    }

    public remove(handle: number): void {
        this.items.get(handle)?.dispose();
        this.items.delete(handle);
    }

    public clear(): void {
        for (const handle of [...this.items.keys()]) this.remove(handle);
    }
}

function toLanguageStatus(item: IWireLanguageStatusItem): ILanguageStatus {
    const { command } = item;
    return {
        id: item.id,
        name: item.name,
        selector: item.selector,
        severity: item.severity,
        label: item.text,
        detail: item.detail ?? "",
        busy: item.busy,
        source: item.source,
        command:
            command === undefined
                ? undefined
                : { id: command.command, title: command.title, arguments: command.arguments ?? [] },
    };
}

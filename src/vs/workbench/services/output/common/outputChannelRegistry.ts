import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { IOutputChannelDescriptor, IOutputChannelRegistry } from "./output.ts";

/**
 * Re-registering an id is a no-op, as in VS Code: otherwise the "declared in bootstrap /
 * created on first write" race would overwrite the label with the raw id.
 */
export class OutputChannelRegistry implements IOutputChannelRegistry {
    public static dependencies = [] as const;

    private readonly channels = new Map<string, IOutputChannelDescriptor>();
    private readonly onDidRegisterChannelEmitter = new Emitter<IOutputChannelDescriptor>();

    public registerChannel(descriptor: IOutputChannelDescriptor): void {
        if (this.channels.has(descriptor.id)) return;
        this.channels.set(descriptor.id, descriptor);
        this.onDidRegisterChannelEmitter.fire(descriptor);
    }

    /** A snapshot in registration order, which is also the selector item order. */
    public getChannels(): readonly IOutputChannelDescriptor[] {
        return [...this.channels.values()];
    }

    public getChannel(id: string): IOutputChannelDescriptor | undefined {
        return this.channels.get(id);
    }

    public readonly onDidRegisterChannel = this.onDidRegisterChannelEmitter.event;
}

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import type { IOutputChannelDescriptor, IOutputChannelRegistry } from "./output.ts";

/**
 * Повторная регистрация id — no-op, как у VS Code: иначе гонка «объявили в bootstrap /
 * досоздали по первой записи» перетирала бы label на сырой id.
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

    /** Снимок в порядке регистрации — он же порядок пунктов селектора. */
    public getChannels(): readonly IOutputChannelDescriptor[] {
        return [...this.channels.values()];
    }

    public getChannel(id: string): IOutputChannelDescriptor | undefined {
        return this.channels.get(id);
    }

    public readonly onDidRegisterChannel = this.onDidRegisterChannelEmitter.event;
}

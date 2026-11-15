import { type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type {
    ContributedProfileCreator,
    IExtensionTerminalProfileSink,
} from "../../../api/common/iExtensionWindowSinks.ts";
import { ON_TERMINAL_PROFILE_PREFIX } from "../../../services/extensions/common/activationEvents.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import { type IExtensionTerminalProfile, parseTerminalProfiles } from "../common/terminalExtensionPoints.ts";

import type { TerminalTarget } from "./terminalService.ts";

export const TerminalProfileServiceDIToken = token<TerminalProfileService>("TerminalProfileService");

/**
 * Upstream `TerminalProfileService`, the contributed half: the manifests' `contributes.terminal.profiles` and the
 * providers the extensions register for them. There are no configured profiles (`terminal.integrated.profiles.*`).
 */
export class TerminalProfileService implements IExtensionTerminalProfileSink {
    public static dependencies = [] as const;

    private contributed: readonly IExtensionTerminalProfile[] = [];
    /** Keyed by extension id, then by profile id, as upstream. */
    private readonly providers = new Map<string, Map<string, ContributedProfileCreator>>();
    private activate: (event: string) => Promise<void> = () => Promise.resolve();

    public get contributedProfiles(): readonly IExtensionTerminalProfile[] {
        return this.contributed;
    }

    public setContributedProfiles(profiles: readonly IExtensionTerminalProfile[]): void {
        this.contributed = profiles;
    }

    /** The extension service, so the profile's extension starts before its provider is looked up. */
    public setActivator(activate: (event: string) => Promise<void>): void {
        this.activate = activate;
    }

    public registerProvider(extensionId: string, id: string, create: ContributedProfileCreator): IDisposable {
        let byId = this.providers.get(extensionId);
        if (byId === undefined) {
            byId = new Map();
            this.providers.set(extensionId, byId);
        }
        byId.set(id, create);
        const registered = byId;
        return toDisposable(() => {
            if (registered.get(id) === create) registered.delete(id);
        });
    }

    /** Upstream `TerminalService.createContributedTerminalProfile`; rejects when no provider answers for the id. */
    public async createContributedTerminalProfile(
        profile: IExtensionTerminalProfile,
        target: TerminalTarget,
    ): Promise<void> {
        await this.activate(`${ON_TERMINAL_PROFILE_PREFIX}${profile.id}`);
        const create = this.providers.get(profile.extensionIdentifier)?.get(profile.id);
        if (create === undefined) throw new Error(`No terminal profile provider registered for id "${profile.id}"`);
        await create(target);
    }
}

/** Static contributions of the manifests, no activation (upstream `terminalsExtPoint.setHandler`). */
export function bindExtensionTerminalProfiles(
    profiles: TerminalProfileService,
    extensions: IExtensionService,
    logger: ILogger,
): void {
    profiles.setContributedProfiles(
        extensions.extensions.flatMap((extension) =>
            parseTerminalProfiles(extension.id, extension.manifest.contributes?.terminal, (message) => {
                logger.warn(`${extension.id}: ${message}`);
            }),
        ),
    );
    profiles.setActivator((event) => extensions.activateByEvent(event));
}

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
    /**
     * By profile id alone, like upstream `MainThreadTerminalService`: the subprocess keeps the id unique across
     * extensions. Deviation from upstream's (extension, id) lookup — the extension's identity in the subprocess comes
     * from the importing module's path and is not a reliable key.
     */
    private readonly providers = new Map<string, ContributedProfileCreator>();
    // Stryker disable next-line ArrowFunction: equivalent — awaiting `undefined` is the same as awaiting a resolved promise
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

    public registerProvider(id: string, create: ContributedProfileCreator): IDisposable {
        this.providers.set(id, create);
        return toDisposable(() => {
            if (this.providers.get(id) === create) this.providers.delete(id);
        });
    }

    /** Upstream `TerminalService.createContributedTerminalProfile`; rejects when no provider answers for the id. */
    public async createContributedTerminalProfile(
        profile: IExtensionTerminalProfile,
        target: TerminalTarget,
    ): Promise<void> {
        await this.activate(`${ON_TERMINAL_PROFILE_PREFIX}${profile.id}`);
        const create = this.providers.get(profile.id);
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

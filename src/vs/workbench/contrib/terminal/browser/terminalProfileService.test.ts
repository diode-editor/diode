import { describe, expect, it, vi } from "vitest";

import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IExtensionService } from "../../../services/extensions/common/extensions.ts";
import type { IExtensionTerminalProfile } from "../common/terminalExtensionPoints.ts";

import { bindExtensionTerminalProfiles, TerminalProfileService } from "./terminalProfileService.ts";

const PROFILE: IExtensionTerminalProfile = { extensionIdentifier: "ms-vscode.js-debug", id: "debug", title: "Debug" };

describe("TerminalProfileService.createContributedTerminalProfile", () => {
    it("activates onTerminalProfile:<id> first, then asks the provider registered during that activation", async () => {
        const service = new TerminalProfileService();
        const calls: string[] = [];
        service.setActivator((event) => {
            calls.push(event);
            service.registerProvider(PROFILE.id, (location) => {
                calls.push(`create ${location}`);
                return Promise.resolve();
            });
            return Promise.resolve();
        });
        await service.createContributedTerminalProfile(PROFILE, "panel");
        await service.createContributedTerminalProfile(PROFILE, "editor");
        expect(calls).toStrictEqual([
            "onTerminalProfile:debug",
            "create panel",
            "onTerminalProfile:debug",
            "create editor",
        ]);
    });

    it("starts with no contributed profiles", () => {
        expect(new TerminalProfileService().contributedProfiles).toStrictEqual([]);
    });

    it("without an activator the registered provider is used directly", async () => {
        const service = new TerminalProfileService();
        const create = vi.fn(() => Promise.resolve());
        service.registerProvider("debug", create);
        await service.createContributedTerminalProfile(PROFILE, "panel");
        expect(create).toHaveBeenCalledWith("panel");
    });

    it("a provider of another id does not answer; the rejection names the id", async () => {
        const service = new TerminalProfileService();
        const create = vi.fn(() => Promise.resolve());
        service.registerProvider("other", create);
        await expect(service.createContributedTerminalProfile(PROFILE, "panel")).rejects.toThrow(
            'No terminal profile provider registered for id "debug"',
        );
        expect(create).not.toHaveBeenCalled();
    });

    it("the provider's failure is the caller's rejection", async () => {
        const service = new TerminalProfileService();
        service.registerProvider("debug", () => Promise.reject(new Error("no options")));
        await expect(service.createContributedTerminalProfile(PROFILE, "panel")).rejects.toThrow("no options");
    });

    it("disposing a registration removes it, but not a newer one for the same id", async () => {
        const service = new TerminalProfileService();
        const older = vi.fn(() => Promise.resolve());
        const newer = vi.fn(() => Promise.resolve());
        const first = service.registerProvider("debug", older);
        first.dispose();
        await expect(service.createContributedTerminalProfile(PROFILE, "panel")).rejects.toThrow();
        const second = service.registerProvider("debug", older);
        service.registerProvider("debug", newer);
        second.dispose();
        await service.createContributedTerminalProfile(PROFILE, "panel");
        expect(newer).toHaveBeenCalledOnce();
        expect(older).not.toHaveBeenCalled();
    });
});

describe("bindExtensionTerminalProfiles", () => {
    function extension(id: string, terminal: unknown): IExtension {
        return { id, manifest: { contributes: { terminal } } } as unknown as IExtension;
    }

    it("collects the manifests' profiles in extension order, warns per extension, activates through the service", async () => {
        const service = new TerminalProfileService();
        const activateByEvent = vi.fn(() => Promise.resolve());
        const extensions = {
            extensions: [
                extension("a.first", { profiles: [{ id: "one", title: "One", icon: "debug" }, { title: "broken" }] }),
                { id: "b.none", manifest: {} } as unknown as IExtension,
                extension("c.third", { profiles: [{ id: "two", title: "Two" }] }),
            ],
            activateByEvent,
        } as unknown as IExtensionService;
        const warn = vi.fn();
        bindExtensionTerminalProfiles(service, extensions, { warn } as unknown as ILogger);
        expect(service.contributedProfiles).toStrictEqual([
            { extensionIdentifier: "a.first", id: "one", title: "One", icon: "debug" },
            { extensionIdentifier: "c.third", id: "two", title: "Two" },
        ]);
        expect(warn).toHaveBeenCalledExactlyOnceWith(
            "a.first: A terminal profile needs a string 'id' and 'title'; it is skipped.",
        );
        await expect(
            service.createContributedTerminalProfile(service.contributedProfiles[1], "panel"),
        ).rejects.toThrow();
        expect(activateByEvent).toHaveBeenCalledExactlyOnceWith("onTerminalProfile:two");
    });
});

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../../../platform/configuration/common/configurationRegistryDIToken.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import { DiskFileSystemProvider } from "../../../../platform/files/node/diskFileSystemProvider.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { StateFileStore } from "../../../../platform/state/node/stateService.ts";
import {
    type IUserDataProfile,
    IUserDataProfilesServiceDIToken,
    PROFILE_ASSOCIATIONS_STATE,
    profileWorkspaceKeyOf,
} from "../../../../platform/userDataProfile/common/userDataProfile.ts";
import { UserDataProfilesService } from "../../../../platform/userDataProfile/node/userDataProfilesService.ts";
import type { IWorkspace } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { LifecycleServiceDIToken } from "../../../services/lifecycle/browser/lifecycleService.ts";
import { HostProcessDIToken, type IRelaunchRequest } from "../../../services/lifecycle/common/hostProcess.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { IUserDataProfileServiceDIToken } from "../../../services/userDataProfile/common/userDataProfile.ts";

import {
    copyProfileContents,
    createProfileAction,
    deleteProfileAction,
    formattingOptionsOf,
    NEW_PROFILE_COPY_LABEL,
    NEW_PROFILE_EMPTY_LABEL,
    profileNameExistsMessage,
    switchProfileAction,
    USER_DATA_PROFILE_ACTIONS,
    withoutKeys,
} from "./userDataProfileActions.ts";

interface INotice {
    readonly severity: string;
    readonly message: string;
    readonly modal: boolean;
    readonly items: readonly unknown[];
}

interface IHarness {
    readonly accessor: ServiceAccessor;
    readonly profiles: UserDataProfilesService;
    readonly state: StateFileStore;
    readonly files: FileService;
    readonly restarts: (IRelaunchRequest | undefined)[];
    readonly notices: INotice[];
    readonly pickItems: QuickPickItem[][];
    readonly pickOptions: { title?: string; placeholder?: string }[];
    readonly inputOptions: { title?: string; placeholder?: string }[];
    readonly inputValidators: ((value: string) => unknown)[];
    setCurrent(profile: IUserDataProfile): void;
    setWorkspace(workspace: IWorkspace): void;
    /** Single-pick answers in order: a row label or `undefined` for cancel. */
    setPicks(labels: (string | undefined)[]): void;
    setManyPicks(labels: string[] | undefined): void;
    setInputs(values: (string | undefined)[]): void;
    /** Skips the farewell (`requestShutdown` calls the continuation or not). */
    cancelShutdown: { value: boolean };
}

describe("profile actions", () => {
    let ws: ITempWorkspace;
    let h: IHarness;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-profile-actions-" });
        h = makeHarness(ws.dir);
    });

    afterEach(() => {
        h.files.dispose();
        ws.dispose();
    });

    function makeHarness(root: string): IHarness {
        const userDir = path.join(root, "User");
        const state = new StateFileStore(undefined);
        const profiles = new UserDataProfilesService({
            profilesHome: path.join(userDir, "profiles"),
            defaultProfileHome: userDir,
            state,
        });
        const files = new FileService();
        files.registerProvider("file", new DiskFileSystemProvider());
        let current = profiles.defaultProfile;
        let workspace: IWorkspace = { id: null, folders: [] };
        let picks: (string | undefined)[] = [];
        let manyPicks: string[] | undefined;
        let inputs: (string | undefined)[] = [];
        const restarts: (IRelaunchRequest | undefined)[] = [];
        const notices: INotice[] = [];
        const pickItems: QuickPickItem[][] = [];
        const pickOptions: { title?: string; placeholder?: string }[] = [];
        const inputOptions: { title?: string; placeholder?: string }[] = [];
        const inputValidators: ((value: string) => unknown)[] = [];
        const cancelShutdown = { value: false };
        const registry = new ConfigurationRegistry([
            {
                id: "test",
                properties: {
                    "update.mode": { scope: "application", type: "string", default: "default" },
                    "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
                },
            },
        ]);
        const services = new Map<unknown, unknown>([
            [IUserDataProfilesServiceDIToken, profiles],
            [
                IUserDataProfileServiceDIToken,
                {
                    get currentProfile() {
                        return current;
                    },
                },
            ],
            [IWorkspaceContextServiceDIToken, { getWorkspace: () => workspace }],
            [IFileServiceDIToken, files],
            [ConfigurationRegistryDIToken, registry],
            [
                NotificationServiceDIToken,
                {
                    show: (notice: INotice) => {
                        notices.push(notice);
                    },
                },
            ],
            [
                LifecycleServiceDIToken,
                {
                    requestShutdown: async (onProceed: () => unknown) => {
                        if (!cancelShutdown.value) await onProceed();
                    },
                    shutdown: async (_reason: string, then: () => void) => {
                        then();
                    },
                },
            ],
            [
                HostProcessDIToken,
                {
                    exit: () => undefined,
                    restart: (relaunch?: IRelaunchRequest) => {
                        restarts.push(relaunch);
                    },
                },
            ],
            [
                QuickInputServiceDIToken,
                {
                    input: (opts: {
                        title?: string;
                        placeholder?: string;
                        validateInput?: (value: string) => unknown;
                    }) => {
                        inputOptions.push({ title: opts.title, placeholder: opts.placeholder });
                        if (opts.validateInput) inputValidators.push(opts.validateInput);
                        return Promise.resolve(inputs.shift());
                    },
                    quickPick: (opts: { items: QuickPickItem[]; title?: string; placeholder?: string }) => {
                        pickItems.push(opts.items);
                        pickOptions.push({ title: opts.title, placeholder: opts.placeholder });
                        const label = picks.shift();
                        return Promise.resolve(
                            label === undefined ? undefined : opts.items.find((item) => item.label === label),
                        );
                    },
                    quickPickMany: (opts: { items: QuickPickItem[]; title?: string; placeholder?: string }) => {
                        pickItems.push(opts.items);
                        pickOptions.push({ title: opts.title, placeholder: opts.placeholder });
                        return Promise.resolve(
                            manyPicks === undefined
                                ? undefined
                                : opts.items.filter((item) => manyPicks?.includes(item.label)),
                        );
                    },
                },
            ],
        ]);
        return {
            accessor: {
                get(token: unknown) {
                    if (services.has(token)) return services.get(token);
                    throw new Error("unexpected token");
                },
            } as unknown as ServiceAccessor,
            profiles,
            state,
            files,
            restarts,
            notices,
            pickItems,
            pickOptions,
            inputOptions,
            inputValidators,
            setCurrent: (profile) => {
                current = profile;
            },
            setWorkspace: (w) => {
                workspace = w;
            },
            setPicks: (labels) => {
                picks = labels;
            },
            setManyPicks: (labels) => {
                manyPicks = labels;
            },
            setInputs: (values) => {
                inputs = values;
            },
            cancelShutdown,
        };
    }

    const folderWorkspace = (dir: string): IWorkspace => ({
        id: "x",
        folders: [{ uri: Uri.file(dir), name: path.basename(dir), index: 0 }],
    });

    it("command IDs and titles match upstream, category Profiles", () => {
        expect(USER_DATA_PROFILE_ACTIONS.map((a) => [a.id, a.title])).toEqual([
            ["workbench.profiles.actions.switchProfile", "Profiles: Switch Profile..."],
            ["workbench.profiles.actions.createProfile", "Profiles: New Profile..."],
            ["workbench.profiles.actions.deleteProfile", "Profiles: Delete Profile..."],
        ]);
    });

    describe("Switch Profile", () => {
        it("alphabetical picker with a check on the current one; picking associates the workspace and reloads into the profile", async () => {
            const work = await h.profiles.createNamedProfile("work");
            await h.profiles.createNamedProfile("alpha");
            h.setWorkspace(folderWorkspace(path.join(ws.dir, "proj")));
            h.setPicks(["work"]);

            await switchProfileAction.run(h.accessor);

            expect(h.pickItems[0]?.map((i) => i.label)).toEqual(["alpha", `${CODICON_GLYPHS.check} Default`, "work"]);
            expect(h.pickItems[0]?.[1]?.label).not.toContain("$(");
            expect(h.pickOptions[0]?.placeholder).toBe("Select Profile");
            expect(h.profiles.getProfileForWorkspace(profileWorkspaceKeyOf(path.join(ws.dir, "proj")))).toEqual(work);
            expect(h.restarts).toEqual([{ profile: "work" }]);
        });

        it("a window from .code-workspace is associated by file, not by folder", async () => {
            const work = await h.profiles.createNamedProfile("work");
            const file = path.join(ws.dir, "web.code-workspace");
            h.setWorkspace({ ...folderWorkspace(path.join(ws.dir, "proj")), configuration: Uri.file(file) });
            h.setPicks(["work"]);

            await switchProfileAction.run(h.accessor);

            expect(h.profiles.getProfileForWorkspace(profileWorkspaceKeyOf(file))).toEqual(work);
            expect(h.profiles.getProfileForWorkspace(profileWorkspaceKeyOf(path.join(ws.dir, "proj")))).toBeUndefined();
        });

        it("empty window: no association, only reload into the profile", async () => {
            await h.profiles.createNamedProfile("work");
            h.setPicks(["work"]);

            await switchProfileAction.run(h.accessor);

            expect(h.restarts).toEqual([{ profile: "work" }]);
            expect(h.state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({});
        });

        it("picking the current one or cancelling does nothing", async () => {
            await h.profiles.createNamedProfile("work");
            h.setWorkspace(folderWorkspace(path.join(ws.dir, "proj")));
            h.setPicks([`${CODICON_GLYPHS.check} Default`, undefined]);

            await switchProfileAction.run(h.accessor);
            await switchProfileAction.run(h.accessor);

            expect(h.restarts).toEqual([]);
            expect(h.profiles.getProfileForWorkspace(profileWorkspaceKeyOf(path.join(ws.dir, "proj")))).toBeUndefined();
        });

        it("Cancel in the shutdown dialog keeps the window in place (the association is already written)", async () => {
            await h.profiles.createNamedProfile("work");
            h.setWorkspace(folderWorkspace(path.join(ws.dir, "proj")));
            h.setPicks(["work"]);
            h.cancelShutdown.value = true;

            await switchProfileAction.run(h.accessor);

            expect(h.restarts).toEqual([]);
            expect(h.profiles.getProfileForWorkspace(profileWorkspaceKeyOf(path.join(ws.dir, "proj")))?.name).toBe(
                "work",
            );
        });

        it("association refusal — error toast, the refusal propagates to the command log, no reload", async () => {
            await h.profiles.createNamedProfile("work");
            h.setWorkspace(folderWorkspace(path.join(ws.dir, "proj")));
            h.setPicks(["work"]);
            vi.spyOn(h.profiles, "setProfileForWorkspace").mockRejectedValueOnce(new Error("EACCES"));

            await expect(switchProfileAction.run(h.accessor)).rejects.toThrow("EACCES");

            expect(h.notices).toEqual([{ severity: "error", message: "EACCES", modal: false, items: [] }]);
            expect(h.restarts).toEqual([]);
        });
    });

    describe("New Profile", () => {
        it("name → Empty → profile created empty, workspace associated, window reloads", async () => {
            const current = h.profiles.defaultProfile;
            fs.mkdirSync(current.location, { recursive: true });
            fs.writeFileSync(current.settingsResource, `{ "editor.tabSize": 2 }`);
            h.setWorkspace(folderWorkspace(path.join(ws.dir, "proj")));
            h.setInputs(["  My Work "]);
            h.setPicks([NEW_PROFILE_EMPTY_LABEL]);

            await createProfileAction.run(h.accessor);

            const created = h.profiles.profiles.find((p) => p.name === "My Work");
            expect(created).toBeDefined();
            // Empty: the current profile's settings aren't copied, no extensions.
            expect(fs.existsSync(created!.settingsResource)).toBe(false);
            expect(fs.readFileSync(created!.extensionsResource, "utf-8")).toBe("[]");
            expect(h.inputOptions).toEqual([{ title: "New Profile", placeholder: "Profile name" }]);
            expect(h.pickOptions).toEqual([
                { title: "New Profile", placeholder: "Select the contents of the new profile" },
            ]);
            expect(h.pickItems[0]?.map((i) => i.label)).toEqual([NEW_PROFILE_EMPTY_LABEL, NEW_PROFILE_COPY_LABEL]);
            expect(h.pickItems[0]?.[0]?.description).toBe("Start with no settings, keybindings and extensions");
            expect(h.pickItems[0]?.[1]?.description).toBe("Default");
            expect(h.profiles.getProfileForWorkspace(profileWorkspaceKeyOf(path.join(ws.dir, "proj")))).toEqual(
                created,
            );
            expect(h.restarts).toEqual([{ profile: "My Work" }]);
        });

        it("Copy from current copies settings.json without application keys, keybindings.json and extensions.json", async () => {
            const current = h.profiles.defaultProfile;
            fs.mkdirSync(current.location, { recursive: true });
            fs.writeFileSync(
                current.settingsResource,
                `{\n    // theme\n    "workbench.colorTheme": "Light Modern",\n    "update.mode": "none",\n    "editor.tabSize": 2\n}\n`,
            );
            fs.writeFileSync(current.keybindingsResource, `[{ "key": "f9", "command": "x" }]`);
            const extensions = `[{"identifier":{"id":"acme.tools"},"version":"1.0.0"}]`;
            fs.mkdirSync(path.dirname(current.extensionsResource), { recursive: true });
            fs.writeFileSync(current.extensionsResource, extensions);
            h.setInputs(["work"]);
            h.setPicks([NEW_PROFILE_COPY_LABEL]);

            await createProfileAction.run(h.accessor);

            const created = h.profiles.profiles.find((p) => p.name === "work")!;
            expect(fs.readFileSync(created.settingsResource, "utf-8")).toBe(
                `{\n    // theme\n    "workbench.colorTheme": "Light Modern",\n    "editor.tabSize": 2\n}\n`,
            );
            expect(fs.readFileSync(created.keybindingsResource, "utf-8")).toBe(`[{ "key": "f9", "command": "x" }]`);
            expect(fs.readFileSync(created.extensionsResource, "utf-8")).toBe(extensions);
            expect(h.restarts).toEqual([{ profile: "work" }]);
        });

        it("name validation: empty — no error, taken — upstream text", async () => {
            await h.profiles.createNamedProfile("work");
            h.setInputs([undefined]);

            await createProfileAction.run(h.accessor);

            const validate = h.inputValidators[0];
            expect(validate("")).toBeNull();
            expect(validate("   ")).toBeNull();
            expect(validate("new")).toBeNull();
            expect(validate(" work ")).toBe("Profile with name work already exists.");
            expect(validate("Default")).toBe(profileNameExistsMessage("Default"));
        });

        it("creation refusal (ENAMETOOLONG on mkdir) — error toast, non-Error — its text", async () => {
            h.setWorkspace(folderWorkspace(path.join(ws.dir, "proj")));
            h.setInputs(["x", "y"]);
            h.setPicks([NEW_PROFILE_EMPTY_LABEL, NEW_PROFILE_EMPTY_LABEL]);
            vi.spyOn(h.profiles, "createNamedProfile")
                .mockRejectedValueOnce(new Error("ENAMETOOLONG"))
                .mockRejectedValueOnce("plain reason");

            await expect(createProfileAction.run(h.accessor)).rejects.toThrow("ENAMETOOLONG");
            await expect(createProfileAction.run(h.accessor)).rejects.toBe("plain reason");

            expect(h.notices).toEqual([
                { severity: "error", message: "ENAMETOOLONG", modal: false, items: [] },
                { severity: "error", message: "plain reason", modal: false, items: [] },
            ]);
            expect(h.profiles.profiles).toHaveLength(1);
            expect(h.restarts).toEqual([]);
        });

        it("cancelled name, empty name or cancelled second step — no profile is created", async () => {
            // If cancel or blanks reached the second step, "Empty" would create a profile.
            h.setInputs([undefined]);
            h.setPicks([NEW_PROFILE_EMPTY_LABEL]);
            await createProfileAction.run(h.accessor);
            h.setInputs(["   "]);
            h.setPicks([NEW_PROFILE_EMPTY_LABEL]);
            await createProfileAction.run(h.accessor);
            h.setInputs(["x"]);
            h.setPicks([undefined]);
            await createProfileAction.run(h.accessor);

            expect(h.pickItems).toHaveLength(1);
            expect(h.profiles.profiles).toHaveLength(1);
            expect(h.restarts).toEqual([]);
        });
    });

    describe("Delete Profile", () => {
        it("multi-select of named profiles, the current one marked 'Current'; deleting a non-current one — no reload", async () => {
            const work = await h.profiles.createNamedProfile("work");
            const home = await h.profiles.createNamedProfile("home");
            h.setCurrent(work);
            h.setManyPicks(["home"]);

            await deleteProfileAction.run(h.accessor);

            expect(h.pickItems[0]).toEqual([
                { label: "work", description: "Current", profile: work },
                { label: "home", profile: home },
            ]);
            expect(h.pickOptions[0]).toEqual({ title: "Delete Profile...", placeholder: "Select Profiles to Delete" });
            expect(h.profiles.profiles.map((p) => p.name)).toEqual(["Default", "work"]);
            expect(h.restarts).toEqual([]);
        });

        it("current one deleted — the window reloads into the workspace profile (Default after the association is removed)", async () => {
            const work = await h.profiles.createNamedProfile("work");
            const dir = path.join(ws.dir, "proj");
            await h.profiles.setProfileForWorkspace(profileWorkspaceKeyOf(dir), work);
            h.setWorkspace(folderWorkspace(dir));
            h.setCurrent(work);
            h.setManyPicks(["work"]);

            await deleteProfileAction.run(h.accessor);

            expect(h.profiles.profiles).toHaveLength(1);
            expect(h.restarts).toEqual([{ profile: "Default" }]);
        });

        it("current one deleted among others while the workspace is associated with another profile — reload into it", async () => {
            const work = await h.profiles.createNamedProfile("work");
            const home = await h.profiles.createNamedProfile("home");
            await h.profiles.createNamedProfile("tmp");
            const dir = path.join(ws.dir, "proj");
            await h.profiles.setProfileForWorkspace(profileWorkspaceKeyOf(dir), home);
            h.setWorkspace(folderWorkspace(dir));
            h.setCurrent(work); // window started with `--profile work`, bound to `home`
            h.setManyPicks(["work", "tmp"]);

            await deleteProfileAction.run(h.accessor);

            expect(h.profiles.profiles.map((p) => p.name)).toEqual(["Default", "home"]);
            expect(h.restarts).toEqual([{ profile: "home" }]);
        });

        it("without named profiles the picker does not open; cancel and empty selection do nothing", async () => {
            await deleteProfileAction.run(h.accessor);
            expect(h.pickItems).toEqual([]);

            await h.profiles.createNamedProfile("work");
            h.setManyPicks(undefined);
            await deleteProfileAction.run(h.accessor);
            h.setManyPicks([]);
            await deleteProfileAction.run(h.accessor);

            expect(h.profiles.profiles).toHaveLength(2);
            expect(h.restarts).toEqual([]);
        });

        it("deletion refusal — error toast, the rest still runs", async () => {
            const work = await h.profiles.createNamedProfile("work");
            h.setManyPicks(["work"]);
            const remove = vi.spyOn(h.profiles, "removeProfile").mockRejectedValueOnce(new Error("EBUSY"));

            await deleteProfileAction.run(h.accessor);

            remove.mockRestore();
            expect(h.notices).toEqual([{ severity: "error", message: "EBUSY", modal: false, items: [] }]);
            expect(h.profiles.profiles.map((p) => p.id)).toContain(work.id);
        });
    });

    describe("copyProfileContents / withoutKeys", () => {
        it("source has no files — nothing is written", async () => {
            const from = h.profiles.defaultProfile;
            const to = await h.profiles.createNamedProfile("to");
            await copyProfileContents(h.files, from, to, ["update.mode"]);
            expect(fs.existsSync(to.settingsResource)).toBe(false);
            expect(fs.existsSync(to.keybindingsResource)).toBe(false);
            expect(fs.readFileSync(to.extensionsResource, "utf-8")).toBe("[]");
        });

        it("withoutKeys: removes only the listed keys, the rest verbatim; non-object — as is", () => {
            // jsonc `modify` reformats the neighbors of the removed key — normal for the settings editor.
            expect(withoutKeys(`{ "a": 1, "b": 2 }`, ["a", "zzz"])).toBe(`{\n    "b": 2\n}`);
            expect(withoutKeys(`{ "a": 1 }`, ["b"])).toBe(`{ "a": 1 }`);
            expect(withoutKeys(`[1, 2]`, ["a"])).toBe(`[1, 2]`);
            expect(withoutKeys(`not json`, ["a"])).toBe(`not json`);
            expect(withoutKeys(`null`, ["a"])).toBe(`null`);
        });

        it("withoutKeys: sibling indentation follows the file (2 spaces, tab), a comment before the key does not throw it off", () => {
            expect(withoutKeys(`{\n  "a": false,\n  // c\n  "b": "x"\n}\n`, ["b"])).toBe(`{\n  "a": false\n}\n`);
            expect(withoutKeys(`{\n  "a": false,\n  // c\n  "b": "x",\n  "z": 1\n}\n`, ["b"])).toBe(
                `{\n  "a": false,\n  "z": 1\n}\n`,
            );
            expect(withoutKeys(`{\n\t"a": false,\n\t// c\n\t"b": "x"\n}\n`, ["b"])).toBe(`{\n\t"a": false\n}\n`);
            expect(formattingOptionsOf(`{\n   "a": 1\n}`)).toEqual({ insertSpaces: true, tabSize: 3 });
            // A whitespace-only line is not an indent.
            expect(formattingOptionsOf(`{\n \n  "a": 1\n}`)).toEqual({ insertSpaces: true, tabSize: 2 });
            expect(formattingOptionsOf(`{ "a": 1 }`)).toEqual({ insertSpaces: true, tabSize: 4 });
            expect(formattingOptionsOf(`{\n\t"a": 1\n}`)).toMatchObject({ insertSpaces: false });
        });
    });
});

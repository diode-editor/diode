import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Event } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import type { IWorkspace } from "../../workspace/common/iWorkspaceContextService.ts";

import {
    createDefaultProfile,
    DEFAULT_PROFILE_ID,
    DEFAULT_PROFILE_NAME,
    isValidProfileId,
    type IUserDataProfile,
    type IUserDataProfilesService,
    MAX_PROFILE_ID_LENGTH,
    PROFILE_ID_PATTERN,
    profileForWorkspace,
    profileIdFromName,
    profileWorkspaceKey,
    profileWorkspaceKeyOf,
    resolveActiveProfile,
    toUserDataProfile,
} from "./userDataProfile.ts";

describe("toUserDataProfile / createDefaultProfile", () => {
    it("lays out resources under the profile directory", () => {
        const p = toUserDataProfile("work", "Work", "/u/User/profiles/work");
        expect(p).toEqual({
            id: "work",
            name: "Work",
            isDefault: false,
            location: "/u/User/profiles/work",
            settingsResource: path.join("/u/User/profiles/work", "settings.json"),
            keybindingsResource: path.join("/u/User/profiles/work", "keybindings.json"),
            globalStorageHome: path.join("/u/User/profiles/work", "globalStorage"),
            extensionsResource: path.join("/u/User/profiles/work", "extensions.json"),
        });
    });

    it("Default lives directly in User/ with the upstream id and name", () => {
        const d = createDefaultProfile("/u/User");
        expect(d.isDefault).toBe(true);
        expect(d.id).toBe(DEFAULT_PROFILE_ID);
        expect(d.name).toBe(DEFAULT_PROFILE_NAME);
        expect(d.settingsResource).toBe(path.join("/u/User", "settings.json"));
    });
});

describe("profileIdFromName", () => {
    it("keeps a valid name as is, case included", () => {
        expect(profileIdFromName("My.Work_1-x", [])).toBe("My.Work_1-x");
    });

    it("collapses spaces and foreign characters into one hyphen and trims the edges", () => {
        expect(profileIdFromName("  \u041c\u043e\u044f \u0440\u0430\u0431\u043e\u0442\u0430 / 2 ", [])).toBe("2"); // "Moya rabota"
        expect(profileIdFromName("a  b\tc", [])).toBe("a-b-c");
        expect(profileIdFromName("--x--", [])).toBe("x");
    });

    it("an empty remainder becomes `profile`", () => {
        expect(profileIdFromName("   ", [])).toBe("profile");
        expect(profileIdFromName("///", [])).toBe("profile");
    });

    it("a collision with a taken id gets the first free numeric suffix", () => {
        expect(profileIdFromName("a b", ["a-b"])).toBe("a-b-2");
        expect(profileIdFromName("a b", ["a-b", "a-b-2"])).toBe("a-b-3");
        expect(profileIdFromName("a b", ["a-b-2"])).toBe("a-b");
    });

    it("dots only become `profile`: `.` and `..` would point the directory at `profiles/` and `User/`", () => {
        expect(profileIdFromName(".", [])).toBe("profile");
        expect(profileIdFromName("..", [])).toBe("profile");
        expect(profileIdFromName(" .. ", [])).toBe("profile");
        expect(profileIdFromName("a/../..", [])).toBe("a-..-..");
    });

    it("a Windows device name (with an extension too) gets a `profile-` prefix; similar names stay as is", () => {
        expect(profileIdFromName("con", [])).toBe("profile-con");
        expect(profileIdFromName("NUL.txt", [])).toBe("profile-NUL.txt");
        expect(profileIdFromName("COM1", [])).toBe("profile-COM1");
        expect(profileIdFromName("lpt9", [])).toBe("profile-lpt9");
        expect(profileIdFromName("console", [])).toBe("console");
        expect(profileIdFromName("com0", [])).toBe("com0");
        expect(profileIdFromName("con", ["profile-con"])).toBe("profile-con-2");
    });

    it("`default` is taken by the Default profile paths, so it gets a suffix", () => {
        expect(profileIdFromName("default", [])).toBe("default-2");
        expect(profileIdFromName("default", ["default-2"])).toBe("default-3");
    });

    it("taken ids are compared case-insensitively (on macOS and Windows `Work` and `work` are one directory), the id keeps its case", () => {
        expect(profileIdFromName("work", ["Work"])).toBe("work-2");
        expect(profileIdFromName("Work", ["work", "WORK-2"])).toBe("Work-3");
        expect(profileIdFromName("DEFAULT", [])).toBe("DEFAULT-2");
    });

    it("a long name is cut to the directory name limit, without a trailing hyphen", () => {
        expect(profileIdFromName("x".repeat(300), [])).toBe("x".repeat(MAX_PROFILE_ID_LENGTH));
        expect(profileIdFromName(`${"x".repeat(MAX_PROFILE_ID_LENGTH - 1)} y`, [])).toBe(
            "x".repeat(MAX_PROFILE_ID_LENGTH - 1),
        );
    });
});

describe("isValidProfileId / PROFILE_ID_PATTERN", () => {
    it("the id is a directory name directly in profiles/: not `.`/`..`, not `default`, slug alphabet only", () => {
        expect(isValidProfileId("work.v2_x-1")).toBe(true);
        expect(isValidProfileId("...")).toBe(true);
        expect(isValidProfileId("Default")).toBe(true);
        expect(isValidProfileId(".")).toBe(false);
        expect(isValidProfileId("..")).toBe(false);
        expect(isValidProfileId("default")).toBe(false);
        expect(isValidProfileId("a/b")).toBe(false);
        expect(isValidProfileId("")).toBe(false);
        expect(PROFILE_ID_PATTERN.test("..")).toBe(false);
        expect(PROFILE_ID_PATTERN.test("..a")).toBe(true);
    });
});

describe("profileWorkspaceKey", () => {
    it("empty window has no key", () => {
        expect(profileWorkspaceKey({ id: null, folders: [] })).toBeUndefined();
    });

    it("a folder maps to its path; a workspace file takes priority over the folder", () => {
        const folder: IWorkspace = {
            id: "x",
            folders: [{ uri: Uri.file("/p/app"), name: "app", index: 0 }],
        };
        expect(profileWorkspaceKey(folder)).toBe(profileWorkspaceKeyOf("/p/app"));
        const fromFile: IWorkspace = { ...folder, configuration: Uri.file("/p/web.code-workspace") };
        expect(profileWorkspaceKey(fromFile)).toBe(profileWorkspaceKeyOf("/p/web.code-workspace"));
        expect(profileWorkspaceKey(fromFile)).not.toBe(profileWorkspaceKey(folder));
    });

    it("the string key is an absolute fsPath, the same for bootstrap and the window", () => {
        const key = profileWorkspaceKeyOf("/p/./app/../app");
        expect(key).toBe(Uri.file(path.resolve("/p/app")).fsPath);
        expect(profileWorkspaceKeyOf(key)).toBe(key);
    });
});

describe("resolveActiveProfile", () => {
    const defaultProfile = createDefaultProfile("/u/User");
    const work = toUserDataProfile("work", "work", "/u/User/profiles/work");

    function service(profiles: IUserDataProfile[], associations: Record<string, IUserDataProfile> = {}) {
        const svc: IUserDataProfilesService = {
            profilesHome: "/u/User/profiles",
            defaultProfile,
            profiles,
            onDidChangeProfiles: Event.None,
            createNamedProfile: vi.fn(async (name: string) =>
                toUserDataProfile(name, name, `/u/User/profiles/${name}`),
            ),
            updateProfile: vi.fn(),
            removeProfile: vi.fn(),
            setProfileForWorkspace: vi.fn(async () => undefined),
            // Contract: the key is a string; an empty window never reaches the registry.
            getProfileForWorkspace: (key: unknown) => {
                if (typeof key !== "string") throw new Error("binding key must be a string");
                return associations[key];
            },
        };
        return svc;
    }

    it("no flag and no binding gives Default", async () => {
        const svc = service([defaultProfile, work]);
        expect(await resolveActiveProfile(svc, { workspace: "/p/app" })).toBe(defaultProfile);
        expect(await resolveActiveProfile(svc, {})).toBe(defaultProfile);
        expect(svc.setProfileForWorkspace).not.toHaveBeenCalled();
    });

    it("the workspace binding beats Default", async () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(await resolveActiveProfile(svc, { workspace: "/p/app" })).toBe(work);
    });

    it("--profile finds by name, beats the binding and binds the workspace itself", async () => {
        const svc = service([defaultProfile, work], { "/p/app": defaultProfile });
        expect(await resolveActiveProfile(svc, { forceProfile: "work", workspace: "/p/app" })).toBe(work);
        expect(svc.setProfileForWorkspace).toHaveBeenCalledWith("/p/app", work);
        expect(svc.createNamedProfile).not.toHaveBeenCalled();
    });

    it("--profile Default is the named Default, and it also removes the binding", async () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(await resolveActiveProfile(svc, { forceProfile: "Default", workspace: "/p/app" })).toBe(defaultProfile);
        expect(svc.setProfileForWorkspace).toHaveBeenCalledWith("/p/app", defaultProfile);
    });

    it("--profile with an unknown name creates an empty profile; without a workspace it binds nothing", async () => {
        const svc = service([defaultProfile]);
        const created = await resolveActiveProfile(svc, { forceProfile: " new " });
        expect(created.name).toBe("new");
        expect(svc.createNamedProfile).toHaveBeenCalledWith("new");
        expect(svc.setProfileForWorkspace).not.toHaveBeenCalled();
    });

    it("an empty --profile is the same as no flag", async () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(await resolveActiveProfile(svc, { forceProfile: "  ", workspace: "/p/app" })).toBe(work);
        expect(svc.createNamedProfile).not.toHaveBeenCalled();
    });

    it("profileForWorkspace: a binding gives its profile, no binding or an empty window gives Default", () => {
        const svc = service([defaultProfile, work], { "/p/app": work });
        expect(profileForWorkspace(svc, "/p/app")).toBe(work);
        expect(profileForWorkspace(svc, "/p/other")).toBe(defaultProfile);
        expect(profileForWorkspace(svc, undefined)).toBe(defaultProfile);
    });
});

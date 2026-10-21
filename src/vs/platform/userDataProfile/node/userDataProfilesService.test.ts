import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../TestUtils/TempWorkspace.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { StateFileStore } from "../../state/node/stateService.ts";
import {
    DEFAULT_PROFILE_ID,
    type DidChangeProfilesEvent,
    PROFILE_ASSOCIATIONS_STATE,
    type StoredUserDataProfile,
    USER_DATA_PROFILES_STATE,
} from "../common/userDataProfile.ts";

import { UserDataProfilesService } from "./userDataProfilesService.ts";

function fakeLogger(): ILogger {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

describe("UserDataProfilesService", () => {
    let ws: ITempWorkspace;
    let userDir: string;
    let profilesHome: string;
    let state: StateFileStore;
    let logger: ILogger;
    let events: DidChangeProfilesEvent[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-profiles-" });
        userDir = path.join(ws.dir, "User");
        profilesHome = path.join(userDir, "profiles");
        state = new StateFileStore(path.join(userDir, "globalStorage", "storage.json"), { writeDebounceMs: 5 });
        logger = fakeLogger();
        events = [];
    });

    afterEach(() => {
        state.dispose();
        ws.dispose();
    });

    function service(): UserDataProfilesService {
        const svc = new UserDataProfilesService({ profilesHome, defaultProfileHome: userDir, state, logger });
        svc.onDidChangeProfiles((e) => events.push(e));
        return svc;
    }

    it("with no entries there is one Default with files directly in User/", () => {
        const svc = service();
        expect(svc.profiles.map((p) => p.name)).toEqual(["Default"]);
        expect(svc.defaultProfile.isDefault).toBe(true);
        expect(svc.defaultProfile.settingsResource).toBe(path.join(userDir, "settings.json"));
        expect(svc.profilesHome).toBe(profilesHome);
        expect(svc.defaultProfile.extensionsResource).toBe(path.join(userDir, "extensions.json"));
    });

    it("Default's extensions come from the given path (the extensions directory), in the profile list too", () => {
        const extensionsResource = path.join(ws.dir, "extensions", "extensions.json");
        const svc = new UserDataProfilesService({
            profilesHome,
            defaultProfileHome: userDir,
            defaultProfileExtensionsResource: extensionsResource,
            state,
        });
        expect(svc.defaultProfile.extensionsResource).toBe(extensionsResource);
        expect(svc.defaultProfile.settingsResource).toBe(path.join(userDir, "settings.json"));
        expect(svc.profiles[0]?.extensionsResource).toBe(extensionsResource);
    });

    describe("createNamedProfile", () => {
        it("creates the directory, writes an entry with location relative to profilesHome and fires an event", async () => {
            const svc = service();
            const work = await svc.createNamedProfile(" Work ");
            expect(work).toMatchObject({ id: "Work", name: "Work", isDefault: false });
            expect(work.location).toBe(path.join(profilesHome, "Work"));
            expect(fs.statSync(work.location).isDirectory()).toBe(true);
            // A new profile has no extensions; the empty set is written explicitly.
            expect(work.extensionsResource).toBe(path.join(profilesHome, "Work", "extensions.json"));
            expect(fs.readFileSync(work.extensionsResource, "utf8")).toBe("[]");
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([{ name: "Work", location: "Work" }]);
            expect(svc.profiles.map((p) => p.id)).toEqual([DEFAULT_PROFILE_ID, "Work"]);
            expect(events).toEqual([{ added: [work], removed: [], updated: [], all: svc.profiles }]);
        });

        it("a name with spaces: slug for the directory, name as is; a slug collision gets a suffix", async () => {
            const svc = service();
            const a = await svc.createNamedProfile("my work");
            const b = await svc.createNamedProfile("my-work");
            expect(a.id).toBe("my-work");
            expect(b.id).toBe("my-work-2");
            expect(b.name).toBe("my-work");
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default", "my work", "my-work"]);
        });

        it("rejects: empty name, taken name (including Default)", async () => {
            const svc = service();
            await svc.createNamedProfile("work");
            await expect(svc.createNamedProfile("  ")).rejects.toThrow(/mandatory/);
            await expect(svc.createNamedProfile("work")).rejects.toThrow(/already exists/);
            await expect(svc.createNamedProfile("Default")).rejects.toThrow(/already exists/);
            expect(svc.profiles).toHaveLength(2);
        });

        it("with a workspace, binds it right away", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work", "/p/app");
            expect(svc.getProfileForWorkspace("/p/app")).toEqual(work);
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({ workspaces: { "/p/app": "work" } });
        });

        it("the registry survives a restart: a new service over the same store sees the profile", async () => {
            await service().createNamedProfile("work");
            const reopened = new UserDataProfilesService({ profilesHome, defaultProfileHome: userDir, state });
            expect(reopened.profiles.map((p) => p.name)).toEqual(["Default", "work"]);
            expect(reopened.profiles[1]?.settingsResource).toBe(path.join(profilesHome, "work", "settings.json"));
        });
    });

    describe("updateProfile", () => {
        it("renames without touching the id and directory", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            const renamed = await svc.updateProfile(work, { name: "Work 2" });
            expect(renamed).toMatchObject({ id: "work", name: "Work 2", location: work.location });
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([{ name: "Work 2", location: "work" }]);
            expect(events.at(-1)).toEqual({ added: [], removed: [], updated: [renamed], all: svc.profiles });
            expect((await svc.updateProfile(renamed, {})).name).toBe("Work 2");
        });

        it("renaming to the same name is not a collision; siblings do not change", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await svc.createNamedProfile("home");
            await expect(svc.updateProfile(work, { name: "work" })).resolves.toMatchObject({ name: "work" });
            await svc.updateProfile(work, { name: "Work" });
            expect(svc.profiles.map((p) => [p.id, p.name])).toEqual([
                [DEFAULT_PROFILE_ID, "Default"],
                ["work", "Work"],
                ["home", "home"],
            ]);
        });

        it("rejects: Default, unknown profile, taken or empty name", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await svc.createNamedProfile("home");
            await expect(svc.updateProfile(svc.defaultProfile, { name: "x" })).rejects.toThrow(/default/);
            await expect(svc.updateProfile({ ...work, id: "ghost" }, { name: "x" })).rejects.toThrow(/does not exist/);
            await expect(svc.updateProfile(work, { name: "home" })).rejects.toThrow(/already exists/);
            await expect(svc.updateProfile(work, { name: " " })).rejects.toThrow(/mandatory/);
            // Its own name isn't a collision.
            expect((await svc.updateProfile(work, { name: "work" })).name).toBe("work");
        });
    });

    describe("removeProfile", () => {
        it("removes the entry, its bindings and its directory; other bindings stay intact", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work", "/p/app");
            const home = await svc.createNamedProfile("home", "/p/other");
            fs.writeFileSync(path.join(work.location, "settings.json"), "{}");
            await svc.removeProfile(work);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default", "home"]);
            expect(fs.existsSync(work.location)).toBe(false);
            expect(svc.getProfileForWorkspace("/p/app")).toBeUndefined();
            expect(svc.getProfileForWorkspace("/p/other")).toEqual(home);
            expect(events.at(-1)).toEqual({ added: [], removed: [work], updated: [], all: svc.profiles });
        });

        it("once the last profile is removed, the registry and binding keys leave the file", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work", "/p/app");
            await svc.removeProfile(work);
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([]);
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({});
            state.flushSync();
            expect(JSON.parse(fs.readFileSync(path.join(userDir, "globalStorage", "storage.json"), "utf-8"))).toEqual(
                {},
            );
        });

        it("a directory already deleted by hand: removal succeeds without logging an error", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            fs.rmSync(work.location, { recursive: true });
            await svc.removeProfile(work);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default"]);
            expect(logger.error).not.toHaveBeenCalled();
        });

        it("rejects: Default and unknown profile", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await expect(svc.removeProfile(svc.defaultProfile)).rejects.toThrow(/default/);
            await expect(svc.removeProfile({ ...work, id: "ghost" })).rejects.toThrow(/does not exist/);
        });

        it("the name `..` does not move the directory out of profiles/, and removal leaves User/ alone", async () => {
            const svc = service();
            fs.mkdirSync(userDir, { recursive: true });
            fs.writeFileSync(path.join(userDir, "settings.json"), "{}");
            const dots = await svc.createNamedProfile("..");
            expect(dots.location).toBe(path.join(profilesHome, "profile"));
            await svc.removeProfile(dots);
            expect(fs.existsSync(path.join(userDir, "settings.json"))).toBe(true);
        });

        it("a directory outside profiles/ (a hand-written absolute location): the entry is removed, the directory stays", async () => {
            const abs = path.join(ws.dir, "elsewhere", "old");
            fs.mkdirSync(abs, { recursive: true });
            state.store(USER_DATA_PROFILES_STATE, [{ name: "old", location: abs }]);
            const svc = service();
            const [, old] = svc.profiles;
            await svc.removeProfile(old);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default"]);
            expect(fs.existsSync(abs)).toBe(true);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(abs));
        });

        it("the directory fails to delete: the error is logged, the profile is removed anyway", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            const rm = vi.spyOn(fs.promises, "rm").mockRejectedValueOnce(new Error("EBUSY"));
            await svc.removeProfile(work);
            rm.mockRestore();
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to delete"), expect.anything());
            expect(svc.profiles).toHaveLength(1);
        });
    });

    describe("setProfileForWorkspace / getProfileForWorkspace", () => {
        it("writes path to id; reassigning overwrites; Default removes the entry", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            const home = await svc.createNamedProfile("home");
            await svc.setProfileForWorkspace("/p/app", work);
            await svc.setProfileForWorkspace("/p/web.code-workspace", home);
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({
                workspaces: { "/p/app": "work", "/p/web.code-workspace": "home" },
            });
            await svc.setProfileForWorkspace("/p/app", home);
            expect(svc.getProfileForWorkspace("/p/app")).toEqual(home);
            await svc.setProfileForWorkspace("/p/app", svc.defaultProfile);
            expect(svc.getProfileForWorkspace("/p/app")).toBeUndefined();
            expect(state.get(PROFILE_ASSOCIATIONS_STATE)).toEqual({ workspaces: { "/p/web.code-workspace": "home" } });
        });

        it("an unknown profile is rejected; a binding to a missing id reads as absent", async () => {
            const svc = service();
            const work = await svc.createNamedProfile("work");
            await expect(svc.setProfileForWorkspace("/p/app", { ...work, id: "ghost" })).rejects.toThrow(
                /does not exist/,
            );
            state.store(PROFILE_ASSOCIATIONS_STATE, { workspaces: { "/p/app": "ghost" } });
            expect(svc.getProfileForWorkspace("/p/app")).toBeUndefined();
        });
    });

    describe("registry loading", () => {
        it("broken entries are skipped with a warn, an absolute location is taken as is", () => {
            const abs = path.join(ws.dir, "elsewhere", "old");
            const stored: unknown[] = [
                { name: "work", location: "work" },
                { name: "", location: "x" },
                { name: "nolocation", location: "" },
                null,
                undefined,
                { name: ["work"], location: "arr" },
                { name: "arr", location: ["arr"] },
                { name: "old", location: abs },
                { name: "up", location: ".." },
                { name: "escape", location: "../x" },
                { name: "here", location: "." },
                { name: "default", location: "default" },
            ];
            state.store(USER_DATA_PROFILES_STATE, stored as StoredUserDataProfile[]);
            const svc = service();
            expect(svc.profiles.map((p) => [p.id, p.name, p.location])).toEqual([
                [DEFAULT_PROFILE_ID, "Default", userDir],
                ["work", "work", path.join(profilesHome, "work")],
                ["old", "old", abs],
            ]);
            expect(logger.warn).toHaveBeenCalledTimes(10);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("invalid location"), {
                name: "up",
                location: "..",
            });
        });
    });

    describe("migrateProfileDirectories", () => {
        it("registers directories without an entry under the directory name, leaves known ones alone", async () => {
            const svc = service();
            await svc.createNamedProfile("known");
            fs.mkdirSync(path.join(profilesHome, "legacy"), { recursive: true });
            fs.mkdirSync(path.join(profilesHome, "other"), { recursive: true });
            fs.writeFileSync(path.join(profilesHome, "a-file"), "");
            const added = svc.migrateProfileDirectories();
            expect(added.map((p) => p.name)).toEqual(["legacy", "other"]);
            expect(svc.profiles.map((p) => p.name)).toEqual(["Default", "known", "legacy", "other"]);
            expect(state.get(USER_DATA_PROFILES_STATE)).toEqual([
                { name: "known", location: "known" },
                { name: "legacy", location: "legacy" },
                { name: "other", location: "other" },
            ]);
            expect(events.at(-1)).toEqual({ added, removed: [], updated: [], all: svc.profiles });
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("2"), { profiles: ["legacy", "other"] });
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.info).toHaveBeenCalledTimes(1);
        });

        it("no profilesHome: empty without errors; a directory with an invalid name is skipped with a warn", () => {
            const svc = service();
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.error).not.toHaveBeenCalled();
            fs.mkdirSync(path.join(profilesHome, "bad name"), { recursive: true });
            fs.mkdirSync(path.join(profilesHome, "default"), { recursive: true });
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("bad name"));
            expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("default"));
        });

        it("a directory whose name is taken by a profile with another directory gets a distinct name", async () => {
            const svc = service();
            // Profile `work` is renamed to `Work` and lives in `work/`; directory
            // `Work/` was created by hand, and the names must not clash.
            const work = await svc.createNamedProfile("work");
            await svc.updateProfile(work, { name: "Work" });
            fs.mkdirSync(path.join(profilesHome, "Work"), { recursive: true });
            const added = svc.migrateProfileDirectories();
            expect(added.map((p) => [p.id, p.name])).toEqual([["Work", "Work (Work)"]]);
        });

        it("readdir failing with something other than ENOENT logs an error and returns empty", () => {
            const svc = service();
            fs.mkdirSync(userDir, { recursive: true });
            fs.writeFileSync(profilesHome, "not a dir");
            expect(svc.migrateProfileDirectories()).toEqual([]);
            expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to scan"), expect.anything());
        });
    });
});

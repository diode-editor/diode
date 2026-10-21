import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeWorkspaceId } from "./workspaceId.ts";

describe("computeWorkspaceId", () => {
    // The format is a layout already on users' disks: changing the formula means migrating directories.
    it("returns sha256 hex of the absolute folder path, as vscode does", () => {
        const expected = crypto.createHash("sha256").update("/projects/app").digest("hex");
        expect(computeWorkspaceId("/projects/app")).toBe(expected);
        expect(computeWorkspaceId("/projects/app")).toMatch(/^[0-9a-f]{64}$/);
    });

    // The same folder named differently must yield ONE project:
    // otherwise `diode .` and `diode /abs/path` would open different session stores.
    it("normalizes the path before hashing", () => {
        const canonical = computeWorkspaceId("/projects/app");
        expect(computeWorkspaceId("/projects/app/")).toBe(canonical);
        expect(computeWorkspaceId("/projects/./app")).toBe(canonical);
        expect(computeWorkspaceId("/projects/sub/../app")).toBe(canonical);
    });

    it("different folders get different ids", () => {
        expect(computeWorkspaceId("/projects/a")).not.toBe(computeWorkspaceId("/projects/b"));
    });

    it("a relative path resolves against cwd", () => {
        expect(computeWorkspaceId("sub/dir")).toBe(computeWorkspaceId(`${process.cwd()}/sub/dir`));
    });
});

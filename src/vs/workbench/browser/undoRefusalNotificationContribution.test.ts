import { describe, expect, it } from "vitest";

import { UndoRedoService } from "../../platform/undoRedo/common/undoRedoService.ts";
import { NotificationService } from "../services/notification/browser/notificationService.ts";

import { UndoRefusalNotificationContribution } from "./undoRefusalNotificationContribution.ts";

describe("UndoRefusalNotificationContribution", () => {
    it("a refused undo of a multi-document step becomes a warning", async () => {
        const undoRedo = new UndoRedoService();
        const notifications = new NotificationService();
        const contribution = new UndoRefusalNotificationContribution(undoRedo, notifications);

        const step = { label: "Move to a new file", resources: [], undo: () => {}, redo: () => {} };
        undoRedo.pushWorkspaceElement(step, [
            { context: "a", label: "a.ts", owner: true },
            { context: "b", label: "b.ts", owner: true },
        ]);
        undoRedo.pushElement({ label: "Typing", resources: [], undo: () => {}, redo: () => {} }, "b");
        expect(await undoRedo.undo("a")).toBe(false);

        const shown = notifications.passive();
        expect(shown).toHaveLength(1);
        expect(shown[0].severity).toBe("warn");
        expect(shown[0].message).toBe(
            "Could not undo 'Move to a new file' across all files because changes were made to b.ts",
        );
        expect(shown[0].items).toEqual([]);
        expect(shown[0].modal).toBe(false);

        contribution.dispose();
        await undoRedo.undo("a");
        expect(notifications.passive()).toHaveLength(1);
    });
});

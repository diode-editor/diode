import { describe, expect, it } from "vitest";

import { makeTask, TASK_FOLDER } from "../../../../../TestUtils/taskFixtures.ts";

import { getMapKey } from "./tasks.ts";

// Ключ «та же задача» (`getMapKey` эталона): по нему ищутся бегущая копия и терминал.

const ext = { type: "npm", extensionId: "pub.ext", source: "npm" };

describe("getMapKey", () => {
    it("задача tasks.json — папка и id", () => {
        expect(getMapKey(makeTask({ label: "a" }))).toBe(`${TASK_FOLDER.uri.toString()}|$core.a`);
    });

    it("задача провайдера: область, папка (если есть) и id", () => {
        const inFolder = makeTask({ label: "a", extension: ext });
        expect(getMapKey(inFolder)).toBe(`folder|${TASK_FOLDER.uri.toString()}|${inFolder._id}`);
        const noFolder = makeTask({ label: "a", extension: ext, folder: null });
        expect(getMapKey(noFolder)).toBe(`workspace|${noFolder._id}`);
    });
});

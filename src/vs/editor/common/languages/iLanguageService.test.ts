import { describe, expect, it } from "vitest";

import { NULL_LANGUAGE_SERVICE } from "./iLanguageService.ts";

describe("NULL_LANGUAGE_SERVICE", () => {
    it("knows no languages, swallows feature requests, the subscription disposes", () => {
        const heard: string[] = [];
        const subscription = NULL_LANGUAGE_SERVICE.onDidRequestLanguageFeatures((id) => heard.push(id));

        NULL_LANGUAGE_SERVICE.requestLanguageFeatures("typescript");

        expect(heard).toEqual([]);
        expect(NULL_LANGUAGE_SERVICE.getLanguageIdForResource("/a.ts")).toBeUndefined();
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });
});

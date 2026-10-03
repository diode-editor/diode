import { describe, expect, it } from "vitest";

import { NULL_LANGUAGE_SERVICE } from "./iLanguageService.ts";

describe("NULL_LANGUAGE_SERVICE", () => {
    it("языков не знает, запросы фич глотает, подписка снимается", () => {
        const heard: string[] = [];
        const subscription = NULL_LANGUAGE_SERVICE.onDidRequestLanguageFeatures((id) => heard.push(id));

        NULL_LANGUAGE_SERVICE.requestLanguageFeatures("typescript");

        expect(heard).toEqual([]);
        expect(NULL_LANGUAGE_SERVICE.getLanguageIdForResource("/a.ts")).toBeUndefined();
        // Подписка — настоящий IDisposable: потребитель зовёт dispose() без проверок.
        expect(() => {
            subscription.dispose();
        }).not.toThrow();
    });
});

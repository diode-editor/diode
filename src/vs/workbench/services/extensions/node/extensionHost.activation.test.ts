import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";

/** A harness with `activateEvents: []` fires nothing automatically; the test drives the events itself. */
describe("ExtensionHost — lazy activation (activationEvents)", () => {
    it("onLanguage: неактивно до совпадающего события, затем активируется идемпотентно", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                { ...extensionFixture("test.lazy", "noopExtension.cjs"), activationEvents: ["onLanguage:json"] },
            ],
        });
        try {
            expect(harness.host.hasExtension("test.lazy")).toBe(false);
            expect(harness.host.extensionCount).toBe(0);

            await harness.host.activateByEvent("onLanguage:txt");
            expect(harness.host.hasExtension("test.lazy")).toBe(false);

            await harness.host.activateByEvent("onLanguage:json");
            await settle();
            expect(harness.host.hasExtension("test.lazy")).toBe(true);
            expect(harness.host.extensionCount).toBe(1);

            await harness.host.activateByEvent("onLanguage:json");
            expect(harness.host.extensionCount).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("* активирует расширения без явных activationEvents (дефолт eager)", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            // No activationEvents → normalized to ["*"].
            extensions: [extensionFixture("test.eager", "noopExtension.cjs")],
        });
        try {
            expect(harness.host.hasExtension("test.eager")).toBe(false);
            await harness.host.activateByEvent("*");
            await settle();
            expect(harness.host.hasExtension("test.eager")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("хост дефолта не додумывает: регистрация с пустым набором событий не поднимается даже на *", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [{ ...extensionFixture("test.empty", "noopExtension.cjs"), activationEvents: [] }],
        });
        try {
            await harness.host.activateByEvent("*");
            await settle();
            expect(harness.host.hasExtension("test.empty")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("dispose до активации убирает расширение из pending", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [] });
        try {
            const disposable = harness.host.registerExtension(extensionFixture("test.disposed", "noopExtension.cjs"));
            disposable.dispose();
            await harness.host.activateByEvent("*");
            await settle();
            expect(harness.host.hasExtension("test.disposed")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("параллельные activateByEvent активируют расширение ровно один раз", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [extensionFixture("test.race", "noopExtension.cjs")],
        });
        try {
            await Promise.all([harness.host.activateByEvent("*"), harness.host.activateByEvent("*")]);
            await settle();
            expect(harness.host.extensionCount).toBe(1);
        } finally {
            await harness.dispose();
        }
    });

    it("сбой activate() одного расширения не роняет host и не блокирует остальных", async () => {
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            extensions: [
                { ...extensionFixture("test.broken", "noopExtension.cjs"), mainPath: "/no/such/module.cjs" },
                extensionFixture("test.ok", "noopExtension.cjs"),
            ],
        });
        try {
            await harness.host.activateByEvent("*");
            await settle();
            expect(harness.host.hasExtension("test.broken")).toBe(false);
            expect(harness.host.hasExtension("test.ok")).toBe(true);
        } finally {
            await harness.dispose();
        }
    });
});

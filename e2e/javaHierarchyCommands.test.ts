import { describe, it } from "vitest";

import { JDK_MISSING, POM_XML, SHAPES_JAVA } from "../src/TestUtils/javaFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";

import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * The commands redhat.java contributes itself: `Java: Show Type Hierarchy` is in its palette and editor context menu,
 * next to the core `Show Type Hierarchy`. Bound to keys, so the test presses what a user reaches through a menu.
 */

const SOURCES = "src/main/java/demo";
const files = {
    "pom.xml": POM_XML,
    ...Object.fromEntries(Object.entries(SHAPES_JAVA).map(([name, text]) => [`${SOURCES}/${name}`, text])),
};

async function openWhenReady(open: string) {
    const { session } = await useHeadlessApp({
        files,
        installVsix: ["redhat.java"],
        open: [".", open],
        settings: { "redhat.telemetry.enabled": false },
        keybindings: [
            { key: "alt+k", command: "java.action.showTypeHierarchy" },
            { key: "alt+u", command: "java.action.navigateToSuperImplementation" },
        ],
    });
    await session.waitForText((text) => text.includes("Java: Ready"), { timeoutMs: 240_000, intervalMs: 500 });
    return session;
}

describe.skipIf(process.platform !== "linux" || MARKETPLACE_OFFLINE || JDK_MISSING)(
    "SEA binary — commands of the stock redhat.java",
    () => {
        it("Java: Show Type Hierarchy shows the implementations of an interface", { timeout: 420_000 }, async () => {
            const session = await openWhenReady(`${SOURCES}/Shape.java`);
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < "public interface ".length; i++) await session.key("ArrowRight");

            await session.key("Alt+k");

            await session.waitForText((text) => text.includes("Circle demo") && text.includes("Square demo"), {
                timeoutMs: 30_000,
                intervalMs: 500,
            });
        });

        it("Java: Go to Super Implementation opens the interface from an override", { timeout: 420_000 }, async () => {
            const session = await openWhenReady(`${SOURCES}/Circle.java`);
            for (let i = 0; i < 4; i++) await session.key("ArrowDown");
            for (let i = 0; i < "    public double ".length; i++) await session.key("ArrowRight");

            await session.key("Alt+u");

            await session.waitForText((text) => text.includes("public interface Shape"), {
                timeoutMs: 30_000,
                intervalMs: 500,
            });
        });
    },
);

// Upstream's `ConfigurationResolverExpression` suite (configurationResolverService.test.ts).

import { describe, expect, it } from "vitest";

import { ConfigurationResolverExpression, type IReplacement } from "./configurationResolverExpression.ts";

const env = (arg: string): IReplacement => ({ id: `\${env:${arg}}`, inner: `env:${arg}`, name: "env", arg });

describe("ConfigurationResolverExpression", () => {
    it("parse empty object", () => {
        const expression = ConfigurationResolverExpression.parse({});
        expect([...expression.unresolved()]).toStrictEqual([]);
        expect(expression.toObject()).toStrictEqual({});
    });

    it("parse: name and argument; the argument keeps its colons; no argument — no `arg`", () => {
        expect([
            ...ConfigurationResolverExpression.parse({ value: "${config:path:to:value}" }).unresolved(),
        ]).toStrictEqual([
            { id: "${config:path:to:value}", inner: "config:path:to:value", name: "config", arg: "path:to:value" },
        ]);
        expect([...ConfigurationResolverExpression.parse("${file}").unresolved()]).toStrictEqual([
            { id: "${file}", inner: "file", name: "file" },
        ]);
    });

    it("parse object with nested variables", () => {
        const expression = ConfigurationResolverExpression.parse({
            name: "${env:USERNAME}",
            path: "${env:HOME}/folder",
            settings: { value: "${config:path}" },
            array: ["${env:TERM}", { key: "${env:KEY}" }],
        });
        expect([...expression.unresolved()].map((r) => r.inner)).toStrictEqual([
            "env:USERNAME",
            "env:HOME",
            "config:path",
            "env:TERM",
            "env:KEY",
        ]);
    });

    it("resolve and get result; unresolved ones are kept; the source is not changed", () => {
        const source = { name: "${env:USERNAME}", path: "${env:HOME}/folder", other: "${env:OTHER}" };
        const expression = ConfigurationResolverExpression.parse(source);
        expression.resolve(env("USERNAME"), "testuser");
        expression.resolve(env("HOME"), "/home/testuser");
        expect(expression.toObject()).toStrictEqual({
            name: "testuser",
            path: "/home/testuser/folder",
            other: "${env:OTHER}",
        });
        expect(expression.resolvedValues()).toStrictEqual(
            new Map([
                ["env:USERNAME", "testuser"],
                ["env:HOME", "/home/testuser"],
            ]),
        );
        expect(source.name).toBe("${env:USERNAME}");
    });

    it("resolving a variable that does not occur changes nothing", () => {
        const expression = ConfigurationResolverExpression.parse({ name: "${env:A}" });
        expression.resolve(env("B"), "b");
        expect(expression.toObject()).toStrictEqual({ name: "${env:A}" });
        expect(expression.resolvedValues()).toStrictEqual(new Map());
    });

    it("deduplicates identical variables", () => {
        const expression = ConfigurationResolverExpression.parse({ first: "${env:HOME}", second: "${env:HOME}" });
        const unresolved = [...expression.unresolved()];
        expect(unresolved).toStrictEqual([env("HOME")]);
        expression.resolve(unresolved[0], "/home/user");
        expect(expression.toObject()).toStrictEqual({ first: "/home/user", second: "/home/user" });
    });

    it("handles root string value with multiple variables", () => {
        const expression = ConfigurationResolverExpression.parse("${env:HOME}/folder${env:SHELL} ${env:HOME}");
        expect([...expression.unresolved()]).toHaveLength(2);
        expression.resolve(env("HOME"), "/home/user");
        expression.resolve(env("SHELL"), "/bin/bash");
        expect(expression.toObject()).toBe("/home/user/folder/bin/bash /home/user");
    });

    it("handles root string with nested braces; an unclosed `${` is text", () => {
        expect([...ConfigurationResolverExpression.parse("abc ${env:HOME${env:USER}} xyz").unresolved()]).toStrictEqual(
            [env("HOME${env:USER}")],
        );
        const unclosed = ConfigurationResolverExpression.parse("${ ${env:A} ${env:B");
        expect([...unclosed.unresolved()]).toStrictEqual([env("A")]);
    });

    it("resolves nested values, in keys too", () => {
        const expression = ConfigurationResolverExpression.parse({
            name: "${env:REDIRECTED}",
            "key that is ${env:REDIRECTED}": "cool!",
        });
        const seen: string[] = [];
        for (const r of expression.unresolved()) {
            seen.push(r.inner);
            if (r.arg === "REDIRECTED") expression.resolve(r, "username: ${env:USERNAME}");
            else expression.resolve(r, "testuser");
        }
        expect(seen).toStrictEqual(["env:REDIRECTED", "env:USERNAME"]);
        expect(expression.toObject()).toStrictEqual({
            name: "username: testuser",
            "key that is username: testuser": "cool!",
        });
    });

    it("resolves nested values 2 (#245798): a value refers to already resolved ones", () => {
        const expression = ConfigurationResolverExpression.parse({
            env: { SITE: "${input:site}", TLD: "${input:tld}", HOST: "${input:host}" },
        });
        const values: Record<string, string> = {
            site: "example",
            tld: "com",
            host: "local.${input:site}.${input:tld}",
        };
        for (const r of expression.unresolved()) expression.resolve(r, values[r.arg ?? ""]);
        expect(expression.toObject()).toStrictEqual({
            env: { SITE: "example", TLD: "com", HOST: "local.example.com" },
        });
    });

    it("out-of-order key resolution (#248550)", () => {
        const expression = ConfigurationResolverExpression.parse({ "${input:key}": "${input:value}", keep: 1 });
        for (const r of expression.unresolved()) if (r.arg === "key") expression.resolve(r, "the-key");
        for (const r of expression.unresolved()) if (r.arg === "value") expression.resolve(r, "the-value");
        expect(expression.toObject()).toStrictEqual({ "the-key": "the-value", keep: 1 });
    });

    it("resolved variables are not listed again; skipped ones are listed by the next pass", () => {
        const expression = ConfigurationResolverExpression.parse(["${env:A}", "${env:B}"]);
        for (const r of expression.unresolved()) if (r.arg === "A") expression.resolve(r, "a");
        expect([...expression.unresolved()]).toStrictEqual([env("B")]);
        expression.resolve(env("B"), "b");
        expect([...expression.unresolved()]).toStrictEqual([]);
        expect(expression.toObject()).toStrictEqual(["a", "b"]);
    });

    it("renaming a key moves only the locations in that key of that object", () => {
        const expression = ConfigurationResolverExpression.parse({ "${env:A}": "x", other: "${env:B}" });
        expression.resolve(env("A"), "renamed");
        expression.resolve(env("B"), "b");
        expect(expression.toObject()).toStrictEqual({ renamed: "x", other: "b" });
        const nested = ConfigurationResolverExpression.parse({ a: { "${env:A}": 1 }, b: { "${env:A}": "${env:B}" } });
        nested.resolve(env("A"), "k");
        nested.resolve(env("B"), "v");
        expect(nested.toObject()).toStrictEqual({ a: { k: 1 }, b: { k: "v" } });
    });

    it("a value naming its own variable is not expanded again", () => {
        const expression = ConfigurationResolverExpression.parse({ a: "${env:A}", b: ["${env:A}"] });
        for (const r of expression.unresolved()) expression.resolve(r, "<${env:A}>");
        expect(expression.toObject()).toStrictEqual({ a: "<${env:A}>", b: ["<${env:A}>"] });
    });
});

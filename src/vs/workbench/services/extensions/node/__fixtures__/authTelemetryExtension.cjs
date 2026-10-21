"use strict";

/**
 * Fixture for extensionHost.authTelemetry.test.ts: the activation shape of
 * `hashicorp.terraform` before the language server starts.
 *
 * First comes the telemetry reporter (`@vscode/extension-telemetry` builds a
 * logger via `env.createTelemetryLogger` in its constructor), then its own
 * sign-in provider and a "signed in?" check via a silent `getSession`. Without any of
 * these members `activate()` failed entirely. Only after them is the command
 * `test.authTelemetry` registered: running it is the observable "extension is alive".
 */
const vscode = require("vscode");

exports.activate = async function activate(context) {
    const sent = [];
    const logger = vscode.env.createTelemetryLogger({
        sendEventData: function (name) {
            sent.push(name);
        },
        sendErrorData: function (error) {
            sent.push(error.message);
        },
    });
    context.subscriptions.push(logger);
    logger.logUsage("activate", { trusted: new vscode.TelemetryTrustedValue("x") });

    context.subscriptions.push(
        vscode.authentication.registerAuthenticationProvider("test.cloud", "Test Cloud", {
            onDidChangeSessions: new vscode.EventEmitter().event,
            getSessions: function () {
                return Promise.resolve([]);
            },
            createSession: function () {
                return Promise.reject(new Error("createSession must not be called"));
            },
            removeSession: function () {
                return Promise.resolve();
            },
        }),
        vscode.authentication.onDidChangeSessions(function () {}),
    );
    const session = await vscode.authentication.getSession("test.cloud", [], { createIfNone: false });

    context.subscriptions.push(
        vscode.commands.registerCommand("test.authTelemetry", async function () {
            let login;
            try {
                await vscode.authentication.getSession("test.cloud", [], { createIfNone: true });
                login = "signed in";
            } catch (error) {
                login = error.message;
            }
            return {
                session: session === undefined ? "none" : "some",
                usageEnabled: logger.isUsageEnabled,
                sent: sent,
                login: login,
            };
        }),
    );
};

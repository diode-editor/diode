"use strict";

/**
 * Фикстура для extensionHost.authTelemetry.test.ts — форма активации
 * `hashicorp.terraform` до старта языкового сервера.
 *
 * Первым идёт репортер телеметрии (`@vscode/extension-telemetry` строит
 * логгер через `env.createTelemetryLogger` в конструкторе), затем — свой
 * провайдер входа и проверка «вошёл ли» тихим `getSession`. Без любого из этих
 * членов `activate()` падал целиком. Только после них регистрируется команда
 * `test.authTelemetry`: её исполнение и есть наблюдаемое «расширение живо».
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
                return Promise.reject(new Error("createSession не должен вызываться"));
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

"use strict";

/**
 * Зависимость для демо extensionDependencies: отдаёт API (`exports`) так же,
 * как `redhat.java` отдаёт `status` своим соседям.
 */
exports.activate = function activate() {
    return { status: "Started" };
};
exports.deactivate = function deactivate() {};

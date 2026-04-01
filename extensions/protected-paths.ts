// @ts-nocheck
/**
 * Protected Paths Extension
 *
 * Blocks write and edit operations to protected paths.
 * Useful for preventing accidental modifications to sensitive files.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const protectedPaths = [".env", ".git/", "node_modules/"];

	pi.on("tool_call", async (event, ctx) => {
		const path = event.input.path as string | undefined;
		if (!path) return undefined;
		const isEnv = path.includes(".env");

		// Block all operations on .env
		if (isEnv) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked access to protected path: ${path}`, "warning");
			}
			return { block: true, reason: `Path "${path}" is fully protected` };
		}

		// For other protected paths, only block write/edit operations
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const isProtected = protectedPaths.some((p) => path.includes(p) && p !== ".env");

		if (isProtected) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
			}
			return { block: true, reason: `Path "${path}" is protected` };
		}

		return undefined;
	});
}

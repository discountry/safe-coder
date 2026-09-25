// @ts-nocheck
/**
 * Protected Paths Extension
 *
 * Blocks write and edit operations to protected paths.
 * Useful for preventing accidental modifications to sensitive files.
 *
 * Configuration is read from ~/.pi/agent/safe-coder.json at startup.
 * See README.md for details.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig, type SafeCoderConfig } from "../lib/config-loader.ts";

// ── Resolved paths ──────────────────────────────────────────────────────────

const config = loadConfig();

const DEFAULT_PROTECTED_PATHS = [".env", ".git/", "node_modules/"];
const PROTECTED_PATHS = DEFAULT_PROTECTED_PATHS; // Core protections are always enforced

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const targetPath = event.input.path as string | undefined;
		if (!targetPath) return undefined;

		// Block all operations on .env (always protected)
		if (targetPath.includes(".env")) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked access to protected path: ${targetPath}`, "warning");
			}
			return { block: true, reason: `Path "${targetPath}" is fully protected` };
		}

		// For other protected paths, only block write/edit operations
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const isProtected = PROTECTED_PATHS.some((p) => targetPath.includes(p));

		if (isProtected) {
			if (ctx.hasUI) {
				ctx.ui.notify(`Blocked write to protected path: ${targetPath}`, "warning");
			}
			return { block: true, reason: `Path "${targetPath}" is protected` };
		}

		return undefined;
	});
}

// @ts-nocheck
/**
 * Permission Gate Extension
 *
 * - Prompts for confirmation before potentially dangerous bash commands
 *   (rm -rf, sudo, chmod/chown 777).
 * - Any file operation (read, write, edit, bash) that touches paths outside
 *   the current working directory (ctx.cwd, i.e. where pi was started)
 *   requires user authorization.
 */

import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Paths outside cwd that are allowed without confirmation. */
const ALLOWED_PATHS = ["/tmp/", "/private/tmp/"];

/** True if targetPath, when resolved against cwd, is outside cwd. */
function isOutsideCwd(cwd: string, targetPath: string): boolean {
	const resolved = path.resolve(cwd, targetPath);
	const rel = path.relative(cwd, resolved);
	return rel.startsWith("..") || path.isAbsolute(rel);
}

/** True if targetPath is inside one of the allowed paths. */
function isAllowedPath(targetPath: string): boolean {
	const resolved = path.resolve(targetPath);
	return ALLOWED_PATHS.some((allowed) => resolved.startsWith(allowed));
}

export default function (pi: ExtensionAPI) {
	const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];
	// Heuristic: bash command likely touches paths outside cwd (absolute, ~, or ..)
	const outsideCwdPatterns = [/(\s|^|["'`])\/\S+/, /(\s|^|["'`])~\//, /\.\.\//];

	pi.on("tool_call", async (event, ctx) => {
		const cwd = path.resolve(ctx.cwd);
		let reasonLabel: string | null = null;
		let detail = "";

		// File tools with explicit path: use resolved path against ctx.cwd
		if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
			const targetPath = event.input.path as string | undefined;
			if (targetPath && isOutsideCwd(cwd, targetPath)) {
				// Allow all file operations on /tmp without confirmation
				if (isAllowedPath(targetPath)) {
					return undefined;
				}
				reasonLabel = "Path is outside current working directory";
				detail = `${event.toolName}: ${targetPath}\n\nCWD: ${cwd}`;
			}
		}

		// Bash: dangerous patterns or heuristic "outside cwd" patterns
		if (event.toolName === "bash" && !reasonLabel) {
			const command = event.input.command as string;
			const isDangerous = dangerousPatterns.some((p) => p.test(command));
			const touchesOutsideCwd = outsideCwdPatterns.some((p) => p.test(command));
			if (isDangerous) {
				reasonLabel = "Dangerous command";
				detail = command;
			} else if (touchesOutsideCwd) {
				reasonLabel = "Command may touch paths outside current working directory";
				detail = `${command}\n\nCWD: ${cwd}`;
			}
		}

		if (!reasonLabel) return undefined;

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `${reasonLabel} (no UI for confirmation)`,
			};
		}

		const choice = await ctx.ui.select(
			`⚠️ ${reasonLabel}:\n\n${detail}\n\nAllow?`,
			["Yes", "No"]
		);

		if (choice !== "Yes") {
			return { block: true, reason: "Blocked by user" };
		}

		return undefined;
	});
}

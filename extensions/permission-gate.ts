// @ts-nocheck
/**
 * Permission Gate Extension
 *
 * - Prompts for confirmation before potentially dangerous bash commands
 *   (rm -rf, sudo, chmod/chown 777).
 * - Flags shell commands when parsed path arguments resolve outside the
 *   current working directory and asks for confirmation.
 * - Any tool (read, write, edit, bash) that references paths outside
 *   the current working directory (ctx.cwd, i.e. where pi was started)
 *   requires user authorization.
 *
 * Configuration is read from ~/.pi/agent/safe-coder.json at startup.
 * See README.md for details.
 */

import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mergeArrays, loadConfig, type SafeCoderConfig } from "../lib/config-loader.ts";

// ── Resolved paths (defaults merged with user config) ───────────────────────

const config = loadConfig<SafeCoderConfig>();

const DEFAULT_ALLOWED_FILE_OPERATION_PATHS = ["/tmp", "/private/tmp"];
const DEFAULT_ALLOWED_READ_PATHS = [path.join(os.homedir(), ".agents")];
const DEFAULT_ALLOWED_BASH_PATHS = ["/dev/null"];

const ALLOWED_FILE_OPERATION_PATHS = mergeArrays(
	DEFAULT_ALLOWED_FILE_OPERATION_PATHS,
	config?.allowedFileOperationPaths
);

const ALLOWED_READ_PATHS = mergeArrays(DEFAULT_ALLOWED_READ_PATHS, config?.allowedReadPaths);

const ALLOWED_BASH_PATHS = mergeArrays(DEFAULT_ALLOWED_BASH_PATHS, config?.allowedBashPaths);

// ── Helpers ─────────────────────────────────────────────────────────────────

const SHELL_OPERATORS = new Set(["|", "||", "&", "&&", ";", "(", ")", "<", ">"]);

/** Resolve a target path against cwd, including shell-style home paths. */
function resolveTargetPath(cwd: string, targetPath: string): string {
	if (targetPath === "~") return os.homedir();
	if (targetPath.startsWith("~/")) return path.join(os.homedir(), targetPath.slice(2));
	if (/^~[^/\\]+/.test(targetPath)) return path.join(path.dirname(os.homedir()), targetPath.slice(1));
	return path.resolve(cwd, targetPath);
}

/** Resolve a path and normalize to lowercase for case-insensitive comparison. */
function resolvePathLower(p: string): string {
	return path.resolve(p).toLowerCase();
}

/** True if targetPath is the same as basePath or inside it. */
function isSameOrInsidePath(basePath: string, targetPath: string): boolean {
	const rel = path.relative(resolvePathLower(basePath), resolvePathLower(targetPath));
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True if targetPath, when resolved against cwd, is outside cwd. */
function isOutsideCwd(cwd: string, targetPath: string): boolean {
	const rel = path.relative(resolvePathLower(cwd), resolvePathLower(resolveTargetPath(cwd, targetPath)));
	return rel.startsWith("..") || path.isAbsolute(rel);
}

/** True if this file operation is allowed outside cwd without confirmation. */
function isAllowedOutsideCwdFileOperation(cwd: string, toolName: string, targetPath: string): boolean {
	const resolved = resolveTargetPath(cwd, targetPath);
	if (ALLOWED_FILE_OPERATION_PATHS.some((allowed) => isSameOrInsidePath(allowed, resolved))) {
		return true;
	}

	return toolName === "read" && ALLOWED_READ_PATHS.some((allowed) => isSameOrInsidePath(allowed, resolved));
}

/** Split shell input enough to inspect path-like arguments without executing it. */
function splitShellWords(command: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: string | null = null;
	let escaped = false;

	const pushCurrent = () => {
		if (current.length > 0) {
			words.push(current);
			current = "";
		}
	};

	for (const char of command) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}

		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			pushCurrent();
			continue;
		}

		if ("|&;()<>".includes(char)) {
			pushCurrent();
			words.push(char);
			continue;
		}

		current += char;
	}

	if (escaped) current += "\\";
	pushCurrent();
	return words;
}

function normalizePathCandidate(value: string): string {
	return value.replace(/^[([{`]+/, "").replace(/[),;`]+$/, "");
}

function looksLikeOutsideCwdReference(value: string): boolean {
	return (
		value === "~" ||
		value.startsWith("~/") ||
		/^~[^/\\]+/.test(value) ||
		value.startsWith("/") ||
		value === ".." ||
		value.startsWith("../") ||
		value.includes("/../")
	);
}

function pathCandidatesFromShellWord(word: string): string[] {
	if (SHELL_OPERATORS.has(word) || /^\d+$/.test(word)) return [];

	const values = [word];
	const equalsIndex = word.indexOf("=");
	if (equalsIndex >= 0 && equalsIndex < word.length - 1) {
		values.push(word.slice(equalsIndex + 1));
	}

	return values.map(normalizePathCandidate).filter(looksLikeOutsideCwdReference);
}

function isAllowedBashPath(cwd: string, targetPath: string): boolean {
	const resolved = resolvePathLower(resolveTargetPath(cwd, targetPath));
	return ALLOWED_BASH_PATHS.some((allowed) => resolvePathLower(allowed) === resolved);
}

function commandTouchesOutsideCwd(cwd: string, command: string): boolean {
	return splitShellWords(command)
		.flatMap(pathCandidatesFromShellWord)
		.some((targetPath) => isOutsideCwd(cwd, targetPath) && !isAllowedBashPath(cwd, targetPath));
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

	pi.on("tool_call", async (event, ctx) => {
		const cwd = path.resolve(ctx.cwd);
		let reasonLabel: string | null = null;
		let detail = "";

		// File tools with explicit path: use resolved path against ctx.cwd
		if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
			const targetPath = event.input.path as string | undefined;
			if (targetPath && isOutsideCwd(cwd, targetPath)) {
				if (isAllowedOutsideCwdFileOperation(cwd, event.toolName, targetPath)) {
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
			const touchesOutsideCwd = commandTouchesOutsideCwd(cwd, command);
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

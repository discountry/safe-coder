// @ts-nocheck
/**
 * Sensitive Data Filter Extension
 *
 * Protects against accidental exposure of API keys and secrets by:
 * 1. Detecting reads of known-sensitive files (certificates, keys, credentials)
 * 2. Showing an obfuscated preview to the user for approval
 * 3. Obfuscating all matching values in read results before they reach the model
 *
 * Configuration is read from ~/.pi/agent/safe-coder.json at startup.
 * See README.md for details.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mergeArrays, loadConfig, type SafeCoderConfig } from "../lib/config-loader.ts";

// ── Sensitive file detection ────────────────────────────────────────────────

/** Default glob-like patterns for files that commonly contain API keys/secrets. */
const DEFAULT_SENSITIVE_FILE_PATTERNS = [
	"*.env",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"*.jks",
	"id_rsa",
	"id_ed25519",
	"settings.json",
	".netrc",
	".npmrc",
	".pypirc",
	".config/gcloud/credentials.db",
	".aws/credentials",
	".docker/config.json",
];

const config = loadConfig<SafeCoderConfig>();

const SENSITIVE_FILE_PATTERNS = mergeArrays(
	DEFAULT_SENSITIVE_FILE_PATTERNS,
	config?.sensitiveFilePatterns
);

/** Check if a filename matches any sensitive file pattern. */
function isSensitiveFile(filename: string): boolean {
	const basename = path.basename(filename).toLowerCase();
	return SENSITIVE_FILE_PATTERNS.some((pattern) => {
		const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
		return new RegExp(`^${regexPattern}$`, "i").test(basename);
	});
}

// ── Content obfuscation ─────────────────────────────────────────────────────

/** Regex patterns that match common API keys, tokens, and secrets. */
const SENSITIVE_VALUE_PATTERNS = [
	/(?:api[_-]?key|apikey)\s*[=:]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi,
	/(?:secret[_-]?key|secret)\s*[=:]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi,
	/(?:access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi,
	/(?:sk-ant-[a-zA-Z0-9_-]{20,})/g,
	/(?:sk-proj-[a-zA-Z0-9_-]{20,})/g,
	/(?:Bearer\s+eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/g,
];

/** Obfuscate sensitive values in file content. Replaces all chars with 'x', preserving first 4 and last 4 characters. */
function obfuscateSensitiveValues(content: string): string {
	let result = content;
	for (const pattern of SENSITIVE_VALUE_PATTERNS) {
		result = result.replace(pattern, (match) => {
			if (match.length <= 8) {
				return "x".repeat(match.length); // fully mask short values
			}
			const start = match.slice(0, 4);
			const end = match.slice(-4);
			return `${start}${"x".repeat(match.length - 8)}${end}`;
		});
	}
	return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve a target path against cwd, including shell-style home paths. */
function resolveTargetPath(cwd: string, targetPath: string): string {
	if (targetPath === "~") return os.homedir();
	if (targetPath.startsWith("~/")) return path.join(os.homedir(), targetPath.slice(2));
	if (/^~[^/\\]+/.test(targetPath)) return path.join(path.dirname(os.homedir()), targetPath.slice(1));
	return path.resolve(cwd, targetPath);
}

// ── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

	// Detect sensitive files on read and show obfuscated preview to user.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "read") return undefined;

		const targetPath = event.input.path as string | undefined;
		if (!targetPath || !isSensitiveFile(targetPath)) return undefined;

		try {
			const cwd = path.resolve(ctx.cwd);
			const resolved = resolveTargetPath(cwd, targetPath);
			const rawContent = fs.readFileSync(resolved, "utf-8");
			const obfuscated = obfuscateSensitiveValues(rawContent);

			const choice = await ctx.ui.select(
				`⚠️ Sensitive file detected:\n\nFile: ${targetPath}\n\nPreview (values obfuscated):\n${obfuscated.slice(0, 2000)}${rawContent.length > 2000 ? "\n...(truncated)" : ""}\n\nAllow read with obfuscation?`,
				["Yes", "No"]
			);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		} catch {
			return { block: true, reason: "Could not read sensitive file for preview" };
		}

		return undefined;
	});

	// Obfuscate sensitive values in read tool results before they reach the model.
	// Creates a new array/objects instead of mutating event data in place.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "read" && !event.isError && Array.isArray(event.content)) {
			const obfuscated = event.content.map((c: any) => {
				if (c.type === "text" && typeof c.text === "string") {
					return { ...c, text: obfuscateSensitiveValues(c.text) };
				}
				return c;
			});
			return { content: obfuscated };
		}
		return undefined;
	});
}

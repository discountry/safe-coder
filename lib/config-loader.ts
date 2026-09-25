// @ts-nocheck
/**
 * Shared configuration loader for safe-coder extensions.
 *
 * Reads ~/.pi/agent/safe-coder.json at startup and merges user values
 * with built-in defaults (defaults first, deduplicated).
 * Returns null if the config file is missing or invalid — callers
 * should fall back to their own defaults in that case.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_FILE = path.join(getAgentDir(), "safe-coder.json");

/** Shape of safe-coder.json */
export interface SafeCoderConfig {
	allowedReadPaths?: string[];
	allowedFileOperationPaths?: string[];
	allowedBashPaths?: string[];

	/** Glob patterns for files whose content may contain API keys or secrets. */
	sensitiveFilePatterns?: string[];
}

/** Resolve a single path, expanding ~ to home directory. */
export function resolvePath(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	if (/^~[^/\\]+/.test(p)) return path.join(path.dirname(os.homedir()), p.slice(1));
	return p;
}

/** Merge user config arrays with built-in defaults (defaults first, deduplicated). */
export function mergeArrays(defaults: string[], configValues?: string[]): string[] {
	const resolved = new Set<string>();
	for (const d of defaults) resolved.add(resolvePath(d));
	if (configValues) {
		for (const c of configValues) resolved.add(resolvePath(c));
	}
	return [...resolved];
}

/** Load and parse the config file, returning null on any error. */
export function loadConfig<T>(): T | null {
	try {
		const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
		return JSON.parse(raw) as T;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		if (err instanceof SyntaxError) {
			console.error(`safe-coder: ${CONFIG_FILE} exists but is not valid JSON.`);
			return null;
		}
		console.error(`safe-coder: failed to read ${CONFIG_FILE}:`, err);
		return null;
	}
}

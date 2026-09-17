import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CompressResult, OpenAIMessage } from "./types.ts";

interface ProxyCompressResponse {
	messages: OpenAIMessage[];
	tokens_before: number;
	tokens_after: number;
	tokens_saved: number;
	compression_ratio: number;
	transforms_applied: string[];
	ccr_hashes?: string[];
}

export class HeadroomHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HeadroomHttpError";
	}
}

interface HeadroomClientOptions {
	baseUrl: string;
	timeoutMs: number;
	proxyToken?: string;
}

export const HEADROOM_PROXY_TOKEN_FILE = path.join(os.homedir(), ".config", "codesook-omp", "headroom", "proxy-token");

export function loadHeadroomProxyToken(tokenPath: string = HEADROOM_PROXY_TOKEN_FILE): string | undefined {
	const resolvedPath =
		tokenPath === "~" ? os.homedir() : tokenPath.startsWith("~/") ? path.join(os.homedir(), tokenPath.slice(2)) : tokenPath;
	try {
		const token = fs.readFileSync(resolvedPath, "utf8").trim();
		return token || undefined;
	} catch {
		return undefined;
	}
}

export function writeHeadroomProxyToken(token: string, tokenPath: string = HEADROOM_PROXY_TOKEN_FILE): string {
	const normalizedToken = token.trim();
	if (!normalizedToken) throw new Error("Headroom proxy token must not be empty.");
	if (/[\r\n]/u.test(normalizedToken)) throw new Error("Headroom proxy token must not contain newlines.");

	const resolvedPath =
		tokenPath === "~" ? os.homedir() : tokenPath.startsWith("~/") ? path.join(os.homedir(), tokenPath.slice(2)) : tokenPath;
	const directory = path.dirname(resolvedPath);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	fs.chmodSync(directory, 0o700);
	const temporaryPath = path.join(directory, `.${path.basename(resolvedPath)}.${process.pid}.${randomUUID()}.tmp`);
	try {
		fs.writeFileSync(temporaryPath, `${normalizedToken}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		fs.chmodSync(temporaryPath, 0o600);
		fs.renameSync(temporaryPath, resolvedPath);
	} catch (error) {
		try {
			fs.unlinkSync(temporaryPath);
		} catch {
			// Preserve the original write error.
		}
		throw error;
	}
	return resolvedPath;
}


export class HeadroomHttpClient {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly proxyToken: string | undefined;

	constructor(options: HeadroomClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		this.timeoutMs = options.timeoutMs;
		this.proxyToken = options.proxyToken?.trim() || undefined;
	}

	private proxyHeaders(): Record<string, string> {
		return this.proxyToken ? { "X-Headroom-Proxy-Token": this.proxyToken } : {};
	}

	async health(signal?: AbortSignal): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/health`, {
				headers: this.proxyHeaders(),
				signal: buildSignal(this.timeoutMs, signal),
			});
			if (!response.ok) return false;
			const body = await readJsonObject(response);
			if (!body) return true;
			return body.status === "healthy" || body.status === "ok" || "optimize" in body || "stats" in body;
		} catch {
			return false;
		}
	}

	async stats(signal?: AbortSignal): Promise<unknown> {
		const response = await fetch(`${this.baseUrl}/stats`, {
			headers: this.proxyHeaders(),
			signal: buildSignal(this.timeoutMs, signal),
		});
		if (!response.ok) {
			throw new Error(`Headroom /stats failed with HTTP ${response.status}`);
		}
		return response.json();
	}

	async compress(messages: OpenAIMessage[], model: string | undefined, signal?: AbortSignal): Promise<CompressResult> {
		const response = await fetch(`${this.baseUrl}/v1/compress`, {
			method: "POST",
			headers: {
				...this.proxyHeaders(),
				"Content-Type": "application/json",
				"X-Headroom-Stack": "omp-extension",
			},
			body: JSON.stringify({ messages, model: model || "gpt-4o" }),
			signal: buildSignal(this.timeoutMs, signal),
		});

		if (!response.ok) {
			const message = await readErrorMessage(response);
			throw new HeadroomHttpError(response.status, message || `Headroom /v1/compress failed with HTTP ${response.status}`);
		}

		const payload = (await response.json()) as ProxyCompressResponse;
		return {
			messages: payload.messages,
			tokensBefore: payload.tokens_before,
			tokensAfter: payload.tokens_after,
			tokensSaved: payload.tokens_saved,
			compressionRatio: payload.compression_ratio,
			transformsApplied: payload.transforms_applied ?? [],
			ccrHashes: payload.ccr_hashes ?? [],
			compressed: true,
		};
	}
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
	try {
		const body = (await response.json()) as unknown;
		return isRecord(body) ? body : undefined;
	} catch {
		return undefined;
	}
}

async function readErrorMessage(response: Response): Promise<string | undefined> {
	try {
		const body = (await response.json()) as unknown;
		if (!isRecord(body)) return undefined;
		const error = body.error;
		if (isRecord(error) && typeof error.message === "string") return error.message;
		if (typeof body.message === "string") return body.message;
	} catch {
		// Ignore malformed error bodies.
	}
	return undefined;
}

function buildSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	if (!signal) return timeoutSignal;
	if (signal.aborted) return signal;
	return AbortSignal.any([signal, timeoutSignal]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

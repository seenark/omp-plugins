import type { ContextEvent } from "@oh-my-pi/pi-coding-agent";

// Derive AgentMessage from OMP's public ContextEvent payload so the plugin
// depends only on public @oh-my-pi package types.
export type AgentMessage = ContextEvent["messages"][number];

export interface TextContentPart {
	type: "text";
	text: string;
}

export interface ImageContentPart {
	type: "image_url";
	image_url: { url: string; detail?: "auto" | "low" | "high" };
}

export type OpenAIContentPart = TextContentPart | ImageContentPart;

export interface OpenAISystemMessage {
	role: "system";
	content: string;
}

export interface OpenAIUserMessage {
	role: "user";
	content: string | OpenAIContentPart[];
}

export interface OpenAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

export interface OpenAIAssistantMessage {
	role: "assistant";
	content: string | null;
	tool_calls?: OpenAIToolCall[];
}

export interface OpenAIToolMessage {
	role: "tool";
	content: string;
	tool_call_id: string;
}

export type OpenAIMessage = OpenAISystemMessage | OpenAIUserMessage | OpenAIAssistantMessage | OpenAIToolMessage;

export interface CompressResult {
	messages: OpenAIMessage[];
	tokensBefore: number;
	tokensAfter: number;
	tokensSaved: number;
	compressionRatio: number;
	transformsApplied: string[];
	ccrHashes: string[];
	/** Set when the server returned originals unchanged (`compression_skipped`). */
	skipReason?: string;
	session?: { id: string; frozenMessageCount: number; cachedPrefixReplayed: boolean };
}

export interface HeadroomConfig {
	enabled: boolean;
	baseUrl: string;
	allowRemote: boolean;
	autoStart: boolean;
	command: string;
	minContextTokens: number;
	minMessageChars: number;
	timeoutMs: number;
	proxyTokenFile: string;
}

export interface HeadroomStats {
	/** Compress requests sent to the server. */
	attempts: number;
	/** Calls where the server newly compressed at least one result. */
	applied: number;
	guardSkips: number;
	/** Calls that reached the model; the Headroom Savings denominator spans these. */
	calls: number;
	beforeTokens: number;
	savedTokens: number;
	last?: {
		beforeTokens: number;
		savedTokens: number;
		newMessages: number;
		replayedMessages: number;
		transformsApplied: string[];
		ccrHashes: string[];
		session?: CompressResult["session"];
	};
	lastError?: string;
	lastSkipReason?: string;
}

export interface CompressionMapping {
	sourceIndex: number;
	message: OpenAIMessage;
	applyTo: "toolResult" | null;
	originalText: string;
	toolCallId?: string;
}

export interface CompressionPayload {
	messages: OpenAIMessage[];
	mappings: CompressionMapping[];
	candidateCount: number;
	/** Characters across every converted message; feeds the Headroom Savings estimate. */
	chars: number;
}

export type ApplyCompressionResult =
	| { ok: true; replacements: Map<string, string>; rejected: string[] }
	| { ok: false; reason: string };

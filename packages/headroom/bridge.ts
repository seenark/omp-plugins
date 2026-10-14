import type { ImageContent, TextContent, ToolCall } from "@oh-my-pi/pi-ai";
import type {
	AgentMessage,
	ApplyCompressionResult,
	CompressionMapping,
	CompressionPayload,
	OpenAIAssistantMessage,
	OpenAIMessage,
	OpenAIToolCall,
} from "./types.ts";

type AnyMessage = AgentMessage & { role?: string; content?: unknown; timestamp?: number; isError?: boolean };

interface MessageWithContent {
	content: unknown;
}

const STANDARD_COMPRESSIBLE_ROLES = new Set(["user", "assistant", "toolResult"]);

/** A bash command that runs `rtk`; its result is already compacted by RTK (pitfall I1). */
const RTK_COMMAND = /(^|[;&|(]\s*)rtk\s/;

/** One chars/4 estimate for every Headroom Savings number. */
export function estimateTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

export function buildCompressionPayload(messages: AgentMessage[], minMessageChars: number): CompressionPayload {
	const mappings: CompressionMapping[] = [];
	const rtkCallIds = collectRtkCallIds(messages);
	let candidateCount = 0;
	let chars = 0;

	for (let sourceIndex = 0; sourceIndex < messages.length; sourceIndex++) {
		const source = messages[sourceIndex] as AnyMessage;
		const converted = convertMessage(source);
		if (!converted) continue;

		const originalText = extractOpenAIText(converted);
		const toolCallId = converted.role === "tool" ? converted.tool_call_id : undefined;
		const applyTo =
			source.role === "toolResult" &&
			source.isError !== true &&
			!rtkCallIds.has(toolCallId ?? "") &&
			originalText.length >= minMessageChars
				? "toolResult"
				: null;
		if (applyTo) candidateCount++;
		chars += originalText.length + toolCallChars(converted);
		mappings.push({ sourceIndex, message: converted, applyTo, originalText, toolCallId });
	}

	return {
		messages: mappings.map((mapping) => mapping.message),
		mappings,
		candidateCount,
		chars,
	};
}

/**
 * Take every candidate change from the server independently. Changes to non-candidates,
 * misaligned messages, empty text, or text that is not shorter are ignored, not fatal.
 */
export function applyCompressionResult(
	mappings: CompressionMapping[],
	compressedMessages: OpenAIMessage[],
): ApplyCompressionResult {
	if (compressedMessages.length !== mappings.length) {
		return { ok: false, reason: "message-count-changed" };
	}

	const replacements = new Map<string, string>();
	const rejected: string[] = [];
	for (let index = 0; index < mappings.length; index++) {
		const mapping = mappings[index];
		if (mapping.applyTo !== "toolResult" || !mapping.toolCallId) continue;
		const compressed = compressedMessages[index];
		const mismatch = alignmentMismatch(mapping.message, compressed);
		if (mismatch) {
			rejected.push(mismatch);
			continue;
		}
		const nextText = extractOpenAIText(compressed);
		if (nextText === mapping.originalText) continue;
		if (nextText.length === 0 || nextText.length >= mapping.originalText.length) {
			rejected.push("not-smaller");
			continue;
		}
		replacements.set(mapping.toolCallId, nextText);
	}
	return { ok: true, replacements, rejected };
}

/**
 * Index of the last assistant message that carries provider-reported prompt usage, or -1.
 * OMP's context estimate is anchored on that usage: everything up to it is counted as the provider
 * saw it (already compressed), everything after it is estimated from the original text.
 */
export function findUsageAnchor(messages: AgentMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index] as AnyMessage & { usage?: { input?: number; cacheRead?: number; cacheWrite?: number } };
		if (message.role !== "assistant" || !message.usage) continue;
		if ((message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0) > 0) return index;
	}
	return -1;
}

/**
 * Replace tool-result text by toolCallId, copying only the messages that change.
 * Returns the input array itself when nothing changed. `anchoredChars` is the share of the
 * replaced text at or before `anchorIndex`.
 */
export function replaceToolResultTexts(
	messages: AgentMessage[],
	replacements: ReadonlyMap<string, string>,
	anchorIndex = -1,
): {
	messages: AgentMessage[];
	originalChars: number;
	forwardedChars: number;
	anchoredChars: { original: number; forwarded: number };
	replaced: number;
} {
	let originalChars = 0;
	let forwardedChars = 0;
	const anchoredChars = { original: 0, forwarded: 0 };
	let replaced = 0;
	let next: AgentMessage[] | undefined;
	if (replacements.size > 0) {
		for (let index = 0; index < messages.length; index++) {
			const source = messages[index] as AnyMessage;
			const toolCallId = source.role === "toolResult" ? readStringProperty(source, "toolCallId") : undefined;
			const text = toolCallId === undefined ? undefined : replacements.get(toolCallId);
			if (text === undefined) continue;
			const previous = extractTextFromContent(source.content);
			if (previous === text) continue;
			const copy = { ...source } as AnyMessage & MessageWithContent;
			if (!replaceTextContent(copy, text)) continue;
			next ??= [...messages];
			next[index] = copy as AgentMessage;
			originalChars += previous.length;
			forwardedChars += text.length;
			if (index <= anchorIndex) {
				anchoredChars.original += previous.length;
				anchoredChars.forwarded += text.length;
			}
			replaced++;
		}
	}
	return { messages: next ?? messages, originalChars, forwardedChars, anchoredChars, replaced };
}

function collectRtkCallIds(messages: AgentMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const message of messages as AnyMessage[]) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isToolCall(part) || part.name !== "bash") continue;
			const command = part.arguments.command;
			if (typeof command === "string" && RTK_COMMAND.test(command)) ids.add(part.id);
		}
	}
	return ids;
}

function toolCallChars(message: OpenAIMessage): number {
	if (message.role !== "assistant") return 0;
	return (message.tool_calls ?? []).reduce((sum, call) => sum + call.function.name.length + call.function.arguments.length, 0);
}

function convertMessage(message: AnyMessage): OpenAIMessage | undefined {
	if (!message.role || !STANDARD_COMPRESSIBLE_ROLES.has(message.role)) return undefined;
	switch (message.role) {
		case "user":
			return convertUserMessage(message);
		case "assistant":
			return convertAssistantMessage(message);
		case "toolResult":
			return convertToolResultMessage(message);
		default:
			return undefined;
	}
}

function convertUserMessage(message: AnyMessage): OpenAIMessage | undefined {
	if (!hasContent(message)) return undefined;
	if (typeof message.content === "string") {
		return { role: "user", content: message.content };
	}
	if (!Array.isArray(message.content)) return undefined;

	const text = message.content
		.filter((part): part is TextContent => isTextContent(part))
		.map((part) => part.text)
		.join("\n");
	if (text) return { role: "user", content: text };
	const hasImages = message.content.some((part) => isImageContent(part));
	return hasImages ? { role: "user", content: "[image omitted from Headroom compression payload]" } : undefined;
}

function convertAssistantMessage(message: AnyMessage): OpenAIAssistantMessage | undefined {
	if (!hasContent(message) || !Array.isArray(message.content)) return undefined;
	const text = message.content
		.filter((part): part is TextContent => isTextContent(part))
		.map((part) => part.text)
		.join("");
	const toolCalls = message.content.filter((part): part is ToolCall => isToolCall(part));
	if (!text && toolCalls.length === 0) return undefined;

	const converted: OpenAIAssistantMessage = {
		role: "assistant",
		content: text || null,
	};
	if (toolCalls.length > 0) {
		converted.tool_calls = toolCalls.map(convertToolCall);
	}
	return converted;
}

function convertToolResultMessage(message: AnyMessage): OpenAIMessage | undefined {
	if (!hasContent(message)) return undefined;
	const toolCallId = readStringProperty(message, "toolCallId");
	if (!toolCallId) return undefined;
	return {
		role: "tool",
		content: extractTextFromContent(message.content),
		tool_call_id: toolCallId,
	};
}

function convertToolCall(toolCall: ToolCall): OpenAIToolCall {
	return {
		id: toolCall.id,
		type: "function",
		function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) },
	};
}

function alignmentMismatch(original: OpenAIMessage, compressed: OpenAIMessage): string | undefined {
	if (original.role !== compressed.role) return `role-changed:${original.role}->${compressed.role}`;
	if (original.role === "tool" && compressed.role === "tool" && original.tool_call_id !== compressed.tool_call_id) {
		return "tool-call-id-changed";
	}
	return undefined;
}

function extractOpenAIText(message: OpenAIMessage): string {
	if (message.role === "assistant") return typeof message.content === "string" ? message.content : "";
	if (message.role === "tool" || message.role === "system") return message.content;
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is TextContent => isTextContent(part))
		.map((part) => part.text)
		.join("\n");
}

function replaceTextContent(message: MessageWithContent, text: string): boolean {
	if (typeof message.content === "string") {
		message.content = text;
		return true;
	}
	if (!Array.isArray(message.content)) return false;
	const imageParts = message.content.filter((part): part is ImageContent => isImageContent(part));
	message.content = [{ type: "text", text }, ...imageParts];
	return true;
}

function hasContent(message: AnyMessage): message is AnyMessage & MessageWithContent {
	return "content" in message;
}

function isTextContent(value: unknown): value is TextContent {
	return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function isImageContent(value: unknown): value is ImageContent {
	return (
		isRecord(value) && value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string"
	);
}

function isToolCall(value: unknown): value is ToolCall {
	return (
		isRecord(value) &&
		value.type === "toolCall" &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		isRecord(value.arguments)
	);
}

function readStringProperty(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const property = value[key];
	return typeof property === "string" ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

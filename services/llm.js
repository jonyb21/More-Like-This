// Your own LLM as a recommendation source. Any server that speaks the
// OpenAI chat API works (llama.cpp, vLLM, Ollama, LM Studio, OpenRouter...).
// It answers "Title, Year" lines. The prompt is shorter and stricter than
// Gemini's: small local models given Gemini's prompt tend to run out of ideas
// and repeat the searched title to fill the list.
const fetch = require("node-fetch");
const { withTimeout } = require("../utils/timeout");
const logger = require("../utils/logger");

const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;

function cleanBase(baseUrl) {
	return String(baseUrl || "")
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/chat\/completions$/, "");
}

function headers(apiKey) {
	const h = { "Content-Type": "application/json" };
	if (apiKey) h.Authorization = `Bearer ${apiKey}`;
	return h;
}

// Strips reasoning blocks, numbering, bullets and quotes, then reads "Title, Year".
function parseLlmReturn(text) {
	const body = String(text || "")
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/```[a-z]*\n?|```/gi, "");

	return body
		.split("\n")
		.map((row) => row.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
		.filter((row) => row !== "")
		.map((row) => {
			const match = row.match(/^(.*?)[,(]\s*((?:19|20)\d{2})\)?\s*$/);
			const title = (match ? match[1] : row.split(",")[0])
				.trim()
				.replace(/^["'*]+|["'*]+$/g, "")
				.trim();
			return { title, year: match ? match[2] : "" };
		})
		.filter((r) => r.title !== "");
}

const LLM_REC_COUNT = Number(process.env.LLM_MAX_RESULT) || 20;

function buildMessages(title, year, mediaType) {
	const kind = mediaType === "movie" ? "movies" : "TV shows";
	return [
		{
			role: "system",
			content: `You recommend ${kind}. Reply with a plain list only: one per line, as "Title, Year". No numbering, no notes, no other text.`,
		},
		{
			role: "user",
			content: `List ${LLM_REC_COUNT} different ${kind} for someone who loved "${title}" (${year}). Match its themes, tone, story and feel. Include sequels or prequels if there are any. Do not include "${title}" itself and never repeat a title. If you cannot think of ${LLM_REC_COUNT}, list fewer.`,
		},
	];
}

async function chat(baseUrl, apiKey, model, messages, maxTokens, extra = {}) {
	const response = await withTimeout(
		fetch(`${cleanBase(baseUrl)}/chat/completions`, {
			method: "POST",
			headers: headers(apiKey),
			body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens, ...extra }),
		}),
		LLM_TIMEOUT_MS,
		"LLM request timed out",
	);
	if (!response.ok) return null;
	const json = await response.json();
	return json?.choices?.[0]?.message?.content || null;
}

async function validateAPIKey(apiKey, baseUrl, model) {
	if (!baseUrl) return false;
	try {
		// A model list is the cheapest check; fall back to a one-word chat
		const response = await withTimeout(fetch(`${cleanBase(baseUrl)}/models`, { headers: headers(apiKey) }), 10000, "LLM check timed out");
		if (response.ok) {
			const json = await response.json();
			if (Array.isArray(json?.data)) return true;
		}
		return Boolean(await chat(baseUrl, apiKey, model, [{ role: "user", content: 'Say "hi"' }], 5));
	} catch (err) {
		return false;
	}
}

async function getLlmRecs(title, year, mediaType, apiKey, baseUrl, model) {
	try {
		const cleanedTitle = title.replace(/[^\p{L}\p{N} ]/gu, "");
		// The penalty discourages the model from repeating lines
		const text = await chat(baseUrl, apiKey, model, buildMessages(cleanedTitle, year, mediaType), 2048, { frequency_penalty: 0.6 });
		if (!text) return null;
		return parseLlmReturn(text);
	} catch (error) {
		logger.error(error.message, null);
		return null;
	}
}

module.exports = { validateAPIKey, getLlmRecs, parseLlmReturn, cleanBase, buildMessages };

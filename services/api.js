const tmdb = require("../services/tmdb");
const trakt = require("../services/trakt");
const simkl = require("../services/simkl");
const gemini = require("../services/gemini");
const rpdb = require("../services/rpdb");
const tastedive = require("../services/tastedive");
const watchmode = require("../services/watchmode");
const llm = require("../services/llm");

async function validateApiKeys(apiKeys, extra = {}) {
	const validators = {
		tmdb: tmdb.validateAPIKey,
		trakt: trakt.validateAPIKey,
		simkl: simkl.validateAPIKey,
		tastedive: tastedive.validateAPIKey,
		gemini: gemini.validateAPIKey,
		rpdb: rpdb.validateAPIKey,
		watchmode: watchmode.validateAPIKey,
		llm: (key) => llm.validateAPIKey(key, extra.baseUrl, extra.model),
	};

	const results = {};

	for (const [keyName, keyValue] of Object.entries(apiKeys)) {
		const validator = validators[keyName];
		if ((keyValue !== "" || keyName === "llm") && validator) {
			try {
				const isValid = await validator(keyValue);
				results[keyName] = {
					key: keyValue,
					valid: isValid,
				};
			} catch (err) {
				results[keyName] = {
					key: keyValue,
					valid: false,
					error: err.message || "Validation error",
				};
			}
		} else {
			results[keyName] = {
				key: keyValue,
				valid: false,
				error: "No validator found",
			};
		}
	}

	return results;
}

module.exports = {
	validateApiKeys,
};

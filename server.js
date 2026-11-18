#!/usr/bin/env node

const { streamHandler } = require("./src/streamHandler");
const { metaHandler } = require("./src/metaHandler");
const { catalogHandler } = require("./src/catalogHandler");
const express = require("express");
const cors = require("cors");
const path = require("path");
const logger = require("./utils/logger");
const { PORT, ENCRYPTION_KEY_INPUT } = require("./config");
const { validateApiKeys } = require("./services/api");
const { encryptData, decryptData } = require("./utils/encryption");
const packageJson = require("./package.json");
const history = require("./utils/history");
const places = require("./src/places");

// An LLM set on the server (OpenAI-compatible). Installs can use it without
// putting its key in their install link.
const SERVER_LLM = {
	baseUrl: process.env.LLM_BASE_URL || "",
	key: process.env.LLM_API_KEY || "",
	model: process.env.LLM_MODEL || "",
};

// The address Stremio uses to reach this server. PUBLIC_URL wins when set
// (for example http://192.168.4.29:7000). Otherwise plain http is used for
// localhost and home-network addresses, and https for everything else.
function baseUrl(req) {
	if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
	let host = req.headers.host || "";
	if (host === "bbab4a35b833-more-like-this") host = host + ".baby-beamup.club";
	const forwarded = req.headers["x-forwarded-proto"];
	const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
	const protocol = forwarded ? String(forwarded).split(",")[0].trim() : isLocal ? "http" : "https";
	return `${protocol}://${host}`;
}

// The config part of the URL exactly as Stremio sent it. It names the install.
function rawConfigSegment(req) {
	return (req.originalUrl || "").split("?")[0].split("/")[1] || "";
}

async function loadUserConfig(config) {
	const defaultConfig = {
		apiKeys: {
			tmdb: { key: "", valid: false },
			trakt: { key: "", valid: false },
			gemini: { key: "", valid: false },
			watchmode: { key: "", valid: false },
			simkl: { key: "", valid: false },
			tastedive: { key: "", valid: false },
			rpdb: { key: "", valid: false },
			llm: { key: "", valid: false, baseUrl: "", model: "" },
		},
		combineCatalogs: false,
		catalogOrder: ["tmdb", "trakt", "simkl", "gemini", "llm", "tasteDive", "watchmode"],
		metadataSource: "cinemeta",
		language: "en",
		streamOrder: ["detail", "app", "web", "recs"],
		enabledStreamButtons: {
			detail: false,
			app: false,
			web: false,
			recs: false,
		},
		includeTmdbCollection: false,
		enableTitleSearching: false,
		places: { ...places.DEFAULT_PLACES },
	};

	const withDefaults = (userConfig) => {
		if (!userConfig || typeof userConfig !== "object") return defaultConfig;
		const merged = {
			...defaultConfig,
			...userConfig,
			apiKeys: { ...defaultConfig.apiKeys, ...(userConfig.apiKeys || {}) },
			places: { ...defaultConfig.places, ...(userConfig.places || {}) },
		};
		// "Use the server's LLM": the address and key come from the server's
		// environment, so they are never written into the install link.
		if (merged.useServerLlm && SERVER_LLM.baseUrl && !merged.apiKeys.llm?.baseUrl) {
			merged.apiKeys = { ...merged.apiKeys, llm: { ...SERVER_LLM, valid: true, fromServer: true } };
		}
		return merged;
	};

	try {
		if (typeof config === "string" && decodeURIComponent(config).trim().startsWith("{")) {
			let userConfig = JSON.parse(decodeURIComponent(config));
			if (ENCRYPTION_KEY_INPUT) {
				userConfig = await decryptData(userConfig);
			}
			// Without ENCRYPTION_KEY the config is stored as plain JSON in the URL
			return withDefaults(userConfig);
		}
	} catch (err) {
		logger.error("Reading config failed", err);
	}

	return defaultConfig;
}

async function generateManifest(apiKeys, combine, catalog_order, userConfig = null) {
	let catalogs = [];
	const types = ["movie", "series"];

	if (combine === true) {
		types.forEach((type) => {
			catalogs.push({
				type: type,
				id: `mlt-combined-${type}-rec`,
				name: `Similar Recommendations`,
				extra: [{ name: "search", isRequired: true }],
			});
		});
	} else {
		catalog_order.forEach((rawSource) => {
			const source = rawSource.toLowerCase().split(" ")[0];
			if (apiKeys?.[source]?.valid) {
				catalogs.push({
					type: "movie",
					id: `mlt-${source}-movie-rec`,
					name: source === "llm" ? "My LLM Recommendations" : `${source} Recommendations`,
					extra: [{ name: "search", isRequired: true }],
				});
			}
		});
		catalog_order.forEach((rawSource) => {
			const source = rawSource.toLowerCase().split(" ")[0];
			if (apiKeys?.[source]?.valid) {
				catalogs.push({
					type: "series",
					id: `mlt-${source}-series-rec`,
					name: source === "llm" ? "My LLM Recommendations" : `${source} Recommendations`,
					extra: [{ name: "search", isRequired: true }],
				});
			}
		});
	}

	const metaPrefixes = ["mlt-"];
	if (userConfig) {
		catalogs = [...places.placesCatalogs(userConfig), ...catalogs];
		const p = places.placesOf(userConfig);
		// Asking for tt pages lets the addon notice a series page being opened.
		// Place the addon below Cinemeta so Cinemeta's page is the one shown.
		if (p.trackSeries && places.anyPlaceOn(userConfig)) metaPrefixes.push("tt");
	}

	const manifest = {
		id: "community.morelikethis",
		version: packageJson.version,
		resources: [
			"catalog",
			"stream",
			{
				name: "meta",
				types: ["movie", "series"],
				idPrefixes: metaPrefixes,
			},
		],
		types: ["movie", "series"],
		name: "More Like This",
		description: "Shows recommendations from various sources",
		logo: "https://i.imgur.com/DHKJ7dT.png",
		idPrefixes: [""],
		behaviorHints: {
			configurable: true,
		},
		catalogs: catalogs,
	};

	return manifest;
}

async function startServer() {
	const app = express();

	// Middle Ware
	app.use(
		cors({
			origin: "*",
			methods: "*",
			allowedHeaders: "*",
		}),
	); // Apply CORS middleware to all routes

	app.use(express.json()); // Middleware to parse JSON bodies

	app.use(express.urlencoded({ extended: true })); // Middleware to parse URL-encoded bodies

	app.use(express.static(path.join(__dirname, "public"))); // Serve static files

	// Main route - redirect to configure
	app.get("/", async function (_, res) {
		res.redirect("/configure");
	});

	app.get("/configure", (req, res) => {
		res.sendFile(path.join(__dirname, "public", "configure.html"));
	});

	app.get("/:userConfig/configure", async (req, res) => {
		try {
			let userConfig = await loadUserConfig(req.params.userConfig);
			// Never send the server's own LLM address or key to the browser
			if (userConfig.apiKeys?.llm?.fromServer) {
				userConfig = { ...userConfig, apiKeys: { ...userConfig.apiKeys, llm: { key: "", valid: false, baseUrl: "", model: "" } } };
			}
			userConfig = encodeURIComponent(JSON.stringify(userConfig));
			res.redirect(`/configure?data=${userConfig}`);
		} catch (error) {
			// If parsing fails, serve the default configure page
			res.redirect("/configure");
		}
	});

	app.get("/manifest.json", async (req, res) => {
		let manifest = await generateManifest({}, false, []); // Default Manifest

		res.json(manifest);
	});

	app.get("/:userConfig/manifest.json", async (req, res) => {
		let manifest = "";
		try {
			const userConfig = await loadUserConfig(req.params.userConfig);
			manifest = await generateManifest(userConfig.apiKeys, userConfig.combineCatalogs, userConfig.catalogOrder, userConfig);
		} catch (err) {
			manifest = await generateManifest({}, false, []); // Default Manifest
		}
		res.json(manifest);
	});

	app.get("/:userConfig/catalog/:type/:id/:extra?.json", async (req, res) => {
		const userConfig = await loadUserConfig(req.params.userConfig);

		// Retreieve and format meta data source
		const metadataSource = {
			source: userConfig.metadataSource === "tmdb" && userConfig.apiKeys.tmdb.valid ? "tmdb" : "cinemeta",
			tmdbApiKey: userConfig.apiKeys.tmdb,
			traktApiKey: userConfig.apiKeys.trakt,
			language: userConfig.language,
			keepEnglishPosters: userConfig.keepEnglishPosters,
		};

		const key = history.installKey(rawConfigSegment(req));
		const placesCatalog = await places.placesCatalogHandler(req.params.type, req.params.id, req.params.extra, userConfig, metadataSource, key);
		if (placesCatalog) {
			res.setHeader("Cache-Control", "no-store");
			return res.json(placesCatalog);
		}

		const catalog = (await catalogHandler(req.params.type, req.params.id, req.params.extra, userConfig, metadataSource)) || [];
		res.json(catalog);
	});

	app.get("/:userConfig/stream/:type/:id.json", async (req, res) => {
		const userConfig = await loadUserConfig(req.params.userConfig);

		// Retreieve and format meta data source
		const metadataSource = {
			source: userConfig.metadataSource === "tmdb" && userConfig.apiKeys.tmdb.valid ? "tmdb" : "cinemeta",
			tmdbApiKey: userConfig.apiKeys.tmdb,
			traktApiKey: userConfig.apiKeys.trakt,
			language: userConfig.language,
			keepEnglishPosters: userConfig.keepEnglishPosters,
		};

		const streams = await streamHandler(req.headers["origin"], req.params.type, req.params.id, userConfig, metadataSource);

		// Remember the title, and add the entry that opens its list in Discover
		const rawId = req.params.id.startsWith("mlt") ? req.params.id.split("-").slice(2).join("-") : req.params.id;
		const imdbId = history.cleanId(rawId);
		if (imdbId && places.anyPlaceOn(userConfig)) {
			history.record(history.installKey(rawConfigSegment(req)), req.params.type, imdbId);
		}
		const p = places.placesOf(userConfig);
		if (imdbId && p.gridButton && places.placesCatalogs(userConfig).some((c) => c.id.startsWith("mlt-picker-"))) {
			const transportUrl = `${baseUrl(req)}/${rawConfigSegment(req)}/manifest.json`;
			streams.streams.unshift(places.gridButton(req.headers["origin"], req.params.type, imdbId, transportUrl));
		}
		res.json(streams);
	});

	app.get("/:userConfig/meta/:type/:id.json", async (req, res) => {
		const userConfig = await loadUserConfig(req.params.userConfig);

		// A plain tt page: only note that it was opened. Cinemeta shows the page.
		if (req.params.id.startsWith("tt")) {
			if (places.anyPlaceOn(userConfig) && places.placesOf(userConfig).trackSeries) {
				history.record(history.installKey(rawConfigSegment(req)), req.params.type, req.params.id);
			}
			return res.status(404).json({ err: "not found" });
		}

		// Retreieve and format meta data source
		const metadataSource = {
			source: userConfig.metadataSource === "tmdb" && userConfig.apiKeys.tmdb.valid ? "tmdb" : "cinemeta",
			tmdbApiKey: userConfig.apiKeys.tmdb,
			traktApiKey: userConfig.apiKeys.trakt,
			language: userConfig.language,
			keepEnglishPosters: userConfig.keepEnglishPosters,
		};

		const meta = await metaHandler(req.params.type, req.params.id, userConfig, metadataSource);
		res.json(meta);
	});

	app.post("/saveConfig", async (req, res) => {
		try {
			// Build API Keys object
			const sources = ["tmdb", "trakt", "tastedive", "gemini", "watchmode", "simkl", "rpdb", "llm"];
			const apiKeys = {};

			for (const source of sources) {
				const key = req.body[`${source}ApiKey`];
				apiKeys[source] = {
					key: key || "",
					valid: Boolean(key),
				};
			}

			// My LLM: an address is what makes it usable; some local servers need no key
			const llmBaseUrl = (req.body.llmBaseUrl || "").trim();
			apiKeys.llm = {
				key: (req.body.llmApiKey || "").trim(),
				baseUrl: llmBaseUrl,
				model: (req.body.llmModel || "").trim(),
				valid: Boolean(llmBaseUrl),
			};

			const metadataSource = req.body.metadataSource || null;

			// Get user config
			const config = {
				apiKeys: apiKeys,
				combineCatalogs: req.body.combineCatalogs === "on" || false,
				catalogOrder: req.body.catalogOrder.split(",") || ["tmdb", "trakt", "simkl", "gemini", "tasteDive", "watchmode"],
				metadataSource: metadataSource,
				language: metadataSource === "tmdb" ? req.body.language || "en" : "en",
				keepEnglishPosters: req.body.keepEnglishPoster === "on" || false,
				streamOrder: req.body.streamOrder.split(",") || ["detail", "app", "web", "recs"],
				enabledStreamButtons: {
					detail: req.body.streamDetailEnabled === "on" || false,
					app: req.body.streamAppEnabled === "on" || false,
					web: req.body.streamWebEnabled === "on" || false,
					recs: req.body.streamRecEnabled === "on" || false,
				},
				includeTmdbCollection: req.body.includeTmdbCollection === "on" || false,
				enableTitleSearching: req.body.enableTitleSearching === "on" || false,
				useServerLlm: req.body.useServerLlm === "on",
				places: {
					homeRows: req.body.placeHomeRows === "on",
					discoverPicker: req.body.placeDiscoverPicker === "on",
					gridButton: req.body.placeGridButton === "on",
					trackSeries: req.body.placeTrackSeries === "on",
				},
			};

			if ((config.useServerLlm || apiKeys.llm.valid) && !config.catalogOrder.includes("llm")) {
				config.catalogOrder.push("llm");
			}

			let userConfig;
			if (ENCRYPTION_KEY_INPUT) {
				const encryptedObject = await encryptData(config);
				userConfig = encodeURIComponent(JSON.stringify(encryptedObject));
			} else {
				userConfig = encodeURIComponent(JSON.stringify(config));
			}

			// Build manifest URL and redirect
			const manifestUrl = `${baseUrl(req)}/${userConfig}/manifest.json`;

			if (req.body.forCopy === "true") {
				return res.json({ manifestUrl });
			}

			return res.redirect(manifestUrl.replace(/^https?:\/\//, "stremio://"));
		} catch (error) {
			res.status(400).send("Error: Something went wrong. Please try again.");
		}
	});

	app.get("/serverLlm", (req, res) => {
		res.json({ available: Boolean(SERVER_LLM.baseUrl), model: SERVER_LLM.model || null });
	});

	app.post("/verifyKey", async (req, res) => {
		try {
			const { source, key, baseUrl, model } = req.body;

			if (!source || (!key && source !== "llm") || (source === "llm" && !baseUrl)) {
				return res.status(400).json({ valid: false, error: source === "llm" ? "Enter the address first" : "Missing source or key" });
			}

			const result = await validateApiKeys({ [source]: key || "" }, { baseUrl, model });
			res.json(result[source]);
		} catch (err) {
			res.status(500).json({ valid: false, error: "Server error during validation" });
		}
	});

	return app;
}

if (require.main === module) {
	startServer().then((app) => app.listen(PORT, () => {}));
}

module.exports = { startServer, loadUserConfig, generateManifest };

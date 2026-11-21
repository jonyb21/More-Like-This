// Remembers the titles each install has opened, newest first.
// One install = one manifest URL. The history is keyed by a hash of the
// config part of that URL, so no account or login is needed.
// Only IMDb ids and types are stored, in one JSON file (HISTORY_FILE).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const logger = require("./logger");

const HISTORY_FILE = process.env.HISTORY_FILE || path.join(__dirname, "..", "data", "history", "history.json");
const MAX_ENTRIES = 20;
const WRITE_DELAY_MS = 2000;

let store = null;
let writeTimer = null;

function load() {
	if (store) return store;
	try {
		store = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
	} catch (err) {
		store = {};
	}
	return store;
}

function scheduleWrite() {
	if (writeTimer) return;
	writeTimer = setTimeout(() => {
		writeTimer = null;
		try {
			fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
			const tmp = HISTORY_FILE + ".tmp";
			fs.writeFileSync(tmp, JSON.stringify(store));
			fs.renameSync(tmp, HISTORY_FILE);
		} catch (err) {
			logger.error("Could not save history", err);
		}
	}, WRITE_DELAY_MS);
	if (writeTimer.unref) writeTimer.unref();
}

function installKey(userConfigSegment) {
	if (!userConfigSegment) return null;
	return crypto.createHash("sha256").update(String(userConfigSegment)).digest("hex").slice(0, 24);
}

// "tt0468569:1:2" -> "tt0468569". Anything that is not an IMDb id is ignored.
function cleanId(id) {
	const imdb = String(id || "")
		.split(":")[0]
		.trim();
	return /^tt\d+$/.test(imdb) ? imdb : null;
}

function record(key, type, id) {
	const imdbId = cleanId(id);
	if (!key || !imdbId || (type !== "movie" && type !== "series")) return false;

	const all = load();
	const list = (all[key] || []).filter((e) => e.id !== imdbId);
	list.unshift({ id: imdbId, type: type, at: Date.now() });
	all[key] = list.slice(0, MAX_ENTRIES);
	scheduleWrite();
	return true;
}

// Newest first. With a type, only titles of that type.
function list(key, type) {
	if (!key) return [];
	const entries = load()[key] || [];
	return type ? entries.filter((e) => e.type === type) : entries.slice();
}

function latest(key) {
	return list(key)[0] || null;
}

// For tests.
function _reset() {
	store = {};
	if (writeTimer) {
		clearTimeout(writeTimer);
		writeTimer = null;
	}
}

module.exports = { installKey, cleanId, record, list, latest, MAX_ENTRIES, _reset };

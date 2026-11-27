import fs from "node:fs";

const source = fs.readFileSync("www/index.html", "utf8");
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("function safeCatalogId(value)"), "Catalog IDs must pass a strict UUID allowlist.");
assert(source.includes("function safeHttpsMediaUrl(value)"), "Catalog media must pass HTTPS URL validation.");
assert(source.includes("function escapeInlineJsString(value)"), "Inline JavaScript arguments must be encoded safely.");
assert(source.includes("const safeId = safeCatalogId(drama?.id)"), "Published drama IDs must be validated before rendering.");
assert(source.includes("Number.isSafeInteger(episodeNumber) && episodeNumber >= 1 && episodeNumber <= 999"),
  "Episode numbers must be finite bounded integers.");
assert(source.includes("Boolean(safeHttpsMediaUrl(ep.video_url))"), "Published video URLs must be HTTPS.");
assert(source.includes("videoUrl: safeHttpsMediaUrl(ep.video_url)"), "Only validated video URLs may reach the player.");
assert(source.includes("posterUrl: safeHttpsMediaUrl(ep.thumbnail_url) || safeCoverUrl"),
  "Poster URLs must be HTTPS or omitted.");
assert(source.includes("setDiscoverGenre(${escapeInlineJsString(g)})"),
  "Genre values must be safely encoded in inline event handlers.");
assert(source.includes("${escapeHtml(g)}</button>"), "Genre labels must be HTML-escaped.");
assert(!source.includes("setDiscoverGenre('${g}')"), "Unsafe raw genre interpolation must not return.");

console.log("PASS: Published catalog IDs, episode numbers, media URLs and genre HTML/JavaScript contexts are validated.");

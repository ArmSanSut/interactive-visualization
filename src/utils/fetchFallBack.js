import { FALLBACK_URLS } from "../../src/data/fallbackUrls.js";

export async function loadFallback(name) {
  const url = FALLBACK_URLS[name];
  if (!url) throw new Error("Invalid fallback name: " + name);

  const res = await fetch(url, {
    mode: "cors",
    cache: "no-store",
  });

  if (!res.ok) throw new Error("Failed to load fallback: " + name);
  return await res.json();
}

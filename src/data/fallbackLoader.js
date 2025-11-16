// src/data/fallbackLoader.js
export async function loadFallback(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Fallback not found: " + url);

    const json = await res.json();
    return json;
  } catch (err) {
    console.error("Fallback load failed:", url, err);
    return null;
  }
}

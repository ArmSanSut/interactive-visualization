// src/data/fallbackUrls.js
const base = import.meta.env.BASE_URL;  
const root = new URL(import.meta.env.BASE_URL, window.location.origin).href;
// base = "/interactive-visualization/" (ตาม vite.config.js)

export const FALLBACK_URLS = {
  all_persons_profiles: `${base}data/all_persons_profiles_fallback.json`,
  combined: `${base}data/combined_fallback.json`,
  compare_person: `${base}data/compare_person_fallback.json`,
  organizations: `${base}data/organizations_fallback.json`,
  voteEvents: `${base}data/voteEvents_fallback.json`,
};

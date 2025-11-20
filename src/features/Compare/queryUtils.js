// src/features/Compare/queryUtils.js
import { FALLBACK_URLS } from "../../data/fallbackUrls";

const API_URL = "https://politigraph.wevis.info/graphql";

/* ============================================
   Generic fetch wrapper WITH fallback
   ============================================ */
async function safeGraphQLFetch(query, variables, fallbackFn) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      console.error("[API ERROR]", res.status, res.statusText);
      return fallbackFn();
    }

    const json = await res.json();

    if (json.errors) {
      console.error("[GRAPHQL ERROR]", json.errors);
      return fallbackFn();
    }

    return json.data;
  } catch (err) {
    console.error("[NETWORK ERROR]", err);
    return fallbackFn();
  }
}

/* ============================================
   ACTUAL GraphQL Queries
   ============================================ */

const QUERY_COMPARE = `
query CompareAWithEveryoneByEvent($whereA: PersonWhere!, $voteFilter: VoteWhere!) {
  events: voteEvents(
    where: { votes_SOME: { voters_SOME: $whereA, AND: [ $voteFilter ] } }
    sort: [{ start_date: ASC }]
  ) {
    id title start_date
    A: votes(where: { voters_SOME: $whereA, AND: [ $voteFilter ] }) {
      id option voter_party voters(where: $whereA, limit: 1) { firstname lastname image }
    }
    B: votes(where: { voters_NONE: $whereA, AND: [ $voteFilter ] }, limit: 2000) {
      id option voter_party voters(limit: 1) { firstname lastname image }
    }
  }
}
`;

const QUERY_PROFILES = `
query AllPersonsProfiles {
  people(sort: [{ firstname: ASC }, { lastname: ASC }], limit: 2000) {
    id firstname lastname name image
    memberships {
      id province start_date end_date
      posts {
        role label
        organizations { id name name_en classification image }
      }
    }
  }
}
`;

const QUERY_ORGS = `
query Organizations {
  organizations { name image }
}
`;

/* ============================================
   FIXED FALLBACK-FRIENDLY Functions
   ============================================ */

export async function fetchCompareEvents(firstname, lastname) {
  const whereA = {
    firstname_CONTAINS: firstname || "",
    lastname_CONTAINS: lastname || "",
  };

  const voteFilter = {};

  return safeGraphQLFetch(
    QUERY_COMPARE,
    { whereA, voteFilter },
    async () => {
      // fallback JSON -> unwrap .data
      const raw = await fetch(FALLBACK_URLS.compare_person).then((r) => r.json());
      return raw.data; // IMPORTANT!
    }
  );
}

export async function fetchProfiles() {
  return safeGraphQLFetch(
    QUERY_PROFILES,
    {},
    async () => {
      // fallback JSON -> unwrap .data
      const raw = await fetch(FALLBACK_URLS.all_persons_profiles).then((r) =>
        r.json()
      );
      return raw.data; // IMPORTANT!
    }
  );
}

export async function fetchOrganizations() {
  return safeGraphQLFetch(
    QUERY_ORGS,
    {},
    async () => {
      // fallback JSON -> unwrap .data
      const raw = await fetch(FALLBACK_URLS.organizations).then((r) => r.json());
      return raw.data; // IMPORTANT!
    }
  );
}

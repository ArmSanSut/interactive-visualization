import { useEffect, useState } from "react";

const ENDPOINTS = [
  "https://thingproxy.freeboard.io/fetch/https://politigraph.wevis.info/graphql",
  "https://corsproxy.io/?https://politigraph.wevis.info/graphql",
  "https://cors.isomorphic-git.org/https://politigraph.wevis.info/graphql",
  "https://politigraph.wevis.info/graphql"
];

const QUERY = `
query CompareVotes($name: String!) {
  votes(where: { voter_name: $name }) {
    id
    option
    voter_name
    voter_party
    event {
      id
      title
      start_date
      end_date
    }
  }
}
`;

function fetchWithTimeout(url, options = {}, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout")), timeout);
    fetch(url, options)
      .then(res => { clearTimeout(t); resolve(res); })
      .catch(err => { clearTimeout(t); reject(err); });
  });
}

export default function usePolitigraphFetcher(fullName) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!fullName) return;

    async function load() {
      setLoading(true);
      setError(null);

      const body = JSON.stringify({
        query: QUERY,
        variables: { name: fullName }
      });

      let final = null;

      for (const endpoint of ENDPOINTS) {
        const attempts = [
          { url: endpoint, cfg: { method: "POST", headers: {"Content-Type":"application/json"}, body }, label: "POST" },
          { url: endpoint + "?query=" + encodeURIComponent(QUERY), cfg: { method: "GET" }, label: "GET" }
        ];

        for (const a of attempts) {
          try {
            const res = await fetchWithTimeout(a.url, a.cfg, 3000);
            const txt = await res.text();
            if (res.status >= 500) throw new Error("Server 5xx");

            const json = JSON.parse(txt);
            if (json.data) {
              final = json.data;
              setSource(a.url + " (" + a.label + ")");
              break;
            }
          } catch (err) {
            console.warn("FAIL:", a.url, err.message);
          }
        }

        if (final) break;
      }

      // fallback JSON
      if (!final) {
        try {
          const fb = await fetch("/fallback/compare-fallback.json");
          const json = await fb.json();
          final = json.data;
          setSource("fallback JSON");
        } catch (err) {
          setError("All endpoints + fallback failed");
        }
      }

      setData(final);
      setLoading(false);
    }

    load();
  }, [fullName]);

  return { data, loading, error, source };
}

// src/features/VisMain.jsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useTransition,
} from "react";
import { useNavigate } from "react-router-dom";
import * as d3 from "d3";
import {
  PARTY_COLOR,
  partyColor,
  normalizePartyName,
} from "../utils/partyMapping.js";
import {
  titleSimilarity,
  sameOrCloseDate,
  normalizeThaiLawTitle,
} from "../utils/textSimilarity.js";
import { classifyVote, isValidName } from "../utils/voteHelpers.js";
import GeoPoliticalViewer from "./GeoPoliticalViewer.jsx";
import CompareModal from "./Compare/CompareModal.jsx";
import { FALLBACK_URLS } from "../data/fallbackUrls.js";
import { loadFallback } from "../data/fallbackLoader.js";

// ----- ENDPOINTS + QUERY -----
const ENDPOINTS = [
  "https://corsproxy.io/?https://politigraph.wevis.info/graphql",
];

const GQL_QUERY = `query CombinedQuery {
  voteEvents {
    id title start_date end_date
    votes { id option voter_name voter_party }
  }
  billEnforceEvents {
    title start_date end_date
  }
}`;

function fetchWithTimeout(url, opts = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error("timeout @ " + url)),
      timeoutMs
    );
    fetch(url, opts)
      .then((r) => {
        clearTimeout(id);
        resolve(r);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

export default function VisMain() {
  // ----- Refs -----
  const svgRef = useRef(null);
  const partyLegendRef = useRef(null);
  const miniGraphsRef = useRef(null);
  const tooltipRef = useRef(null);
  const firstRender = useRef(true);
  const userClickedVE = useRef(false);

  // Router
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const navigatingRef = useRef(false); // guard multiple navigations

  // ----- State -----
  const [status, setStatus] = useState("⏳ Loading from GraphQL …");
  const [billList, setBillList] = useState(null);
  const [billToVotes, setBillToVotes] = useState(null);
  const [rawMatchedVEs, setRawMatchedVEs] = useState(null);
  const [lastProxy, setLastProxy] = useState(null);
  const [mpPartyCanon, setMpPartyCanon] = useState(new Map());

  const [dateStart, setDateStart] = useState("2024-01-01");
  const [dateEnd, setDateEnd] = useState("");
  const [selectedBill, setSelectedBill] = useState("");
  const [partyFilter, setPartyFilter] = useState([]);
  const [mpFilter, setMpFilter] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  // GeoModal
  const [showGeoModal, setShowGeoModal] = useState(false);
  const [geoEvent, setGeoEvent] = useState(null);
  // Compare Modal
  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedMP, setSelectedMP] = useState(null);

  // Canonical party lookup (stable)
  const canonicalPartyFor = useCallback(
    (name, rawParty) => {
      if (isValidName(name) && mpPartyCanon.has(name))
        return mpPartyCanon.get(name);
      return normalizePartyName(rawParty);
    },
    [mpPartyCanon]
  );

  function openGeoModal(ev) {
    setGeoEvent(ev || null);
    setShowGeoModal(true);
    document.documentElement.style.overflow = "hidden";
  }
  function closeGeoModal() {
    setShowGeoModal(false);
    setGeoEvent(null);
    document.documentElement.style.overflow = "";
  }

  const openCompareModal = useCallback((mpNode) => {
    if (!mpNode || !mpNode.name) return;

    const [firstname, lastname] = (mpNode.name || "").split(" ");

    setSelectedMP({
      firstname,
      lastname,
      fullName: `${firstname} ${lastname}`,
    });

    setCompareOpen(true);
  }, []);

  // ---- ROUTING from circle click (stable callback) ----
  const navigateToInteraction = useCallback(
    (veId) => {
      if (!veId || navigatingRef.current) return;
      navigatingRef.current = true; // guard against double clicks in D3
      queueMicrotask(() => {
        startTransition(() => {
          navigate(`/interaction/${veId}`);
          navigatingRef.current = false;
        });
      });
    },
    [navigate, startTransition]
  );

  // ---- Vote color mapping (stable) ----
  const VOTE_COLOR = useCallback((v) => {
    const styles = getComputedStyle(document.documentElement);
    return v === "yes"
      ? styles.getPropertyValue("--yes").trim() || "#2ca02c"
      : v === "no"
      ? styles.getPropertyValue("--no").trim() || "#d62728"
      : styles.getPropertyValue("--oth") || "#999";
  }, []);

  // ---- Mini radial drawer (uses refs directly) ----
  const drawMiniRadial = useCallback(
    (list) => {
      if (!miniGraphsRef.current) return;
      const container = d3.select(miniGraphsRef.current);
      const tip = d3.select(tooltipRef.current);
      container.html("");

      const ves = [...list].sort((a, b) => {
        const da = a.end_date
          ? new Date(a.end_date)
          : a.start_date
          ? new Date(a.start_date)
          : new Date(0);
        const db = b.end_date
          ? new Date(b.end_date)
          : b.start_date
          ? new Date(b.start_date)
          : new Date(0);
        return db - da;
      });

      ves.forEach((ev) => {
        const card = container
          .append("div")
          .attr("class", "card-vismain")
          .attr("tabindex", 0)
          .style("cursor", "pointer")
          .on("click", () => openGeoModal(ev))
          .on("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openGeoModal(ev);
            }
          });

        card.append("div").attr("class", "title").text(ev.title);

        const w = 560;
        const h = 460;
        const cx = w / 2;
        const cy = h / 2;

        const svg2 = card
          .append("svg")
          .attr("width", w)
          .attr("height", h)
          .style("background", "#fff")
          .style("display", "block")
          .style("overflow", "visible");

        svg2
          .append("rect")
          .attr("x", 0)
          .attr("y", 0)
          .attr("width", w)
          .attr("height", h)
          .attr("fill", "#fff")
          .attr("stroke", "#eee")
          .attr("stroke-width", 1);

        const root2 = svg2
          .append("g")
          .attr("transform", `translate(${cx},${cy})`);
        const layerLinks = root2.append("g");
        const layerNodes = root2.append("g");

        const mps = [];
        (ev.votes || []).forEach((v) => {
          if (!isValidName(v.voter_name)) return;
          const p = canonicalPartyFor(v.voter_name, v.voter_party);
          const t = classifyVote(v.option);
          mps.push({ name: v.voter_name, party: p, type: t });
        });

        const R = 190;
        const mpNodes = mps.map((m, i) => {
          const ang = -Math.PI + (i / Math.max(1, mps.length)) * 2 * Math.PI;
          return {
            id: `M:${m.name}#VE:${ev.id}`,
            name: m.name,
            party: m.party,
            type: m.type,
            x: R * Math.cos(ang),
            y: R * Math.sin(ang),
          };
        });

        const mpLinks = mpNodes.map((m) => ({
          source: { x: 0, y: 0 },
          target: m,
          type: m.type,
        }));

        layerLinks
          .selectAll("line")
          .data(mpLinks)
          .join("line")
          .attr("x1", 0)
          .attr("y1", 0)
          .attr("x2", (d) => d.target.x)
          .attr("y2", (d) => d.target.y)
          .attr("stroke", (d) => VOTE_COLOR(d.type))
          .attr("stroke-width", 1.1)
          .attr("stroke-opacity", 0.9);

        layerNodes
          .append("g")
          .attr("transform", "translate(0,0)")
          .append("circle")
          .attr("r", 8.8)
          .attr("fill", "#555");

        const gMP = layerNodes
          .selectAll("g.mp")
          .data(mpNodes)
          .join("g")
          .attr("class", "mp")
          .attr("transform", (d) => `translate(${d.x},${d.y})`);

        gMP
          .append("circle")
          .attr("r", 5)
          .attr("fill", (d) => partyColor(d.party))
          .attr("stroke", "#fff")
          .attr("stroke-width", 0.9);

        gMP
          .on("mouseover", (e, d) => {
            tip
              .html(
                `<b>ส.ส.</b> ${d.name}<br>` +
                  `พรรค: ${d.party}<br>` +
                  `โหวต: ${
                    d.type === "yes"
                      ? "เห็นชอบ"
                      : d.type === "no"
                      ? "ไม่เห็นชอบ"
                      : "อื่น ๆ"
                  }`
              )
              .style("left", e.clientX + 12 + "px")
              .style("top", e.clientY - 12 + "px")
              .style("visibility", "visible");
          })
          .on("mousemove", (e) =>
            tip
              .style("left", e.clientX + 12 + "px")
              .style("top", e.clientY - 12 + "px")
          )
          .on("mouseout", () => tip.style("visibility", "hidden"));
      });
    },
    [miniGraphsRef, tooltipRef, canonicalPartyFor, VOTE_COLOR]
  );

  // ============================================================================
  // Load data (fallback-first)
  // ============================================================================
  useEffect(() => {
    let alive = true;

    async function run() {
      setStatus("⏳ Loading (FAST MODE: fallback first)…");

      const fb = await loadFallback(FALLBACK_URLS.combined);

      if (!fb || !fb.data) {
        setStatus("❌ Failed: fallback JSON not found");
        return;
      }

      const okData = fb.data;
      const ve = okData.voteEvents || [];
      const be = okData.billEnforceEvents || [];

      if (!alive) return;

      // --- Normalize enforced bills ---
      const enforced = [];
      const seenKey = new Set();
      be.forEach((b) => {
        const key =
          normalizeThaiLawTitle(b.title || "") + "|" + (b.end_date || "");
        if (b.title && !seenKey.has(key)) {
          seenKey.add(key);
          enforced.push({
            title: String(b.title).trim(),
            start_date: b.start_date || null,
            end_date: b.end_date || null,
          });
        }
      });

      // --- Match vote events to enforced bills ---
      const map = new Map();
      enforced.forEach((b) => map.set(b.title, []));
      const matched = [];

      for (const v of ve) {
        let bestBill = null;
        let bestScore = 0;

        for (const b of enforced) {
          const sim = titleSimilarity(b.title, v.title);
          let score = sim;
          if (
            sameOrCloseDate(b.end_date, v.end_date, 7) ||
            sameOrCloseDate(b.start_date, v.end_date, 7)
          )
            score += 0.03;

          if (score > bestScore) {
            bestScore = score;
            bestBill = b;
          }
        }

        if (bestBill && bestScore >= 0.75) {
          map.get(bestBill.title).push(v);
          matched.push(v);
        }
      }

      // --- Canonical party per MP ---
      const counter = new Map();
      matched.forEach((ev) => {
        (ev.votes || []).forEach((v) => {
          if (!isValidName(v.voter_name)) return;
          const nm = v.voter_name.trim();
          const p = normalizePartyName(v.voter_party);
          if (!counter.has(nm)) counter.set(nm, new Map());
          const m = counter.get(nm);
          m.set(p, (m.get(p) || 0) + 1);
        });
      });

      const canon = new Map();
      counter.forEach((m, name) => {
        let best = "อื่นๆ";
        let b = -1;
        m.forEach((c, p) => {
          if (c > b) {
            b = c;
            best = p;
          }
        });
        canon.set(name, best);
      });

      if (!alive) return;
      setBillList(enforced);
      setBillToVotes(map);
      setRawMatchedVEs(matched);
      setMpPartyCanon(canon);

      setLastProxy("local fallback (FAST MODE)");
      setStatus(
        `✅ Loaded (FAST MODE) enforced=${enforced.length}, matched=${matched.length}`
      );

      // auto-select first bill
      if (enforced.length && !selectedBill) {
        setSelectedBill(enforced[0].title);
        setRefreshKey((k) => k + 1);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [refreshKey, selectedBill]);

  // ============================================================================
  // Derived Filters
  // ============================================================================
  const inRangeBills = useMemo(() => {
    if (!billList) return [];
    const ds = dateStart || "1900-01-01";
    const de = dateEnd || "9999-12-31";
    const parseEnd = (e) => (e.end_date ? new Date(e.end_date) : new Date(0));
    return billList
      .filter((e) => {
        const d = parseEnd(e);
        return d >= new Date(ds) && d <= new Date(de);
      })
      .sort((a, b) => new Date(b.end_date || 0) - new Date(a.end_date || 0));
  }, [billList, dateStart, dateEnd]);

  const filteredBillOptions = useMemo(() => {
    const q = searchText.toLowerCase();
    return inRangeBills.filter((b) => b.title.toLowerCase().includes(q));
  }, [inRangeBills, searchText]);

  const eventsForBill = useMemo(() => {
    if (!selectedBill || !billToVotes) return [];
    const all = billToVotes.get(selectedBill) || [];
    return all.map((ev) => {
      const votes = (ev.votes || []).filter((v) => {
        const party = normalizePartyName(v.voter_party);
        const okParty = !partyFilter.length || partyFilter.includes(party);
        const okMP = !mpFilter.length || mpFilter.includes(v.voter_name);
        return okParty && okMP;
      });
      return { ...ev, votes };
    });
  }, [selectedBill, billToVotes, partyFilter, mpFilter]);

  const partyOptions = useMemo(() => {
    const s = new Set();
    eventsForBill.forEach((ev) =>
      ev.votes.forEach((v) => s.add(normalizePartyName(v.voter_party)))
    );
    return Array.from(s).sort();
  }, [eventsForBill]);

  const mpOptions = useMemo(() => {
    const s = new Set();
    eventsForBill.forEach((ev) =>
      ev.votes.forEach((v) => {
        if (isValidName(v.voter_name)) s.add(v.voter_name);
      })
    );
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [eventsForBill]);

  useEffect(() => {
    if (filteredBillOptions.length > 0) {
      const exists = filteredBillOptions.some((b) => b.title === selectedBill);
      if (!exists && filteredBillOptions.length > 0) {
        setSelectedBill(filteredBillOptions[0].title);
        setRefreshKey((k) => k + 1);
      }
    }
  }, [filteredBillOptions, selectedBill]);

  // ============================================================================
  // Main D3 rendering
  // ============================================================================
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const tip = d3.select(tooltipRef.current);
    svg.selectAll("*").remove();

    const container = svgRef.current.parentNode;
    const W = container.getBoundingClientRect().width;
    const H =
      container.getBoundingClientRect().height ||
      Math.round(window.innerHeight * 0.7);

    svg.attr("width", W).attr("height", H);

    // background (click-to-clear focus)
    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", W)
      .attr("height", H)
      .attr("fill", "#fff")
      .on("click", clearFocus);

    const root = svg.append("g").attr("class", "root");
    const layerEN = root.append("g").attr("class", "layer-enforced");
    const layerVE = root.append("g").attr("class", "layer-ve");
    const layerVP = root.append("g").attr("class", "layer-ve-party");
    const layerVM = root.append("g").attr("class", "layer-ve-mp");
    const layerNode = root.append("g").attr("class", "layer-nodes");

    // Center point shifted to the left
    const cx = W * 0.35;
    const cy = H / 2;

    const CENTER_X = cx;
    const CENTER_Y = cy;

    const orderVote = { yes: 0, no: 1, other: 2 };

    // Aggregations
    const partyAggByVE = new Map();
    const mpByVE = new Map();

    eventsForBill.forEach((ev) => {
      const veId = "VE:" + ev.id;
      const pmap = partyAggByVE.get(veId) || new Map();
      const mpList = mpByVE.get(veId) || [];
      (ev.votes || []).forEach((v) => {
        const party = normalizePartyName(v.voter_party);
        const vt = classifyVote(v.option);
        const c = pmap.get(party) || {
          yes: 0,
          no: 0,
          other: 0,
          total: 0,
          mpSet: new Set(),
        };
        c[vt] = (c[vt] || 0) + 1;
        c.total++;
        if (isValidName(v.voter_name)) c.mpSet.add(v.voter_name);
        pmap.set(party, c);
        if (isValidName(v.voter_name))
          mpList.push({ name: v.voter_name, party, type: vt });
      });
      mpList.sort(
        (a, b) =>
          a.party.localeCompare(b.party) ||
          orderVote[a.type] - orderVote[b.type]
      );
      partyAggByVE.set(veId, pmap);
      mpByVE.set(veId, mpList);
    });

    // Nodes & links
    const enforcedNode = {
      id: "ENFORCED:CENTER",
      group: "enforced",
      label: selectedBill || "Enforced Bill",
      x: cx,
      y: cy,
    };

    const BASE_R_VE = Math.min(W, H) * 0.2;
    const LAYER_STEP = 14;
    const LAYER_WOBBLE = 8;

    const veNodes = eventsForBill.map((ev, i) => {
      const n = Math.max(1, eventsForBill.length);
      const ang = -Math.PI + (i / n) * 2 * Math.PI;
      const r =
        BASE_R_VE +
        i * LAYER_STEP +
        (i % 2 === 0 ? +LAYER_WOBBLE : -LAYER_WOBBLE);
      const x = cx + r * Math.cos(ang);
      const y = cy + r * Math.sin(ang);
      return {
        id: "VE:" + ev.id,
        group: "ve",
        label: ev.title,
        ang,
        rad: r,
        x,
        y,
        homeX: x,
        homeY: y,
      };
    });

    const PARTY_GAP = 150;
    const partyNodes = [];
    const links_ve_party = [];

    veNodes.forEach((veNode, idxVE) => {
      const pmap = partyAggByVE.get(veNode.id) || new Map();
      const parties = Array.from(pmap.keys()).sort((a, b) =>
        a.localeCompare(b)
      );
      const spread = Math.PI / Math.max(6, parties.length);
      const start = veNode.ang - (spread * (parties.length - 1)) / 2;
      const R_P_BASE = veNode.rad + PARTY_GAP + ((idxVE % 3) - 1) * 10;
      const rScale = d3
        .scaleSqrt()
        .domain([1, d3.max(parties, (p) => pmap.get(p)?.mpSet?.size || 1) || 1])
        .range([7, 18]);

      parties.forEach((p, idx) => {
        const ang = start + idx * spread + (idx % 2 ? 0.03 : -0.03);
        const r = rScale(Math.max(1, pmap.get(p)?.mpSet?.size || 1));
        const x = cx + R_P_BASE * Math.cos(ang);
        const y = cy + R_P_BASE * Math.sin(ang);
        const nodeId = `P:${p}#${veNode.id}`;
        const pn = {
          id: nodeId,
          raw: p,
          ve: veNode.id,
          group: "party",
          label: p,
          r,
          angParty: ang,
          x,
          y,
          homeX: x,
          homeY: y,
        };
        partyNodes.push(pn);
        links_ve_party.push({
          source: veNode,
          target: pn,
          c: pmap.get(p),
          kind: "vp",
        });
      });
    });

    const links_en_ve = veNodes.map((v) => ({
      source: enforcedNode,
      target: v,
      color: "gold",
      kind: "enve",
    }));

    // Draw links
    const gENVE = layerEN
      .selectAll("line.enve")
      .data(links_en_ve)
      .join("line")
      .attr("class", "enve")
      .attr("stroke", "var(--gold)")
      .attr("stroke-width", 2.5)
      .attr("stroke-opacity", 0.95)
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    const pwScale = d3
      .scaleSqrt()
      .domain([1, d3.max(links_ve_party, (l) => l.c?.total || 1) || 1])
      .range([1.6, 7]);

    const gVP = layerVP
      .selectAll("line.vp")
      .data(links_ve_party)
      .join("line")
      .attr("class", "vp")
      .attr("stroke", (d) => dominantToneColor(d.c))
      .attr("stroke-width", (d) => pwScale(d.c?.total || 1))
      .attr("stroke-opacity", 1)
      .attr("shape-rendering", "crispEdges")
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    // Draw nodes
    const gEN = layerNode
      .append("g")
      .attr("class", "enforced")
      .attr("transform", `translate(${enforcedNode.x},${enforcedNode.y})`);
    gEN
      .append("circle")
      .attr("r", 11.5)
      .attr("fill", "var(--gold)")
      .attr("class", "enforced-glow");
    gEN
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", -16)
      .style("font-size", "12px")
      .text(enforcedNode.label);

    const gVE = layerVE
      .selectAll("g.ve")
      .data(veNodes)
      .join("g")
      .attr("class", "ve")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer");

    gVE.append("circle").attr("r", 9).attr("fill", "#555");

    const gParty = layerNode
      .selectAll("g.party")
      .data(partyNodes)
      .join("g")
      .attr("class", "party")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer")
      .on("click", (e, d) => {
        e.stopPropagation();
        toggleFocusParty(d);
      });

    gParty
      .append("rect")
      .attr("x", (d) => -d.r)
      .attr("y", (d) => -d.r)
      .attr("width", (d) => d.r * 2)
      .attr("height", (d) => d.r * 2)
      .attr("rx", 3)
      .attr("fill", (d) => partyColor(d.raw));

    gParty
      .on("mouseover", (e, d) => {
        const pmap = partyAggByVE.get(d.ve) || new Map();
        const c = pmap.get(d.raw) || {
          yes: 0,
          no: 0,
          other: 0,
          mpSet: new Set(),
        };
        tip
          .html(
            `<b>พรรค</b> ${d.raw}\nVE: ${d.ve.replace("VE:", "")}\nส.ส.: ${
              c.mpSet.size || 0
            }\nเห็นชอบ: ${c.yes || 0} • ไม่เห็นชอบ: ${c.no || 0} • อื่นๆ: ${
              c.other || 0
            }`
          )
          .style("left", e.clientX + 12 + "px")
          .style("top", e.clientY - 12 + "px")
          .style("visibility", "visible");
      })
      .on("mousemove", (e) =>
        tip
          .style("left", e.clientX + 12 + "px")
          .style("top", e.clientY - 12 + "px")
      )
      .on("mouseout", () => tip.style("visibility", "hidden"));

    // --- Tooltips + CLICK → ROUTE on VE circles ---
    gVE
      .on("mouseover", (e, d) => {
        const ev = eventsForBill.find((x) => "VE:" + x.id === d.id);
        if (!ev) return;
        const when = ev?.end_date || ev?.start_date || "";
        let yes = 0;
        let no = 0;
        let oth = 0;
        let total = 0;
        (ev.votes || []).forEach((v) => {
          const vt = classifyVote(v.option);
          if (vt === "yes") yes++;
          else if (vt === "no") no++;
          else oth++;
          total++;
        });
        tip
          .html(
            `<b>Vote Event:</b> ${d.label}<br>วันที่: ${when}<br><br>` +
              `<span style="color:var(--yes)">เห็นชอบ:</span> ${yes.toLocaleString()}<br>` +
              `<span style="color:var(--no)">ไม่เห็นชอบ:</span> ${no.toLocaleString()}<br>` +
              `<span style="color:var(--oth)">อื่น ๆ:</span> ${oth.toLocaleString()}<br>` +
              `<b>รวมทั้งหมด:</b> ${total.toLocaleString()}`
          )
          .style("left", e.clientX + 12 + "px")
          .style("top", e.clientY - 12 + "px")
          .style("visibility", "visible");
      })
      .on("mousemove", (e) =>
        tip
          .style("left", e.clientX + 12 + "px")
          .style("top", e.clientY - 12 + "px")
      )
      .on("mouseout", () => tip.style("visibility", "hidden"))
      .on("dblclick", (e, d) => {
        e.stopPropagation();
        const ev = eventsForBill.find((x) => "VE:" + x.id === d.id);
        if (!ev) return;
        navigateToInteraction(ev.id);
      });

    // Focus state & helpers
    let FOCUS = null;
    let mpSim = null;

    function clearFocus() {
      if (FOCUS && FOCUS.mode === "party") {
        const pn = partyNodes.find(
          (p) => p.raw === FOCUS.party && p.ve === FOCUS.veId
        );
        if (pn) {
          gParty
            .filter((d) => d.id === pn.id)
            .transition()
            .duration(500)
            .ease(d3.easeCubicOut)
            .attr("transform", `translate(${pn.homeX},${pn.homeY})`);

          gVP
            .filter((l) => l.target.id === pn.id)
            .transition()
            .duration(500)
            .ease(d3.easeCubicOut)
            .attr("x2", pn.homeX)
            .attr("y2", pn.homeY);

          pn.x = pn.homeX;
          pn.y = pn.homeY;
        }
      }

      FOCUS = null;
      if (mpSim) {
        mpSim.stop();
        mpSim = null;
      }
      layerVM.selectAll("*").remove();
      gEN.classed("faded", false);
      gVE.classed("faded", false);
      gParty.classed("faded", false);
      gParty.classed("focused", false);
      gVP.classed("faded", false);
      gENVE.classed("faded", false);

      // redraw mini-radial for current filtered VE list
      drawMiniRadial(eventsForBill);
    }

    function toggleFocusVE(veNode) {
      // only when user actually clicked VE
      if (!userClickedVE.current) return;

      if (FOCUS && FOCUS.mode === "ve" && FOCUS.veId === veNode.id) {
        clearFocus();
        userClickedVE.current = false;
        return;
      }
      FOCUS = { mode: "ve", veId: veNode.id };

      gEN.classed("faded", true);
      gVE.classed("faded", (d) => d.id !== veNode.id);
      gParty.classed("faded", (d) => d.ve !== veNode.id);
      gVP.classed("faded", (l) => l.source.id !== veNode.id);
      gENVE.classed("faded", (l) => l.target.id !== veNode.id);

      if (mpSim) {
        mpSim.stop();
        mpSim = null;
      }
      layerVM.selectAll("*").remove();

      const evID = veNode.id.replace("VE:", "");
      const selectedEvent = eventsForBill.find((e) => String(e.id) === evID);
      if (selectedEvent) drawMiniRadial([selectedEvent]);

      userClickedVE.current = false;
    }

    function toggleFocusParty(pn) {
      if (
        FOCUS &&
        FOCUS.mode === "party" &&
        FOCUS.party === pn.raw &&
        FOCUS.veId === pn.ve
      ) {
        clearFocus();
        gParty
          .filter((d) => d.id === pn.id)
          .transition()
          .duration(500)
          .ease(d3.easeCubicOut)
          .attr("transform", (d) => `translate(${d.homeX},${d.homeY})`);
        return;
      }

      FOCUS = {
        mode: "party",
        veId: pn.ve,
        party: pn.raw,
        x: CENTER_X,
        y: CENTER_Y,
        originalX: pn.x,
        originalY: pn.y,
      };

      gEN.classed("faded", true);
      gVE.classed("faded", (d) => d.id !== pn.ve);
      gParty.classed("faded", (d) => !(d.id === pn.id));
      gParty.classed("focused", (d) => d.id === pn.id);
      gVP.classed(
        "faded",
        (l) => l.source.id !== pn.ve || l.target.id !== pn.id
      );
      gENVE.classed("faded", true);

      gParty
        .filter((d) => d.id === pn.id)
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .attr("transform", `translate(${CENTER_X},${CENTER_Y})`)
        .on("end", () => {
          pn.x = CENTER_X;
          pn.y = CENTER_Y;
        });

      gVP
        .filter((l) => l.target.id === pn.id)
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .attr("x2", CENTER_X)
        .attr("y2", CENTER_Y);

      layerVM.selectAll("*").remove();

      setTimeout(() => {
        updateMPPositions({ ...pn, x: CENTER_X, y: CENTER_Y });
      }, 300);
    }

    function enablePartyDrag() {
      const drag = d3
        .drag()
        .on("start", function (ev, d) {
          d3.select(this).style("cursor", "grabbing");
          d._dragStart = { x: d.x, y: d.y };
        })
        .on("drag", function (ev, d) {
          d.x = ev.x;
          d.y = ev.y;
          d3.select(this).attr("transform", `translate(${d.x},${d.y})`);
          layerVP
            .selectAll("line.vp")
            .filter((l) => l.target && l.target.id === d.id)
            .attr("x2", d.x)
            .attr("y2", d.y);
          if (
            FOCUS &&
            FOCUS.mode === "party" &&
            FOCUS.party === d.raw &&
            FOCUS.veId === d.ve &&
            mpSim
          ) {
            mpSim.force("center", d3.forceCenter(d.x, d.y));
            mpSim.force("radial", d3.forceRadial(85, d.x, d.y).strength(0.18));
            mpSim.alpha(0.5).restart();
          }
        })
        .on("end", function (ev, d) {
          d3.select(this).style("cursor", "pointer");

          const targetX =
            FOCUS &&
            FOCUS.mode === "party" &&
            FOCUS.party === d.raw &&
            FOCUS.veId === d.ve
              ? CENTER_X
              : d.homeX;
          const targetY =
            FOCUS &&
            FOCUS.mode === "party" &&
            FOCUS.party === d.raw &&
            FOCUS.veId === d.ve
              ? CENTER_Y
              : d.homeY;

          const x0 = d.x;
          const y0 = d.y;

          const sel = d3.select(this);
          sel
            .transition()
            .duration(700)
            .ease(d3.easeElasticOut)
            .tween("return", () => (t) => {
              d.x = x0 + (targetX - x0) * t;
              d.y = y0 + (targetY - y0) * t;
              sel.attr("transform", `translate(${d.x},${d.y})`);
              layerVP
                .selectAll("line.vp")
                .filter((l) => l.target && l.target.id === d.id)
                .attr("x2", d.x)
                .attr("y2", d.y);
              if (
                FOCUS &&
                FOCUS.mode === "party" &&
                FOCUS.party === d.raw &&
                FOCUS.veId === d.ve &&
                mpSim
              ) {
                mpSim.force("center", d3.forceCenter(d.x, d.y));
                mpSim.force(
                  "radial",
                  d3.forceRadial(85, d.x, d.y).strength(0.18)
                );
                mpSim.alpha(0.25).restart();
              }
            });
        });
      gParty.call(drag);
    }

    function updateMPPositions(pn) {
      const mpList = (mpByVE.get(pn.ve) || []).filter(
        (m) => m.party === pn.raw
      );

      const cx = pn.x;
      const cy = pn.y;

      const total = mpList.length;
      const BASE = 80; 
      const SCALE = 2.1; 
      const R = BASE + total * SCALE;

      const jitter = 5;
      const startRot = (pn.raw.charCodeAt(0) % 360) * (Math.PI / 180);

      const nodes = mpList.map((m, i) => {
        const ang = startRot + (i / total) * 2 * Math.PI;

        const radius = R + (Math.random() * jitter * 2 - jitter);

        const x = cx + radius * Math.cos(ang);
        const y = cy + radius * Math.sin(ang);

        return {
          id: `M:${m.name}#${pn.ve}`,
          name: m.name,
          party: m.party,
          type: m.type,
          x,
          y,
          ang,
        };
      });

      const links = nodes.map((n) => ({
        source: { x: pn.x, y: pn.y },
        target: n,
        type: n.type,
      }));

      layerVM.selectAll("*").remove();

      layerVM
        .append("g")
        .attr("class", "mp-links")
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke", (d) => VOTE_COLOR(d.type))
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.9)
        .attr("x1", pn.x)
        .attr("y1", pn.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      layerVM
        .append("g")
        .attr("class", "mp-nodes")
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", 11)
        .attr("fill", (d) => partyColor(d.party))
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .style("cursor", "pointer")
        .attr("cx", (d) => d.x)
        .attr("cy", (d) => d.y)
        .on("click", (e, d) => {
          e.stopPropagation();
          openCompareModal(d);
        })
        .on("mouseover", (e, d) => {
          tip
            .html(
              `<b>ส.ส.</b> ${d.name}<br>` +
                `พรรค: ${d.party}<br>` +
                `โหวต: ${
                  d.type === "yes"
                    ? "เห็นชอบ"
                    : d.type === "no"
                    ? "ไม่เห็นชอบ"
                    : "อื่น ๆ"
                }`
            )
            .style("left", e.clientX + 12 + "px")
            .style("top", e.clientY - 12 + "px")
            .style("visibility", "visible");
        })
        .on("mousemove", (e) =>
          tip
            .style("left", e.clientX + 12 + "px")
            .style("top", e.clientY - 12 + "px")
        )
        .on("mouseout", () => tip.style("visibility", "hidden"));
    }

    function enableVEDrag() {
      const dragVE = d3
        .drag()
        .on("start", function (ev, ve) {
          d3.select(this).style("cursor", "grabbing");
          ve._dragStart = { x: ve.x, y: ve.y };
        })
        .on("drag", function (ev, ve) {
          ve.x = ev.x;
          ve.y = ev.y;
          d3.select(this).attr("transform", `translate(${ve.x},${ve.y})`);
          gENVE
            .filter((l) => l.target.id === ve.id)
            .attr("x2", ve.x)
            .attr("y2", ve.y);
          const dx = ve.x - ve.homeX;
          const dy = ve.y - ve.homeY;
          layerNode
            .selectAll("g.party")
            .filter((p) => p.ve === ve.id)
            .attr("transform", (p) => {
              p.x = p.homeX + dx;
              p.y = p.homeY + dy;
              return `translate(${p.x},${p.y})`;
            });
          gVP
            .filter((l) => l.source.id === ve.id)
            .attr("x1", ve.x)
            .attr("y1", ve.y)
            .attr("x2", (l) => l.target.x)
            .attr("y2", (l) => l.target.y);

          if (FOCUS && FOCUS.mode === "party" && FOCUS.veId === ve.id) {
            const focusedParty = partyNodes.find(
              (p) => p.ve === ve.id && p.raw === FOCUS.party
            );
            if (focusedParty && mpSim) {
              mpSim.force(
                "center",
                d3.forceCenter(focusedParty.x, focusedParty.y)
              );
              mpSim.force(
                "radial",
                d3
                  .forceRadial(85, focusedParty.x, focusedParty.y)
                  .strength(0.18)
              );
              mpSim.alpha(0.5).restart();
            }
          }
        })
        .on("end", function (ev, ve) {
          d3.select(this).style("cursor", "pointer");
          const x0 = ve.x;
          const y0 = ve.y;
          const x1 = ve.homeX;
          const y1 = ve.homeY;
          const self = d3.select(this);
          self
            .transition()
            .duration(700)
            .ease(d3.easeElasticOut)
            .tween("returnVE", () => (t) => {
              ve.x = x0 + (x1 - x0) * t;
              ve.y = y0 + (y1 - y0) * t;
              self.attr("transform", `translate(${ve.x},${ve.y})`);
              gENVE
                .filter((l) => l.target.id === ve.id)
                .attr("x2", ve.x)
                .attr("y2", ve.y);
              const dx = ve.x - ve.homeX;
              const dy = ve.y - ve.homeY;
              layerNode
                .selectAll("g.party")
                .filter((p) => p.ve === ve.id)
                .attr("transform", (p) => {
                  p.x = p.homeX + dx;
                  p.y = p.homeY + dy;
                  return `translate(${p.x},${p.y})`;
                });
              gVP
                .filter((l) => l.source.id === ve.id)
                .attr("x1", ve.x)
                .attr("y1", ve.y)
                .attr("x2", (l) => l.target.x)
                .attr("y2", (l) => l.target.y);

              if (FOCUS && FOCUS.mode === "party" && FOCUS.veId === ve.id) {
                const focusedParty = partyNodes.find(
                  (p) => p.ve === ve.id && p.raw === FOCUS.party
                );
                if (focusedParty && mpSim) {
                  mpSim.force(
                    "center",
                    d3.forceCenter(focusedParty.x, focusedParty.y)
                  );
                  mpSim.force(
                    "radial",
                    d3
                      .forceRadial(85, focusedParty.x, focusedParty.y)
                      .strength(0.18)
                  );
                  mpSim.alpha(0.25).restart();
                }
              }
            });
        });
      gVE.call(dragVE);
    }

    function dominantToneColor(counts) {
      const total =
        (counts?.yes || 0) + (counts?.no || 0) + (counts?.other || 0);
      if (!total) return "#bbb";
      const pYes = (counts?.yes || 0) / total;
      const pNo = (counts?.no || 0) / total;
      const pOth = (counts?.other || 0) / total;
      const maxP = Math.max(pYes, pNo, pOth);
      const yesLight = "#76c679";
      const yesDark =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--yes")
          .trim() || "#2ca02c";
      const noLight = "#e86a6a";
      const noDark =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--no")
          .trim() || "#d62728";
      const otLight = "#bdbdbd";
      const otDark = "#666666";
      if (maxP === pYes) return d3.interpolateRgb(yesLight, yesDark)(maxP);
      if (maxP === pNo) return d3.interpolateRgb(noLight, noDark)(maxP);
      return d3.interpolateRgb(otLight, otDark)(maxP);
    }

    // Clicking VE node (in-canvas focus toggle)
    gVE.on("click", (e, d) => {
      e.stopPropagation();
      userClickedVE.current = true;
      toggleFocusVE(d);
    });

    enablePartyDrag();
    enableVEDrag();
    if (!FOCUS) {
      fitToContentsStatic([{ x: cx, y: cy }, ...veNodes, ...partyNodes], 60);
    }

    // fitToContentsStatic([{ x: cx, y: cy }, ...veNodes, ...partyNodes], 60);

    if (firstRender.current) {
      clearFocus();
      firstRender.current = false;
    } else {
      // After filters change, redraw mini-radial for current VE set
      drawMiniRadial(eventsForBill);
    }

    // Additional shift to left after fitting
    setTimeout(() => {
      if (FOCUS) return;
      const currentTransform = root.attr("transform") || "";
      const match = currentTransform.match(/translate\(([^,]+),([^)]+)\)/);
      if (match) {
        const currentX = parseFloat(match[1]);
        const currentY = parseFloat(match[2]);
        const scaleMatch = currentTransform.match(/scale\(([^)]+)\)/);
        const scale = scaleMatch ? scaleMatch[1] : "1";

        const shiftLeft = W * -0.15;
        root.attr(
          "transform",
          `translate(${currentX + shiftLeft},${currentY}) scale(${scale})`
        );
      }
    }, 50);

    function fitToContentsStatic(nodes, padding = 60) {
      if (!nodes.length) return;
      const xs = nodes.map((n) => n.x);
      const ys = nodes.map((n) => n.y);
      const minX = Math.min(...xs) - padding;
      const maxX = Math.max(...xs) + padding;
      const minY = Math.min(...ys) - padding;
      const maxY = Math.max(...ys) + padding;
      const width = Math.max(1, maxX - minX);
      const height = Math.max(1, maxY - minY);
      const k = Math.min(W / width, H / height) * 0.95;

      const tx = (W * 1.15 - k * (minX + maxX)) / 2;
      const ty = (H - k * (minY + maxY)) / 2;

      root.attr("transform", `translate(${tx},${ty}) scale(${k})`);
    }

    function onResize() {
      setRefreshKey((k) => k + 1);
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [
    eventsForBill,
    selectedBill,
    partyFilter,
    mpFilter,
    refreshKey,
    navigateToInteraction,
    openCompareModal,
    drawMiniRadial,
    VOTE_COLOR,
  ]);

  // ============================================================================
  // Static Party Legend (once)
  // ============================================================================
  useEffect(() => {
    const list = d3.select(partyLegendRef.current).html("");
    const items = Object.keys(PARTY_COLOR).sort((a, b) => a.localeCompare(b));
    const enter = list
      .selectAll(".item")
      .data(items)
      .enter()
      .append("div")
      .attr("class", "item");
    enter
      .append("span")
      .attr("class", "chip")
      .style("background", (d) => PARTY_COLOR[d]);
    enter.append("span").text((d) => d);
  }, []);

  return (
    <div>
      <div id="visMainContainer">
        {/* ===== Left Panel: Filters ===== */}
        <div id="filtersPanel">
          <div className="block">
            <div className="fieldlabel">
              🗓 Date range (End Date of Enforced Bills)
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <label>Start Date</label>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
              />
              <label>End Date</label>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
              />
            </div>
          </div>

          <div className="block wide">
            <div className="fieldlabel">เลือกกฎหมายที่บังคับใช้</div>
            <input
              id="billSearch"
              type="text"
              placeholder="พิมพ์ค้นหากฎหมาย..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <select
              id="billSel"
              value={selectedBill}
              onChange={(e) => {
                setSelectedBill(e.target.value);
                setRefreshKey((k) => k + 1);
              }}
            >
              {filteredBillOptions.map((b) => (
                <option key={b.title} value={b.title}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>

          <div className="block">
            <div className="fieldlabel">เลือกพรรคการเมือง</div>
            <select
              id="partySel"
              value={partyFilter[0] || ""}
              onChange={(e) => setPartyFilter([e.target.value])}
            >
              <option value="">ทั้งหมด</option>
              {partyOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="block">
            <div className="fieldlabel">เลือกสมาชิกสภาผู้แทนราษฎร</div>
            <select
              id="mpSel"
              value={mpFilter[0] || ""}
              onChange={(e) => setMpFilter([e.target.value])}
            >
              <option value="">ทั้งหมด</option>
              {mpOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="block">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button id="applyBtn" onClick={() => setRefreshKey((k) => k + 1)}>
                Apply
              </button>
              <button
                id="resetBtn"
                onClick={() => {
                  setPartyFilter([]);
                  setMpFilter([]);
                }}
              >
                Reset
              </button>
              <button
                id="reloadBtn"
                onClick={() => setRefreshKey((k) => k + 1)}
              >
                Reload Data
              </button>
            </div>
          </div>
        </div>

        {/* ===== Right Panel: Interaction Visualization ===== */}
        <div id="interactionArea">
          <div id="mainWrap">
            <div id="partyLegend">
              <div className="title">สีพรรคการเมือง</div>
              <div id="partyLegendList" ref={partyLegendRef}></div>
            </div>
            <svg id="mainGraph" ref={svgRef}></svg>
          </div>

          {/* Legend bar moved to bottom */}
          <div id="legendBar">
            <span className="legend-dot">
              <span
                className="legend-chip"
                style={{ background: "var(--yes)" }}
              ></span>
              เห็นชอบ
            </span>
            <span className="legend-dot">
              <span
                className="legend-chip"
                style={{ background: "var(--no)" }}
              ></span>
              ไม่เห็นชอบ
            </span>
            <span className="legend-dot">
              <span
                className="legend-chip"
                style={{ background: "var(--oth)" }}
              ></span>
              อื่น ๆ
            </span>
            <span className="legend-dot">
              <span
                className="legend-chip"
                style={{ background: "var(--gold)" }}
              ></span>
              Enforced ↔ VoteEvent
            </span>
          </div>
        </div>
      </div>

      <div id="miniWrap">
        <div id="miniTitle">
          ภาพย่อย (Radial) — VoteEvents ของกฎหมายที่เลือก
        </div>
        <div id="miniScroller">
          <div id="miniGraphs" ref={miniGraphsRef}></div>
        </div>
      </div>

      <div id="tooltip" className="tooltip" ref={tooltipRef}></div>
      <GeoPoliticalViewer
        open={showGeoModal}
        onClose={closeGeoModal}
        eventObj={geoEvent}
      />
      <CompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        fullName={selectedMP?.fullName || ""}
      />
    </div>
  );
}

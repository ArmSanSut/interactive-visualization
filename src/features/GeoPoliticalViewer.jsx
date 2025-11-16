// src/features/GeoPoliticalViewer.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { FALLBACK_URLS } from "../data/fallbackUrls.js";
import { loadFallback } from "../data/fallbackLoader.js";


export default function GeoPoliticalViewer({
  open = false,
  onClose = () => {},
  eventObj = null,
}) {
  if (!open) return null;

  // ---------- Constants ----------
  const GEOJSON_URL =
    "https://raw.githubusercontent.com/chingchai/OpenGISData-Thailand/master/provinces.geojson";
  const GQL_ENDPOINT = "https://politigraph.wevis.info/graphql";
  const GQL_QUERY = `
    query VoteEvents {
      voteEvents {
        id
        title
        votes {
          option
          voter_party
          voters { name memberships { province } }
        }
      }
    }
  `;

  // Map shading colors
  const SHADE_YES_BLUE = "#13a724ff";
  const SHADE_NO_RED = "#e53935";
  const SHADE_NOVOTE_GREEN = "#86e394ff";
  const SHADE_OTHER_GRAY = "#0b0b0bff";
  const SHADE_TIE_PURPLE = "#e7ec8aff";
  const SHADE_NODATA = "#e5e7eb";

  // Bubble colors
  const BUBBLE_BLUE = "#1e88e5";
  const BUBBLE_RED = "#e53935";
  const BUBBLE_GRAY = "#9e9e9e";
  const ZOOM_THRESHOLD = 2.0;

  async function loadVoteEventsFallback() {
  try {
    const res = await fetch(FALLBACK_URLS.voteEvents);
    if (!res.ok) throw new Error("Failed to load local fallback");
    const json = await res.json();

    // Fallback file may have different structures → normalize
    return json?.voteEvents || json?.events || json || [];
  } catch (err) {
    console.error("❌ Local fallback load failed:", err);
    return [];
  }
}

  // ---------- Refs ----------
  const svgRef = useRef(null);
  const gRootRef = useRef(null);
  const tooltipRef = useRef(null);
  const featureByNameRef = useRef(new Map());
  const keyToNameRef = useRef(new Map());
  const statsByNameRef = useRef({});

  // ---------- State ----------
  const [status, setStatus] = useState("กำลังเตรียมแผนที่…");
  const [geoReady, setGeoReady] = useState(false);
  const [rawEvents, setRawEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // ---------- Helpers ----------
  const norm = (s) => String(s ?? "").trim();
  
  const normalizeKey = (thName) =>
    norm(thName)
      .replace(/^จังหวัด/, "")
      .replace(/\s+/g, "")
      .replace(/[^\u0E00-\u0E7F]/g, "");

  function normalizeProvinceInput(name) {
    if (!name) return null;
    let x = norm(name);
    
    // Bangkok variations
    if (["กทม", "กทม.", "กรุงเทพ", "กรุงเทพฯ"].includes(x))
      return "กรุงเทพมหานคร";
    
    // Remove "จังหวัด" prefix
    x = x.replace(/^จังหวัด/, "");
    
    return x;
  }

  function lastProvinceOf(memberships) {
    if (!Array.isArray(memberships)) return null;
    for (let i = memberships.length - 1; i >= 0; i--) {
      const p = memberships[i] && memberships[i].province;
      if (p && norm(p)) return norm(p);
    }
    return null;
  }

  // ✅ FIXED: Better structure detection with explicit checks
  function normalizeVoteStructure(event) {
    if (!event || !event.votes) return { ...event, votes: [] };
    
    const firstVote = event.votes[0];
    if (!firstVote) return event;

    console.log("🔍 Analyzing vote structure:", {
      hasVoters: !!firstVote.voters,
      isVotersArray: Array.isArray(firstVote.voters),
      hasVoterName: firstVote.hasOwnProperty('voter_name'),
      hasVoterProvince: firstVote.hasOwnProperty('voter_province'),
      firstVoteSample: firstVote
    });

    // Check if it's Structure A (GraphQL with voters array)
    // Must have voters array AND NOT have voter_name/voter_province fields
    if (firstVote.voters && Array.isArray(firstVote.voters) && 
        !firstVote.hasOwnProperty('voter_name') && 
        !firstVote.hasOwnProperty('voter_province')) {
      
      // Count total voters
      const totalVoters = event.votes.reduce((sum, v) => 
        sum + (v.voters ? v.voters.length : 0), 0
      );
      console.log(`👥 Total voters: ${totalVoters}`);
      
      return event; // Already in correct format
    }

    // Check if it's Structure B (VisMain flattened format)
    // Must have voter_name OR voter_province AND NOT have voters array
    if ((firstVote.voter_name !== undefined || firstVote.voter_province !== undefined) &&
        !Array.isArray(firstVote.voters)) {
      
      // Convert Structure B to Structure A
      // Group by option and voter_party
      const grouped = {};
      
      event.votes.forEach(vote => {
        const key = `${vote.option}|||${vote.voter_party || ''}`;
        if (!grouped[key]) {
          grouped[key] = {
            option: vote.option,
            voter_party: vote.voter_party,
            voters: []
          };
        }
        
        // Add voter with province from voter_province field
        grouped[key].voters.push({
          name: vote.voter_name || "ไม่ทราบชื่อ",
          memberships: vote.voter_province 
            ? [{ province: vote.voter_province }]
            : []
        });
      });
      
      const convertedVotes = Object.values(grouped);
      console.log(`📊 Converted ${event.votes.length} flat votes into ${convertedVotes.length} grouped votes`);
      
      return {
        ...event,
        votes: convertedVotes
      };
    }

    console.warn("⚠️ Unknown vote structure, returning as-is:", firstVote);
    return event;
  }

  function colorFromOptionBubble(opt) {
    const s = norm(opt);
    if (s.includes("ไม่เห็นด้วย")) return BUBBLE_RED;
    if (s.includes("เห็นด้วย")) return BUBBLE_BLUE;
    return BUBBLE_GRAY;
  }

  function colorFromWinnerForShade(winnerLabel) {
    const s = norm(winnerLabel);
    if (!s) return SHADE_NODATA;
    if (s.includes("ไม่เห็นด้วย")) return SHADE_NO_RED;
    if (s.includes("เห็นด้วย")) return SHADE_YES_BLUE;
    if (s.includes("ไม่ลงคะแนน")) return SHADE_NOVOTE_GREEN;
    return SHADE_OTHER_GRAY;
  }

  function coerceFallbackEvents(any) {
    if (!any) return [];
    if (Array.isArray(any)) return any;
    if (any.data?.voteEvents) return any.data.voteEvents;
    if (any.data?.events) return any.data.events;
    if (any.voteEvents) return any.voteEvents;
    return [];
  }

  // ---------- ESC closes modal ----------
  useEffect(() => {
    function keyHandler(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, [onClose]);

  // ---------- Init SVG + Zoom ----------
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("data-layer", "root");
    gRootRef.current = g.node();

    if (tooltipRef.current) tooltipRef.current.style.opacity = 0;

    const zoom = d3
      .zoom()
      .scaleExtent([1, 8])
      .on("zoom", (ev) => {
        g.attr("transform", ev.transform);
        toggleBubbleVisibility();
      });

    svg.call(zoom);

    return () => svg.on(".zoom", null);
  }, []);

  // ---------- Load GeoJSON & draw base map ----------
  useEffect(() => {
    let alive = true;
    async function run() {
      try {
        setStatus("กำลังโหลดข้อมูลแผนที่…");
        
        const g = d3.select(gRootRef.current);
        if (g.empty()) {
          console.error("gRoot is not ready");
          return;
        }

        const data = await d3.json(GEOJSON_URL);

        // Ensure properties.name exists
        data.features.forEach((f) => {
          const p = f.properties || {};
          const name =
            p.pro_th ||
            p.name_th ||
            p.PROV_NAMT ||
            p.prov_name_th ||
            p.pro_en ||
            "ไม่ทราบจังหวัด";
          f.properties = { name };
        });

        // Build maps for robust name matching
        const featureByName = new Map();
        const keyToName = new Map();
        data.features.forEach((f) => {
          const real = norm(f.properties.name);
          featureByName.set(real, f);
          keyToName.set(normalizeKey(real), real);
        });
        featureByNameRef.current = featureByName;
        keyToNameRef.current = keyToName;

        console.log("📍 Loaded provinces:", Array.from(featureByName.keys()));

        // Fit to viewBox
        const width = 900;
        const height = 1200;
        const projection = d3.geoMercator();
        const path = d3.geoPath(projection);
        projection.fitSize([width, height], data);

        // Provinces layer
        const provinces = g
          .append("g")
          .attr("data-layer", "provinces")
          .selectAll("path")
          .data(data.features)
          .enter()
          .append("path")
          .attr("class", "province")
          .attr("d", path)
          .attr("tabindex", 0)
          .on("mousemove", (ev, d) => {
            const name = d?.properties?.name || "-";
            const st = statsByNameRef.current[name];
            let html = `<strong>${name}</strong>`;
            if (!st || !st.total) {
              html += `<br><em>ไม่มีข้อมูล</em>`;
            } else {
              const rows = Object.entries(st.percents)
                .sort((a, b) => b[1] - a[1])
                .map(
                  ([opt, p]) =>
                    `${opt}: ${(p * 100).toFixed(1)}% (${st.counts[opt]})`
                );
              const head = st.winner
                ? `ผู้ชนะ: <b>${st.winner}</b> (${(st.winShare * 100).toFixed(
                    1
                  )}%)`
                : `<em>เสมอ/ผสม</em>`;
              html += `<br>${head}<br>${rows.join("<br>")}<br>รวม: ${
                st.total
              } คน`;
            }
            showTooltipHTML(ev, html);
          })
          .on("mouseenter", (ev, d) => {
            const name = d?.properties?.name || "-";
            const st = statsByNameRef.current[name];
            let html = `<strong>${name}</strong>`;
            if (!st || !st.total) html += `<br><em>ไม่มีข้อมูล</em>`;
            showTooltipHTML(ev, html);
          })
          .on("mouseleave", hideTooltipHTML)
          .on("blur", hideTooltipHTML);

        // Give each path an id
        provinces.attr("id", function (_, i) {
          if (this.id) return this.id;
          this.id = "prov-" + i;
          return this.id;
        });

        // Soft outer border
        g.append("path")
          .datum({ type: "FeatureCollection", features: data.features })
          .attr("fill", "none")
          .attr("stroke", "rgba(0,0,0,0.15)")
          .attr("stroke-width", 1)
          .attr("d", path);

        if (!alive) return;
        setGeoReady(true);
        setStatus("แผนที่พร้อมแล้ว");
      } catch (e) {
        console.error(e);
        if (!alive) return;
        setGeoReady(false);
        setStatus("โหลดข้อมูลแผนที่ไม่สำเร็จ");
      }
    }
    run();
    return () => {
      alive = false;
    };
  }, []);

  // ---------- Load Politigraph or use eventObj ----------
  // useEffect(() => {
  //   let mounted = true;

  //   // Load fallback events first
  //   const fallbackEvents = coerceFallbackEvents(fallback);
  //   setRawEvents(fallbackEvents);

  //   if (eventObj) {
  //     console.log("✅ Received eventObj from parent:", eventObj);
  //     console.log("🔍 Searching for matching event in fallback JSON...");
      
  //     let matchingEvent = null;
      
  //     // Strategy 1: Try matching by ID first (most reliable)
  //     if (eventObj.id) {
  //       matchingEvent = fallbackEvents.find(e => e.id === eventObj.id);
  //       if (matchingEvent) {
  //         console.log("✅ FOUND by ID:", eventObj.id);
  //       }
  //     }
      
  //     // Strategy 2: Try exact title match
  //     if (!matchingEvent && eventObj.title) {
  //       const eventTitle = eventObj.title.trim().toLowerCase();
  //       matchingEvent = fallbackEvents.find(e => {
  //         const fallbackTitle = (e.title || "").trim().toLowerCase();
  //         return fallbackTitle === eventTitle;
  //       });
  //       if (matchingEvent) {
  //         console.log("✅ FOUND by exact title match");
  //       }
  //     }
      
  //     // Strategy 3: Try substring/contains match
  //     if (!matchingEvent && eventObj.title) {
  //       const eventTitle = eventObj.title.trim().toLowerCase();
  //       matchingEvent = fallbackEvents.find(e => {
  //         const fallbackTitle = (e.title || "").trim().toLowerCase();
  //         return fallbackTitle.includes(eventTitle) || 
  //                eventTitle.includes(fallbackTitle);
  //       });
  //       if (matchingEvent) {
  //         console.log("✅ FOUND by substring title match");
  //       }
  //     }
      
  //     if (matchingEvent) {
  //       console.log("📄 Fallback title:", matchingEvent.title);
  //       console.log("📄 Received title:", eventObj.title);
  //       console.log("📊 Using fallback data with complete province information");
        
  //       // Count voters in fallback to verify it has data
  //       const totalVoters = matchingEvent.votes?.reduce((sum, v) => 
  //         sum + (v.voters?.length || 0), 0
  //       ) || 0;
  //       console.log(`👥 Fallback event has ${totalVoters} voters`);
        
  //       // Use the fallback data (which has province info)
  //       const normalized = normalizeVoteStructure(matchingEvent);
  //       setSelectedEvent(normalized);
  //       return;
  //     } else {
  //       console.warn("⚠️ No matching event found in fallback JSON");
  //       console.log("🔍 Looking for:");
  //       console.log("  - ID:", eventObj.id || "(not provided)");
  //       console.log("  - Title:", eventObj.title || "(not provided)");
  //       console.log("\n📋 Available events in fallback:");
  //       fallbackEvents.forEach((e, i) => {
  //         console.log(`  ${i + 1}. [${e.id}] ${e.title}`);
  //       });
  //       console.log("\n⚠️ Using provided eventObj (may have incomplete province data)");
        
  //       // Fall back to using the provided event
  //       const normalized = normalizeVoteStructure(eventObj);
  //       setSelectedEvent(normalized);
  //     }
  //   }

  //   // Try to fetch from GraphQL as backup
  //   (async () => {
  //     try {
  //       const controller = new AbortController();
  //       const timeoutId = setTimeout(() => controller.abort(), 10000);
        
  //       const res = await fetch(GQL_ENDPOINT, {
  //         method: "POST",
  //         headers: { "content-type": "application/json" },
  //         body: JSON.stringify({ query: GQL_QUERY }),
  //         signal: controller.signal,
  //       });
        
  //       clearTimeout(timeoutId);

  //       let events = [];
  //       if (res.ok) {
  //         const json = await res.json();
  //         events = coerceFallbackEvents(json);
  //       } else {
  //         throw new Error("GraphQL error");
  //       }

  //       if (!mounted) return;
        
  //       // Only update rawEvents if we got more data
  //       if (events.length > 0) {
  //         setRawEvents(events);
  //       }

  //       // Only set selectedEvent if we don't have eventObj
  //       if (!eventObj && events.length > 0) {
  //         console.log("✅ Using GraphQL event:", events[0]);
  //         setSelectedEvent(events[0]);
  //       }
  //     } catch (err) {
  //       console.warn("GraphQL failed, using fallback JSON:", err);
        
  //       if (!mounted) return;
        
  //       // Only set selectedEvent if we don't have eventObj
  //       if (!eventObj && fallbackEvents.length > 0) {
  //         setSelectedEvent(fallbackEvents[0]);
  //       }
  //     }
  //   })();

  //   return () => (mounted = false);
  // }, [eventObj]);

  useEffect(() => {
  let mounted = true;

  async function run() {
    console.log("📥 Loading local fallback voteEvents…");
    const fallbackEvents = await loadVoteEventsFallback();

    if (!mounted) return;

    setRawEvents(fallbackEvents);

    if (eventObj) {
      console.log("🔍 Received eventObj:", eventObj);

      // --- match by ID ---
      let matchingEvent =
        fallbackEvents.find((e) => e.id === eventObj.id) || null;

      // --- match by exact title ---
      if (!matchingEvent && eventObj.title) {
        const t = eventObj.title.trim().toLowerCase();
        matchingEvent = fallbackEvents.find(
          (e) => (e.title || "").trim().toLowerCase() === t
        );
      }

      // --- match by substring ---
      if (!matchingEvent && eventObj.title) {
        const t = eventObj.title.trim().toLowerCase();
        matchingEvent = fallbackEvents.find((e) =>
          (e.title || "").trim().toLowerCase().includes(t)
        );
      }

      if (matchingEvent) {
        console.log("🌟 Using fallback match:", matchingEvent);
        setSelectedEvent(normalizeVoteStructure(matchingEvent));
        return;
      }

      console.warn("⚠️ No fallback match found → using eventObj");
      setSelectedEvent(normalizeVoteStructure(eventObj));
    }
  }

  run();
  return () => (mounted = false);
}, [eventObj]);


  // ---------- Render map when ready ----------
  useEffect(() => {
    if (!geoReady) return;
    if (!svgRef.current || !gRootRef.current) return;

    resetMapColors();
    clearBubbles();

    if (!selectedEvent) return;

    try {
      const statsByName = buildStatsByProvince(selectedEvent);
      statsByNameRef.current = statsByName;

      console.log("📊 Stats by province:", statsByName);

      colorizeMap(statsByName);
      drawBubblesForEvent(selectedEvent);
      setStatus(selectedEvent.title ? `🗳 ${selectedEvent.title}` : "พร้อม");
    } catch (e) {
      console.error("❌ Error processing event:", e);
      setStatus("ประมวลผลข้อมูลไม่สำเร็จ");
    }
  }, [geoReady, selectedEvent]);

  // ---------- Stats (plurality; ties → mixed/null winner) ----------
  function buildStatsByProvince(event) {
    const featureByName = featureByNameRef.current;
    const keyToName = keyToNameRef.current;

    const out = {};
    const votes = (event && event.votes) || [];
    
    let matchedCount = 0;
    let unmatchedCount = 0;
    const unmatchedProvinces = new Set();
    
    // Detailed diagnostics
    let noMembershipCount = 0;
    let emptyMembershipCount = 0;
    let noProvinceInMembershipCount = 0;
    let provinceNotFoundCount = 0;
    
    // Sample some voters for debugging
    let sampleCount = 0;
    const maxSamples = 5;

    for (const v of votes) {
      const option = v?.option || "อื่น ๆ";
      const voters = v?.voters || [];
      
      for (const person of voters) {
        // Log first few voters for debugging
        if (sampleCount < maxSamples) {
          console.log(`👤 Sample voter ${sampleCount + 1}:`, {
            name: person?.name,
            hasMemberships: !!person?.memberships,
            memberships: person?.memberships,
            membershipCount: Array.isArray(person?.memberships) ? person.memberships.length : 'not array'
          });
          sampleCount++;
        }
        
        // Check if memberships exist
        if (!person?.memberships) {
          noMembershipCount++;
          unmatchedCount++;
          continue;
        }
        
        // Check if memberships is empty array
        if (Array.isArray(person.memberships) && person.memberships.length === 0) {
          emptyMembershipCount++;
          unmatchedCount++;
          continue;
        }
        
        const provRaw = lastProvinceOf(person?.memberships);
        if (!provRaw) {
          noProvinceInMembershipCount++;
          unmatchedCount++;
          continue;
        }

        const normalized = normalizeProvinceInput(provRaw);
        if (!normalized) {
          unmatchedCount++;
          unmatchedProvinces.add(provRaw);
          continue;
        }

        let realName = null;
        
        // Try exact match first
        if (featureByName.has(normalized)) {
          realName = normalized;
        } else {
          // Try normalized key match
          const mapped = keyToName.get(normalizeKey(normalized));
          if (mapped) realName = mapped;
        }
        
        if (!realName) {
          console.warn("❌ Province not matched in map:", provRaw, "→", normalized);
          provinceNotFoundCount++;
          unmatchedCount++;
          unmatchedProvinces.add(provRaw);
          continue;
        }

        matchedCount++;
        const st = (out[realName] ||= { counts: {}, total: 0 });
        st.counts[option] = (st.counts[option] || 0) + 1;
        st.total++;
      }
    }

    // Detailed summary
    console.log(`\n📊 MATCHING SUMMARY:`);
    console.log(`✅ Successfully matched: ${matchedCount} voters`);
    console.log(`❌ Unmatched total: ${unmatchedCount} voters\n`);
    
    if (unmatchedCount > 0) {
      console.log(`📋 Breakdown of unmatched voters:`);
      if (noMembershipCount > 0) 
        console.log(`  - No memberships field: ${noMembershipCount}`);
      if (emptyMembershipCount > 0) 
        console.log(`  - Empty memberships array: ${emptyMembershipCount}`);
      if (noProvinceInMembershipCount > 0) 
        console.log(`  - Memberships exist but no province found: ${noProvinceInMembershipCount}`);
      if (provinceNotFoundCount > 0) 
        console.log(`  - Province name couldn't be matched to map: ${provinceNotFoundCount}`);
    }
    
    if (unmatchedProvinces.size > 0) {
      console.log(`\n❌ Province names that couldn't be matched (${unmatchedProvinces.size}):`, 
        Array.from(unmatchedProvinces));
    }

    // Add percents + strict plurality winner
    Object.entries(out).forEach(([name, st]) => {
      const total = st.total || 0;
      const perc = {};
      let winner = null;
      let best = -1;
      let tie = false;

      Object.entries(st.counts).forEach(([opt, c]) => {
        perc[opt] = total ? c / total : 0;
        if (c > best) {
          best = c;
          winner = opt;
          tie = false;
        } else if (c === best) {
          tie = true;
        }
      });

      st.percents = perc;
      st.winner = tie ? null : winner;
      st.winShare = tie ? 0 : best / (total || 1);
    });

    return out;
  }

  // ---------- Map coloring ----------
  function colorizeMap(statsByName) {
    const g = d3.select(gRootRef.current);
    if (g.empty()) return;

    g.selectAll(".province").attr("fill", (d) => {
      const real = d?.properties?.name;
      const st = statsByName[real];
      if (!st || !st.total) return SHADE_NODATA;
      if (!st.winner) return SHADE_TIE_PURPLE;
      return colorFromWinnerForShade(st.winner);
    });
  }

  function resetMapColors() {
    const g = d3.select(gRootRef.current);
    if (g.empty()) return;
    g.selectAll(".province").attr("fill", SHADE_NODATA);
  }

  // ---------- Bubble helpers ----------
  function makePathFromMap() {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRootRef.current);
    const provinceSel = g.selectAll("path.province");

    const vb = (svg.attr("viewBox") || "0 0 900 1200").split(/\s+/).map(Number);
    const [, , w, h] = vb;

    const features = [];
    provinceSel.each(function () {
      const f = d3.select(this).datum();
      if (f) features.push(f);
    });
    const fc = { type: "FeatureCollection", features };
    const projection = d3.geoMercator();
    const path = d3.geoPath(projection);
    if (features.length) projection.fitSize([w, h], fc);
    return path;
  }

  function spiralPoints(cx, cy, n, step = 8) {
    const pts = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const r = step * Math.sqrt(i);
      const a = i * golden;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  function clearBubbles() {
    if (!svgRef.current || !gRootRef.current) return;

    const svg = d3.select(svgRef.current);
    const g = d3.select(gRootRef.current);

    const bubbleLayer = g.select(".bubble-layer");
    if (!bubbleLayer.empty()) bubbleLayer.remove();

    let defs = svg.select("defs");
    if (defs.empty()) {
      defs = svg.append("defs");
    }

    defs.selectAll("clipPath.bubble-clip").remove();
  }

  function ensureClipPathsForProvinces() {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRootRef.current);
    const provinceSel = g.selectAll("path.province");

    let defs = svg.select("defs");
    if (defs.empty()) defs = svg.append("defs");

    const nodes = provinceSel.nodes();
    const clip = defs
      .selectAll("clipPath.bubble-clip")
      .data(nodes, (node) => node.id);

    const clipEnter = clip
      .enter()
      .append("clipPath")
      .attr("class", "bubble-clip")
      .attr("id", (node) => "clip-" + node.id);

    clipEnter.append("use").attr("href", (node) => "#" + node.id);
    clip.exit().remove();
  }

  function drawBubblesForEvent(event) {
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRootRef.current);
    const provinceSel = g.selectAll("path.province");

    if (provinceSel.empty()) {
      console.warn("[bubble] map not ready");
      return;
    }

    let bubbleLayer = g.select(".bubble-layer");
    if (bubbleLayer.empty()) {
      bubbleLayer = g.append("g").attr("class", "bubble-layer");
    } else {
      bubbleLayer.selectAll("*").remove();
    }

    ensureClipPathsForProvinces();

    const featureByName = featureByNameRef.current;
    const keyToName = keyToNameRef.current;

    const membersByName = {};
    const votes = (event && event.votes) || [];
    
    for (const v of votes) {
      const option = v?.option || "อื่น ๆ";
      const party = v?.voter_party || "";
      const voters = v?.voters || [];
      
      for (const person of voters) {
        const provRaw = lastProvinceOf(person?.memberships);
        if (!provRaw) continue;

        const normalized = normalizeProvinceInput(provRaw);
        if (!normalized) continue;

        let real = null;
        if (featureByName.has(normalized)) {
          real = normalized;
        } else {
          const mapped = keyToName.get(normalizeKey(normalized));
          if (mapped) real = mapped;
        }
        if (!real) continue;

        (membersByName[real] ||= []).push({
          name: person?.name || "ไม่ทราบชื่อ",
          option,
          party,
        });
      }
    }

    const path = makePathFromMap();

    provinceSel.each(function () {
      const f = d3.select(this).datum();
      const name = norm(f?.properties?.name);
      const list = membersByName[name] || [];
      if (!list.length) return;

      const [cx, cy] = path.centroid(f);
      const pts = spiralPoints(cx, cy, list.length, 8);

      const gProv = bubbleLayer
        .append("g")
        .attr("class", "prov-bubbles")
        .attr("clip-path", `url(#${"clip-" + this.id})`);

      const nodes = gProv
        .selectAll("circle.member")
        .data(list)
        .enter()
        .append("circle")
        .attr("class", "member")
        .attr("cx", (_, i) => pts[i][0])
        .attr("cy", (_, i) => pts[i][1])
        .attr("r", 3.2)
        .attr("fill", (d) => colorFromOptionBubble(d.option))
        .attr("stroke", "rgba(0,0,0,0.35)")
        .attr("stroke-width", 0.6);

      nodes
        .on("mousemove", (ev, d) => {
          const html =
            `<strong>${d.name || "-"}</strong><br>` +
            `${d.party ? d.party + " • " : ""}${d.option || "-"}` +
            (name ? `<br><small>${name}</small>` : "");
          showTooltipHTML(ev, html);
        })
        .on("mouseenter", (ev, d) => {
          const html =
            `<strong>${d.name || "-"}</strong><br>` +
            `${d.party ? d.party + " • " : ""}${d.option || "-"}` +
            (name ? `<br><small>${name}</small>` : "");
          showTooltipHTML(ev, html);
        })
        .on("mouseleave", hideTooltipHTML);
    });

    toggleBubbleVisibility();
  }

  function toggleBubbleVisibility() {
    const svgNode = d3.select(svgRef.current).node();
    const g = d3.select(gRootRef.current);
    const layer = g.select(".bubble-layer");
    if (layer.empty()) return;
    const k = d3.zoomTransform(svgNode).k || 1;
    layer.attr("display", k >= ZOOM_THRESHOLD ? null : "none");
  }

  // ---------- Tooltip ----------
  function showTooltipHTML(event, html) {
    const el = tooltipRef.current;
    if (!el) return;
    el.innerHTML = html;
    el.style.opacity = 1;

    const svg = d3.select(svgRef.current).node();
    const [x, y] = d3.pointer(event, svg);
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const ctm = svg.getScreenCTM();
    const { x: cx, y: cy } = pt.matrixTransform(ctm);
    el.style.left = cx + 12 + "px";
    el.style.top = cy - 12 + "px";
  }
  
  function hideTooltipHTML() {
    const el = tooltipRef.current;
    if (el) el.style.opacity = 0;
  }

  // ---------- Render ----------
  return (
    <div className="gpv-modal-backdrop" onClick={onClose}>
      <style>{`
  .gpv-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.55);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .gpv-modal-panel {
    background: #ffffff;
    border-radius: 18px;
    width: min(96vw, 1100px);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
  .gpv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px 8px;
    border-bottom: 1px solid #e5e7eb;
  }
  .gpv-title {
    font-size: 14px;
    font-weight: 600;
    color: #111827;
    margin: 0;
    padding-right: 8px;
  }
  .gpv-close {
    font-size: 24px;
    line-height: 1;
    background: transparent;
    border: none;
    cursor: pointer;
    color: #111827;
  }
  .gpv-map-wrap {
    padding: 10px 10px 0;
    display: grid;
    place-items: center;
  }
  .gpv-map {
    height: 70vh;
    width: auto;
    max-width: 100%;
    display: block;
    background: #f8fafc;
    border-radius: 12px;
  }
  .gpv-legend {
    padding: 10px 14px 14px;
    border-top: 1px solid #e5e7eb;
    background: #ffffff;
  }
  .gpv-legend-title {
    font-size: 12px;
    font-weight: 700;
    color: #111827;
    margin-bottom: 8px;
  }
  .gpv-legend-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 8px 16px;
  }
  .gpv-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #374151;
    white-space: nowrap;
    min-width: 0;
  }
  .swatch {
    width: 18px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid rgba(0,0,0,0.15);
    display: inline-block;
    flex: 0 0 auto;
  }
  .gpv-tooltip {
    position: fixed;
    pointer-events: none;
    background: rgba(17, 24, 39, 0.95);
    color: #fff;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 12px;
    opacity: 0;
    transition: opacity 0.1s ease;
    z-index: 10000;
  }
  .province {
    stroke: rgba(0,0,0,0.2);
    stroke-width: .6px;
    cursor: default;
  }
  .province:hover {
    stroke: #111827;
    stroke-width: 1;
  }
      `}</style>

      <div className="gpv-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gpv-header">
          <h3 className="gpv-title">
            {selectedEvent?.title ||
              eventObj?.title ||
              "แผนที่ประเทศไทย — สรุปผลโหวตตามจังหวัด"}
          </h3>
          <button className="gpv-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="gpv-map-wrap">
          <svg
            ref={svgRef}
            className="gpv-map"
            viewBox="0 0 900 1200"
            preserveAspectRatio="xMidYMid meet"
            aria-label="Thailand provinces map"
          />
        </div>

        <div className="gpv-legend">
          <div className="gpv-legend-title">สีแรเงาตามผู้ชนะ</div>
          <div className="gpv-legend-grid">
            <div className="gpv-item">
              <span className="swatch" style={{ background: SHADE_YES_BLUE }} />
              เห็นด้วย (ผู้ชนะ)
            </div>
            <div className="gpv-item">
              <span className="swatch" style={{ background: SHADE_NO_RED }} />
              ไม่เห็นด้วย (ผู้ชนะ)
            </div>
            <div className="gpv-item">
              <span
                className="swatch"
                style={{ background: SHADE_NOVOTE_GREEN }}
              />
              ไม่ลงคะแนน (ผู้ชนะ)
            </div>
            <div className="gpv-item">
              <span
                className="swatch"
                style={{ background: SHADE_OTHER_GRAY }}
              />
              อื่น ๆ / งดออกเสียง (ผู้ชนะ)
            </div>
            <div className="gpv-item">
              <span
                className="swatch"
                style={{ background: SHADE_TIE_PURPLE }}
              />
              เสมอ / ผสม
            </div>
            <div className="gpv-item">
              <span className="swatch" style={{ background: SHADE_NODATA }} />
              ไม่มีข้อมูล
            </div>
          </div>
        </div>

        <div ref={tooltipRef} className="gpv-tooltip" />
      </div>
    </div>
  );
}
import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface EuroMillionDraw {
  draw_date: string;
  year: number;
  num_1: number;
  num_2: number;
  num_3: number;
  num_4: number;
  num_5: number;
  bonus_1: number;
  bonus_2: number;
  numbers_raw: string;
  bonus_raw: string;
  jackpot: string;
  source_url: string;
}

interface RolledUpStats {
  normalized_weights_main?: Record<string, number>;
  normalized_weights_star?: Record<string, number>;
}

interface NumberRecommendation {
  main_numbers: number[];
  star_numbers: number[];
  rationale?: string;
}

function Pill({ label, gold = false, ring = false }: { label: string; gold?: boolean; ring?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: "50%", marginRight: 4,
      background: gold ? "#f59e0b" : "#2563eb", color: gold ? "#1e293b" : "#fff",
      fontWeight: 700, fontSize: 12, boxShadow: ring ? "0 0 0 2px #93c5fd" : undefined
    }}>{label}</span>
  );
}

export default function App() {
  const [tab, setTab] = useState<"charts" | "history" | "rates" | "rec">("charts");
  const [draws, setDraws] = useState<EuroMillionDraw[]>([]);
  const [rolledUp, setRolledUp] = useState<RolledUpStats | null>(null);
  const [rec, setRec] = useState<NumberRecommendation | null>(null);
  const [lookback, setLookback] = useState<"all" | "200" | "100" | "50">("all");
  const [preset, setPreset] = useState<"balanced" | "hot" | "cold" | "theoretical">("balanced");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadAll = async (p = preset, lb = lookback) => {
    setLoading(true);
    setError("");
    try {
      const days = lb === "all" ? 10000 : parseInt(lb, 10) * 4;
      const [allDraws, rolledRaw, recRaw] = await Promise.all([
        invoke("get_all_draws") as Promise<EuroMillionDraw[]>,
        invoke("get_rolled_up_stats") as Promise<string>,
        invoke("get_recommendation", { modelPreset: p, lookbackDays: days }) as Promise<string>,
      ]);
      setDraws(allDraws || []);
      setRolledUp(rolledRaw ? JSON.parse(rolledRaw) : null);
      setRec(recRaw ? JSON.parse(recRaw) : null);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message || JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(preset, lookback); }, [preset, lookback]);

  useEffect(() => {
    setStatus("Checking LottoROI for new draws...");
    invoke("scrape_new_draws")
      .then((msg: any) => {
        const textMsg = typeof msg === "string" ? msg : "Checked for new draws";
        if (!textMsg.includes("Added 0")) {
          setStatus("Auto-update: " + textMsg);
          loadAll();
        } else {
          setStatus("Auto-check: " + textMsg + " (up to date)");
        }
      })
      .catch(() => {
        setStatus("Auto-check skipped (offline)");
      });
  }, []);

  const windowDraws = useMemo(() => (lookback === "all" ? draws : draws.slice(0, parseInt(lookback, 10))), [draws, lookback]);

  const analytics = useMemo(() => {
    const src = windowDraws.length ? windowDraws : draws;
    const recent = draws.slice(0, 50);
    const tot = src.length || 1;
    const rTot = recent.length || 1;
    const mainRows = Array.from({ length: 50 }, (_, i) => {
      const n = i + 1;
      const count = src.filter(d => [d.num_1, d.num_2, d.num_3, d.num_4, d.num_5].includes(n)).length;
      const rCount = recent.filter(d => [d.num_1, d.num_2, d.num_3, d.num_4, d.num_5].includes(n)).length;
      const last = draws.findIndex(d => [d.num_1, d.num_2, d.num_3, d.num_4, d.num_5].includes(n));
      const gap = last === -1 ? draws.length : last;
      const emp = (count / tot) * 100;
      return { n, count, emp, recRate: (rCount / rTot) * 100, gap, avgGap: count ? tot / count : tot, fair: 10.0, weight: rolledUp?.normalized_weights_main?.[String(n)] ?? emp / 5 };
    });
    const starRows = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const count = src.filter(d => d.bonus_1 === n || d.bonus_2 === n).length;
      const rCount = recent.filter(d => d.bonus_1 === n || d.bonus_2 === n).length;
      const last = draws.findIndex(d => d.bonus_1 === n || d.bonus_2 === n);
      const gap = last === -1 ? draws.length : last;
      const emp = (count / tot) * 100;
      return { n, count, emp, recRate: (rCount / rTot) * 100, gap, avgGap: count ? tot / count : tot, fair: 16.67, weight: rolledUp?.normalized_weights_star?.[String(n)] ?? emp / 2 };
    });
    return { mainRows, starRows };
  }, [draws, windowDraws, rolledUp]);

  const nextDraw = useMemo(() => {
    const latest = draws?.draw_date;
    const base = latest ? new Date(latest + "T12:00:00") : new Date();
    for (let i = 1; i <= 7; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      if (d.getDay() === 2 || d.getDay() === 5) return d.toISOString().slice(0, 10);
    }
    return "Next Tue / Fri";
  }, [draws]);

  const visibleDraws = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? windowDraws.filter(d => d.draw_date.includes(q) || [d.num_1, d.num_2, d.num_3, d.num_4, d.num_5].join(" ").includes(q)) : windowDraws;
    return [...list].sort((a, b) => sortAsc ? a.draw_date.localeCompare(b.draw_date) : b.draw_date.localeCompare(a.draw_date));
  }, [windowDraws, search, sortAsc]);

  const handleScrape = async () => {
    setLoading(true); setError(""); setStatus("Checking LottoROI...");
    try {
      const msg = await invoke("scrape_new_draws") as string;
      setStatus(msg); await loadAll();
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] as any;
    if (!f) return;
    if (f.path) {
      setLoading(true); setError("");
      try {
        const msg = await invoke("import_csv", { file_path: f.path }) as string;
        setStatus(msg); await loadAll();
      } catch (err: any) { setError(String(err)); }
      finally { setLoading(false); }
    } else setStatus("Selected: " + f.name);
  };

  const recMain = rec?.main_numbers || [];
  const recStars = rec?.star_numbers || [];

  return (
    <div style={{ padding: 20, fontFamily: "-apple-system, sans-serif", color: "#0f172a", background: "#f8fafc", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>EuroMillions Predictor</h1>
          <div style={{ fontSize: 13, color: "#475569" }}>
            {draws.length ? `${draws.length.toLocaleString()} draws (${draws[draws.length - 1]?.draw_date} to ${draws?.draw_date}) • Next Draw: ${nextDraw}` : "Loading..."}
          </div>
        </div>
        {recMain.length > 0 && (
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 12px" }}>
            {recMain.map(n => <Pill key={n} label={String(n).padStart(2, "0")} ring />)}
            {recStars.map(s => <Pill key={s} label={"★" + s} gold />)}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "#fff", padding: "10px 14px", borderRadius: 10, border: "1px solid #e2e8f0", marginBottom: 14 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Lookback: <select value={lookback} onChange={e => setLookback(e.target.value as any)}><option value="all">All ({draws.length})</option><option value="200">Last 200</option><option value="100">Last 100</option><option value="50">Last 50</option></select></label>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Model: <select value={preset} onChange={e => setPreset(e.target.value as any)}><option value="balanced">Balanced</option><option value="hot">Hot</option><option value="cold">Cold</option><option value="theoretical">Theoretical</option></select></label>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
        <button onClick={() => fileRef.current?.click()} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#14b8a6", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Import CSV</button>
        <button onClick={handleScrape} disabled={loading} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#f59e0b", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{loading ? "Working..." : "Scrape New Draws"}</button>
      </div>

      {status && <div style={{ background: "#ecfdf5", color: "#065f46", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{status}</div>}
      {error && <div style={{ background: "#fef2f2", color: "#991b1b", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["charts", "1. Graphical Charts"], ["history", "2. History Table"], ["rates", "3. Rolled-Up Rates"], ["rec", "4. Recommendations"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 13px", borderRadius: 8, border: "1px solid #cbd5e1", background: tab === k ? "#2563eb" : "#fff", color: tab === k ? "#fff" : "#334155", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>{lbl}</button>
        ))}
      </div>

      {tab === "charts" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0", maxHeight: 480, overflowY: "auto" }}>
            <h3 style={{ marginTop: 0, color: "#1d4ed8" }}>Main Numbers (1–50)</h3>
            {analytics.mainRows.map(r => (
              <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, background: recMain.includes(r.n) ? "#eff6ff" : undefined }}>
                <span style={{ width: 24, fontSize: 12, fontWeight: 700 }}>{String(r.n).padStart(2, "0")}</span>
                <div style={{ flex: 1, height: 12, background: "#e2e8f0", borderRadius: 4 }}><div style={{ width: `${Math.min(100, r.emp * 6)}%`, height: "100%", background: recMain.includes(r.n) ? "#1d4ed8" : "#3b82f6", borderRadius: 4 }} /></div>
                <span style={{ width: 105, fontSize: 11, textAlign: "right" }}>{r.emp.toFixed(1)}% (50d: {r.recRate.toFixed(0)}%)</span>
              </div>
            ))}
          </div>
          <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <h3 style={{ marginTop: 0, color: "#d97706" }}>Lucky Stars (1–12)</h3>
            {analytics.starRows.map(r => (
              <div key={r.n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, background: recStars.includes(r.n) ? "#fffbeb" : undefined }}>
                <span style={{ width: 24, fontSize: 12, fontWeight: 700 }}>★{r.n}</span>
                <div style={{ flex: 1, height: 14, background: "#e2e8f0", borderRadius: 4 }}><div style={{ width: `${Math.min(100, r.emp * 3.5)}%`, height: "100%", background: "#f59e0b", borderRadius: 4 }} /></div>
                <span style={{ width: 105, fontSize: 11, textAlign: "right" }}>{r.emp.toFixed(1)}% (50d: {r.recRate.toFixed(0)}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input placeholder="Filter by date or number..." value={search} onChange={e => setSearch(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", width: 240 }} />
            <button onClick={() => setSortAsc(!sortAsc)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1" }}>{sortAsc ? "Oldest First ↑" : "Newest First ↓"}</button>
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f1f5f9", textAlign: "left" }}><th style={{ padding: 8 }}>Date</th><th style={{ padding: 8 }}>Main Numbers</th><th style={{ padding: 8 }}>Lucky Stars</th><th style={{ padding: 8 }}>Jackpot</th></tr></thead>
              <tbody>
                {visibleDraws.slice(0, 250).map((d, i) => (
                  <tr key={d.draw_date + i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{d.draw_date}</td>
                    <td style={{ padding: 6 }}>{[d.num_1, d.num_2, d.num_3, d.num_4, d.num_5].map(n => <Pill key={n} label={String(n).padStart(2, "0")} />)}</td>
                    <td style={{ padding: 6 }}>{[d.bonus_1, d.bonus_2].map(s => <Pill key={s} label={"★" + s} gold />)}</td>
                    <td style={{ padding: 6 }}>{d.jackpot || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "rates" && (
        <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0", maxHeight: 520, overflowY: "auto" }}>
          <p style={{ fontSize: 12, color: "#475569", marginTop: 0 }}>Fair single-draw probability: 10.00% (5/50) main balls; 16.67% (2/12) Lucky Stars. Draws are independent random events.</p>
          <h3>Main Numbers (1–50)</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 20 }}>
            <thead><tr style={{ background: "#f1f5f9", textAlign: "left" }}><th style={{ padding: 6 }}>Ball</th><th style={{ padding: 6 }}>Count</th><th style={{ padding: 6 }}>Empirical %</th><th style={{ padding: 6 }}>Last 50 %</th><th style={{ padding: 6 }}>Gap</th><th style={{ padding: 6 }}>Avg Gap</th><th style={{ padding: 6 }}>Fair %</th><th style={{ padding: 6 }}>Model Wt %</th></tr></thead>
            <tbody>{analytics.mainRows.map(r => <tr key={r.n} style={{ borderBottom: "1px solid #e2e8f0" }}><td style={{ padding: 6 }}>{r.n}</td><td style={{ padding: 6 }}>{r.count}</td><td style={{ padding: 6 }}>{r.emp.toFixed(2)}%</td><td style={{ padding: 6 }}>{r.recRate.toFixed(2)}%</td><td style={{ padding: 6 }}>{r.gap}</td><td style={{ padding: 6 }}>{r.avgGap.toFixed(1)}</td><td style={{ padding: 6 }}>{r.fair.toFixed(2)}%</td><td style={{ padding: 6 }}>{r.weight.toFixed(2)}%</td></tr>)}</tbody>
          </table>
          <h3>Lucky Stars (1–12)</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ background: "#f1f5f9", textAlign: "left" }}><th style={{ padding: 6 }}>Star</th><th style={{ padding: 6 }}>Count</th><th style={{ padding: 6 }}>Empirical %</th><th style={{ padding: 6 }}>Last 50 %</th><th style={{ padding: 6 }}>Gap</th><th style={{ padding: 6 }}>Avg Gap</th><th style={{ padding: 6 }}>Fair %</th><th style={{ padding: 6 }}>Model Wt %</th></tr></thead>
            <tbody>{analytics.starRows.map(r => <tr key={r.n} style={{ borderBottom: "1px solid #e2e8f0" }}><td style={{ padding: 6 }}>★{r.n}</td><td style={{ padding: 6 }}>{r.count}</td><td style={{ padding: 6 }}>{r.emp.toFixed(2)}%</td><td style={{ padding: 6 }}>{r.recRate.toFixed(2)}%</td><td style={{ padding: 6 }}>{r.gap}</td><td style={{ padding: 6 }}>{r.avgGap.toFixed(1)}</td><td style={{ padding: 6 }}>{r.fair.toFixed(2)}%</td><td style={{ padding: 6 }}>{r.weight.toFixed(2)}%</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {tab === "rec" && (
        <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0" }}>
          <h3 style={{ marginTop: 0 }}>Recommended Picks for {nextDraw} ({preset.toUpperCase()})</h3>
          <div style={{ marginBottom: 10 }}>{recMain.map(n => <Pill key={n} label={String(n).padStart(2, "0")} ring />)}{recStars.map(s => <Pill key={s} label={"★" + s} gold />)}</div>
          {rec?.rationale && <p style={{ fontSize: 13 }}>{rec.rationale}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
            {recMain.map(n => { const m = analytics.mainRows.find(r => r.n === n); return <div key={n} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 8, padding: 8, fontSize: 12 }}><strong>Ball #{n}</strong>: Drawn {m?.count}x ({m?.emp.toFixed(2)}%), Last 50: {m?.recRate.toFixed(1)}%, Gap: {m?.gap} (Avg {m?.avgGap.toFixed(1)})</div>; })}
            {recStars.map(s => { const m = analytics.starRows.find(r => r.n === s); return <div key={s} style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: 8, fontSize: 12 }}><strong>Star ★{s}</strong>: Drawn {m?.count}x ({m?.emp.toFixed(2)}%), Last 50: {m?.recRate.toFixed(1)}%, Gap: {m?.gap} (Avg {m?.avgGap.toFixed(1)})</div>; })}
          </div>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 0 }}>Disclaimer: Every EuroMillions draw is an independent random event; historical frequencies and gaps rank candidates analytically and do not alter true draw odds.</p>
        </div>
      )}
    </div>
  );
}

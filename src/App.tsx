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
  target_draw_date?: string;
  model_preset?: string;
  effective_model?: string;
}

interface PredictionCandidate {
  model_preset: string;
  main_numbers: number[];
  star_numbers: number[];
  rationale: string;
}

interface PredictionHistoryItem {
  record: {
    target_draw_date: string;
    generated_at: string;
    lookback_days: number;
    candidates: PredictionCandidate[];
  };
  actual_draw: {
    draw_date: string;
    main_numbers: number[];
    star_numbers: number[];
  } | null;
}

enum TauriCommand {
  GetAllDraws = "get_all_draws",
  GetRolledUpStats = "get_rolled_up_stats",
  GetRecommendation = "get_recommendation",
  GetPredictionHistory = "get_prediction_history",
  ScrapeNewDraws = "scrape_new_draws",
  AddDraw = "add_draw",
  ImportCsv = "import_csv",
  DeleteDraw = "delete_draw",
  ListDuplicateDraws = "list_duplicate_draws",
  DeleteDrawRows = "delete_draw_rows",
  RevertDraws = "revert_draws",
  UpdateDraw = "update_draw",
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
  const [tab, setTab] = useState<"charts" | "history" | "rates" | "rec" | "predictions">("charts");
  const [draws, setDraws] = useState<EuroMillionDraw[]>([]);
  const [predictionHistory, setPredictionHistory] = useState<PredictionHistoryItem[]>([]);
  const [rolledUp, setRolledUp] = useState<RolledUpStats | null>(null);
  const [rec, setRec] = useState<NumberRecommendation | null>(null);
  const [lookback, setLookback] = useState<"all" | "200" | "100" | "50">("all");
  const [preset, setPreset] = useState<"balanced" | "hot" | "cold" | "theoretical" | "adaptive">("balanced");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [editDraw, setEditDraw] = useState<EuroMillionDraw | null>(null);
  const [editForm, setEditForm] = useState<{
    num_1: number; num_2: number; num_3: number; num_4: number; num_5: number;
    bonus_1: number; bonus_2: number; jackpot: string;
  } | null>(null);
  const [showDedupeDialog, setShowDedupeDialog] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualEntryForm, setManualEntryForm] = useState<{
    draw_date: string;
    num_1: number; num_2: number; num_3: number; num_4: number; num_5: number;
    bonus_1: number; bonus_2: number; jackpot: string;
  }>({
    draw_date: "",
    num_1: 0,
    num_2: 0,
    num_3: 0,
    num_4: 0,
    num_5: 0,
    bonus_1: 0,
    bonus_2: 0,
    jackpot: "",
  });
  const [duplicateGroups, setDuplicateGroups] = useState<Array<{
    draw_date: string;
    rows: Array<{
      row_index: number;
      draw_date: string;
      num_1: number; num_2: number; num_3: number; num_4: number; num_5: number;
      bonus_1: number; bonus_2: number;
      numbers_raw: string; bonus_raw: string; jackpot: string;
    }>;
  }>>([]);
  const [selectedDuplicateRows, setSelectedDuplicateRows] = useState<Set<number>>(new Set());

  const loadAll = async (p = preset, lb = lookback) => {
    setLoading(true);
    setError("");
    try {
      const days = lb === "all" ? 10000 : parseInt(lb, 10) * 4;
      const [allDraws, rolledRaw, recRaw] = await Promise.all([
        invoke(TauriCommand.GetAllDraws) as Promise<EuroMillionDraw[]>,
        invoke(TauriCommand.GetRolledUpStats) as Promise<string>,
        invoke(TauriCommand.GetRecommendation, { modelPreset: p, lookbackDays: days }) as Promise<string>,
      ]);
      const history = await invoke(TauriCommand.GetPredictionHistory) as PredictionHistoryItem[];
      setDraws(allDraws || []);
      setRolledUp(rolledRaw ? JSON.parse(rolledRaw) : null);
      setRec(recRaw ? JSON.parse(recRaw) : null);
      setPredictionHistory(history || []);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message || JSON.stringify(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(preset, lookback); }, [preset, lookback]);

  useEffect(() => {
    setStatus("Checking LottoROI for new draws...");
    invoke(TauriCommand.ScrapeNewDraws)
      .then(async (msg: unknown) => {
        const textMsg = typeof msg === "string" ? msg : "Checked for new draws";
        setStatus("Auto-update: " + textMsg);
        await loadAll();
      })
      .catch((e: unknown) => {
        setError(typeof e === "string" ? e : String(e));
        setStatus("");
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

  const scoredPredictionRecords = useMemo(() => {
    const earliestByDate = new Map<string, PredictionHistoryItem>();
    [...predictionHistory]
      .sort((left, right) => left.record.generated_at.localeCompare(right.record.generated_at))
      .forEach(item => {
        if (item.actual_draw && !earliestByDate.has(item.record.target_draw_date)) {
          earliestByDate.set(item.record.target_draw_date, item);
        }
      });
    return [...earliestByDate.values()];
  }, [predictionHistory]);

  const modelScores = useMemo(() => ["balanced", "hot", "cold", "theoretical"].map(model => {
    const scores = scoredPredictionRecords.flatMap(item => {
      const candidate = item.record.candidates.find(entry => entry.model_preset === model);
      if (!candidate || !item.actual_draw) return [];
      const mainHits = candidate.main_numbers.filter(number => item.actual_draw!.main_numbers.includes(number)).length;
      const starHits = candidate.star_numbers.filter(number => item.actual_draw!.star_numbers.includes(number)).length;
      return [mainHits + starHits];
    });
    return {
      model,
      draws: scores.length,
      average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
    };
  }), [scoredPredictionRecords]);

  const adaptiveLeader = modelScores
    .filter(score => score.draws >= 10)
    .sort((left, right) => right.average - left.average)[0];

  const handleScrape = async () => {
    setLoading(true); setError(""); setStatus("Checking LottoROI...");
    try {
      const msg = await invoke(TauriCommand.ScrapeNewDraws) as string;
      setStatus(msg); await loadAll();
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
  };

  const handleManualEntry = async () => {
    setStatus("");
    setError("");
    setLoading(true);
    try {
      const msg = await invoke(TauriCommand.AddDraw, {
        drawDate: manualEntryForm.draw_date,
        num1: manualEntryForm.num_1,
        num2: manualEntryForm.num_2,
        num3: manualEntryForm.num_3,
        num4: manualEntryForm.num_4,
        num5: manualEntryForm.num_5,
        bonus1: manualEntryForm.bonus_1,
        bonus2: manualEntryForm.bonus_2,
        jackpot: manualEntryForm.jackpot,
      }) as string;
      setStatus(msg);
      setShowManualEntry(false);
      setManualEntryForm({
        draw_date: "",
        num_1: 0,
        num_2: 0,
        num_3: 0,
        num_4: 0,
        num_5: 0,
        bonus_1: 0,
        bonus_2: 0,
        jackpot: "",
      });
      await loadAll();
    } catch (e: any) {
      setError(String(e));
    } finally { setLoading(false); }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] as any;
    if (!f) return;
    if (f.path) {
      setLoading(true); setError("");
      try {
        const msg = await invoke(TauriCommand.ImportCsv, { filePath: f.path }) as string;
        setStatus(msg); await loadAll();
      } catch (err: any) { setError(String(err)); }
      finally { setLoading(false); }
    } else setStatus("Selected: " + f.name);
  };

  const handleDeleteDraw = async (draw_date: string) => {
    if (!window.confirm(`Delete all row(s) for draw date ${draw_date}?`)) return;
    setLoading(true); setError(""); setStatus("");
    try {
      const msg = await invoke(TauriCommand.DeleteDraw, { drawDate: draw_date }) as string;
      setStatus(msg); await loadAll();
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
  };

  const handleDedupeDraws = async () => {
    setLoading(true); setError("");
    try {
      const raw = await invoke(TauriCommand.ListDuplicateDraws) as string;
      const groups = JSON.parse(raw || "[]") as Array<{
        draw_date: string;
        rows: Array<{
          row_index: number;
          draw_date: string;
          num_1: number; num_2: number; num_3: number; num_4: number; num_5: number;
          bonus_1: number; bonus_2: number;
          numbers_raw: string; bonus_raw: string; jackpot: string;
        }>;
      }>;
      setDuplicateGroups(groups);
      setSelectedDuplicateRows(new Set());
      if (groups.length === 0) {
        setStatus("No duplicate rows found.");
        setLoading(false);
        return;
      }
      setShowDedupeDialog(true);
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
  };

  const handleToggleDuplicateRow = (rowIndex: number) => {
    setSelectedDuplicateRows(prev => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  const handleSelectAllDuplicateRows = (select: boolean) => {
    const duplicateIndices = duplicateGroups.flatMap(g =>
      select ? g.rows.slice(1).map(r => r.row_index) : []
    );
    setSelectedDuplicateRows(new Set(duplicateIndices));
  };

  const handleConfirmDedupe = async () => {
    if (selectedDuplicateRows.size === 0) {
      setError("Please select at least one row to delete.");
      return;
    }
    setLoading(true); setError(""); setStatus("Deleting selected rows...");
    try {
      const msg = await invoke(TauriCommand.DeleteDrawRows, { rowIndices: Array.from(selectedDuplicateRows) }) as string;
      setStatus(msg);
      setSelectedDuplicateRows(new Set());
      setShowDedupeDialog(false);
      await loadAll();
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
  };

  const handleRevertDraws = async () => {
    if (!window.confirm("Revert all draw data to the last backup? This cannot be undone.")) return;
    setLoading(true); setError(""); setStatus("Reverting...");
    try {
      const msg = await invoke(TauriCommand.RevertDraws) as string;
      setStatus(msg); await loadAll();
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
  };

  const handleSaveDraw = async () => {
    if (!editDraw || !editForm) return;
    setLoading(true); setError("");
    try {
      const msg = await invoke(TauriCommand.UpdateDraw, {
        drawDate: editDraw.draw_date,
        num1: editForm.num_1,
        num2: editForm.num_2,
        num3: editForm.num_3,
        num4: editForm.num_4,
        num5: editForm.num_5,
        bonus1: editForm.bonus_1,
        bonus2: editForm.bonus_2,
        jackpot: editForm.jackpot,
      }) as string;
      setStatus(msg);
      setEditDraw(null);
      setEditForm(null);
      await loadAll();
    } catch (e: any) { setError(String(e)); setStatus(""); }
    finally { setLoading(false); }
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
        <label style={{ fontSize: 13, fontWeight: 600 }}>Model: <select value={preset} onChange={e => setPreset(e.target.value as typeof preset)}><option value="balanced">Balanced</option><option value="hot">Hot</option><option value="cold">Cold</option><option value="theoretical">Theoretical</option><option value="adaptive">Adaptive (learned)</option></select></label>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
        <button onClick={() => fileRef.current?.click()} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#14b8a6", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Import CSV</button>
        <button onClick={() => setShowManualEntry(true)} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#14b8a6", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Manual Entry</button>
        <button onClick={handleScrape} disabled={loading} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#f59e0b", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{loading ? "Working..." : "Scrape New Draws"}</button>

{showManualEntry && (
  <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0", marginTop: 10, maxHeight: 400, overflowY: "auto" }}>
    <h3 style={{ marginTop: 0, marginBottom: 8 }}>Add New Draw Manually</h3>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, marginBottom: 8 }}>
      <input type="date" value={manualEntryForm.draw_date} onChange={e => setManualEntryForm({ ...manualEntryForm, draw_date: e.target.value })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="50" value={manualEntryForm.num_1} onChange={e => setManualEntryForm({ ...manualEntryForm, num_1: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="50" value={manualEntryForm.num_2} onChange={e => setManualEntryForm({ ...manualEntryForm, num_2: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="50" value={manualEntryForm.num_3} onChange={e => setManualEntryForm({ ...manualEntryForm, num_3: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="50" value={manualEntryForm.num_4} onChange={e => setManualEntryForm({ ...manualEntryForm, num_4: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="50" value={manualEntryForm.num_5} onChange={e => setManualEntryForm({ ...manualEntryForm, num_5: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="12" value={manualEntryForm.bonus_1} onChange={e => setManualEntryForm({ ...manualEntryForm, bonus_1: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
      <input type="number" min="1" max="12" value={manualEntryForm.bonus_2} onChange={e => setManualEntryForm({ ...manualEntryForm, bonus_2: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
    </div>
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: "block", fontSize: 12, color: "#475569", marginBottom: 4 }}>Jackpot</label>
      <input type="text" value={manualEntryForm.jackpot} onChange={e => setManualEntryForm({ ...manualEntryForm, jackpot: e.target.value })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", width: "100%" }} />
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={() => { setShowManualEntry(false); setManualEntryForm({ draw_date: "", num_1: 0, num_2: 0, num_3: 0, num_4: 0, num_5: 0, bonus_1: 0, bonus_2: 0, jackpot: "" }) }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
      <button onClick={handleManualEntry} disabled={loading} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>Save</button>
    </div>
  </div>
)}
      </div>

      {status && <div style={{ background: "#ecfdf5", color: "#065f46", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{status}</div>}
      {error && <div style={{ background: "#fef2f2", color: "#991b1b", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["charts", "1. Graphical Charts"], ["history", "2. History Table"], ["rates", "3. Rolled-Up Rates"], ["rec", "4. Recommendations"], ["predictions", "5. Prediction Log"]] as const).map(([k, lbl]) => (
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
            <button onClick={handleDedupeDraws} disabled={loading} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: loading ? "#e2e8f0" : "#f59e0b", color: "#fff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>Remove Duplicate Rows</button>
            <button onClick={handleRevertDraws} disabled={loading} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: loading ? "#e2e8f0" : "#dc2626", color: "#fff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>Revert to Backup</button>
          </div>
          <div style={{ maxHeight: 460, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f1f5f9", textAlign: "left" }}><th style={{ padding: 8 }}>Date</th><th style={{ padding: 8 }}>Main Numbers</th><th style={{ padding: 8 }}>Lucky Stars</th><th style={{ padding: 8 }}>Jackpot</th><th style={{ padding: 8 }}>Actions</th></tr></thead>
              <tbody>
                {visibleDraws.slice(0, 250).map((d, i) => (
                  <tr key={d.draw_date + "-" + i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{d.draw_date}</td>
                    <td style={{ padding: 6 }}>{[d.num_1, d.num_2, d.num_3, d.num_4, d.num_5].map(n => <Pill key={n} label={String(n).padStart(2, "0")} />)}</td>
                    <td style={{ padding: 6 }}>{[d.bonus_1, d.bonus_2].map(s => <Pill key={s} label={"★" + s} gold />)}</td>
                    <td style={{ padding: 6 }}>{d.jackpot || "—"}</td>
                    <td style={{ padding: 6 }}>
                      <button onClick={() => { setEditForm({ num_1: d.num_1, num_2: d.num_2, num_3: d.num_3, num_4: d.num_4, num_5: d.num_5, bonus_1: d.bonus_1, bonus_2: d.bonus_2, jackpot: d.jackpot || "" }); setEditDraw(d); }} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #cbd5e1", background: "#fff", fontSize: 11, cursor: "pointer", marginRight: 4 }}>Edit</button>
                      <button onClick={() => handleDeleteDraw(d.draw_date)} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #fca5a5", background: "#fff", color: "#b91c1c", fontSize: 11, cursor: "pointer" }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editDraw && editForm && (
        <div style={{ background: "#fff", padding: 14, borderRadius: 10, border: "1px solid #e2e8f0", marginTop: 10 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Edit draw {editDraw.draw_date}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, marginBottom: 8 }}>
            <input type="number" min="1" max="50" value={editForm.num_1} onChange={e => setEditForm({ ...editForm, num_1: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
            <input type="number" min="1" max="50" value={editForm.num_2} onChange={e => setEditForm({ ...editForm, num_2: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
            <input type="number" min="1" max="50" value={editForm.num_3} onChange={e => setEditForm({ ...editForm, num_3: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
            <input type="number" min="1" max="50" value={editForm.num_4} onChange={e => setEditForm({ ...editForm, num_4: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
            <input type="number" min="1" max="50" value={editForm.num_5} onChange={e => setEditForm({ ...editForm, num_5: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
            <input type="number" min="1" max="12" value={editForm.bonus_1} onChange={e => setEditForm({ ...editForm, bonus_1: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
            <input type="number" min="1" max="12" value={editForm.bonus_2} onChange={e => setEditForm({ ...editForm, bonus_2: Number(e.target.value) || 0 })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1" }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontSize: 12, color: "#475569", marginBottom: 4 }}>Jackpot</label>
            <input type="text" value={editForm.jackpot} onChange={e => setEditForm({ ...editForm, jackpot: e.target.value })} style={{ padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", width: "100%" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSaveDraw} disabled={loading} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "#2563eb", color: "#fff", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>Save</button>
            <button onClick={() => { setEditDraw(null); setEditForm(null); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {showDedupeDialog && (
        <div style={{ background: "#fff", padding: 16, borderRadius: 10, border: "1px solid #e2e8f0", marginTop: 10, maxHeight: 500, overflowY: "auto" }}>
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Remove Duplicate Rows</h3>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>Select the duplicate row(s) to delete. At least one row must remain per date.</p>
          {duplicateGroups.map((g, gi) => (
            <div key={g.draw_date} style={{ marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 6, padding: 10, background: "#f8fafc" }}>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>{g.draw_date} — {g.rows.length} rows</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => handleSelectAllDuplicateRows(true)} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 4, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Select Duplicates</button>
                <button onClick={() => handleSelectAllDuplicateRows(false)} style={{ padding: "2px 8px", fontSize: 11, borderRadius: 4, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer" }}>Select None</button>
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {g.rows.map(r => {
                  const isSelected = selectedDuplicateRows.has(r.row_index);
                  const mainNums = [r.num_1, r.num_2, r.num_3, r.num_4, r.num_5].map(n => String(n).padStart(2, "0")).join(" · ");
                  const starNums = [r.bonus_1, r.bonus_2].map(s => "★" + s).join(" · ");
                  return (
                    <div key={r.row_index} style={{ display: "flex", alignItems: "center", gap: 8, padding: 4, borderRadius: 4, background: isSelected ? "#eff6ff" : "transparent" }}>
                      <input type="checkbox" checked={isSelected} onChange={() => handleToggleDuplicateRow(r.row_index)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                      <span style={{ fontSize: 12, flex: 1 }}>{mainNums}  |  {starNums}  |  Jackpot: {r.jackpot || "—"}</span>
                      <span style={{ fontSize: 11, color: "#64748b" }}>(row #{r.row_index + 1})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => { setShowDedupeDialog(false); setSelectedDuplicateRows(new Set()); }} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleConfirmDedupe} disabled={selectedDuplicateRows.size === 0 || loading} style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: selectedDuplicateRows.size === 0 ? "#94a3b8" : "#dc2626", color: "#fff", fontWeight: 600, cursor: selectedDuplicateRows.size === 0 || loading ? "not-allowed" : "pointer" }}>Delete Selected</button>
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
          <h3 style={{ marginTop: 0 }}>Recommended Picks for {rec?.target_draw_date || nextDraw} ({preset.toUpperCase()})</h3>
          <div style={{ marginBottom: 10 }}>{recMain.map(n => <Pill key={n} label={String(n).padStart(2, "0")} ring />)}{recStars.map(s => <Pill key={s} label={"★" + s} gold />)}</div>
          {rec?.effective_model && preset === "adaptive" && <p style={{ fontSize: 13 }}>Adaptive selection: <strong>{rec.effective_model}</strong></p>}
          {rec?.rationale && <p style={{ fontSize: 13 }}>{rec.rationale}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
            {recMain.map(n => { const m = analytics.mainRows.find(r => r.n === n); return <div key={n} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 8, padding: 8, fontSize: 12 }}><strong>Ball #{n}</strong>: Drawn {m?.count}x ({m?.emp.toFixed(2)}%), Last 50: {m?.recRate.toFixed(1)}%, Gap: {m?.gap} (Avg {m?.avgGap.toFixed(1)})</div>; })}
            {recStars.map(s => { const m = analytics.starRows.find(r => r.n === s); return <div key={s} style={{ border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: 8, fontSize: 12 }}><strong>Star ★{s}</strong>: Drawn {m?.count}x ({m?.emp.toFixed(2)}%), Last 50: {m?.recRate.toFixed(1)}%, Gap: {m?.gap} (Avg {m?.avgGap.toFixed(1)})</div>; })}
          </div>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 0 }}>Disclaimer: Every EuroMillions draw is independent and random. Past performance is descriptive, may be noise, and does not change future odds.</p>
        </div>
      )}

      {tab === "predictions" && (
        <div style={{ display: "grid", gap: 14 }}>
          <section style={{ background: "#fff", padding: 16, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Prediction learning log</h2>
            <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 13 }}>
              Each target draw and lookback window is saved once, with all four strategies frozen before the result. Adaptive mode selects the strongest historical average after 10 settled draws; this is a backtest, not evidence of improved odds.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              {[
                ["Snapshots", predictionHistory.length],
                ["Settled draws", scoredPredictionRecords.length],
                ["Adaptive model", adaptiveLeader?.model ?? "Warming up"],
              ].map(([label, value]) => (
                <div key={label} style={{ minWidth: 140, padding: "10px 14px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</div>
                  <strong style={{ display: "block", marginTop: 4, fontSize: 17 }}>{value}</strong>
                </div>
              ))}
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Strategy backtest</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", background: "#f1f5f9" }}>
                  <th style={{ padding: 8 }}>Strategy</th><th style={{ padding: 8 }}>Settled draws</th><th style={{ padding: 8 }}>Average matches / draw</th><th style={{ padding: 8 }}>Random baseline</th>
                </tr></thead>
                <tbody>{modelScores.map(score => (
                  <tr key={score.model} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 8, fontWeight: 600, textTransform: "capitalize" }}>{score.model}</td>
                    <td style={{ padding: 8 }}>{score.draws}</td>
                    <td style={{ padding: 8 }}>{score.draws ? score.average.toFixed(2) : "—"}</td>
                    <td style={{ padding: 8 }}>0.83</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <section style={{ background: "#fff", padding: 16, borderRadius: 10, border: "1px solid #e2e8f0" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Saved predictions</h3>
            {predictionHistory.length === 0 ? <p style={{ color: "#64748b", fontSize: 13 }}>No predictions recorded yet. A snapshot is saved automatically when recommendations are generated.</p> : (
              <div style={{ maxHeight: 480, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ textAlign: "left", background: "#f1f5f9" }}>
                    <th style={{ padding: 8 }}>Target draw</th><th style={{ padding: 8 }}>Generated</th><th style={{ padding: 8 }}>Lookback</th><th style={{ padding: 8 }}>Status / actual result</th><th style={{ padding: 8 }}>Saved model picks</th>
                  </tr></thead>
                  <tbody>{[...predictionHistory].sort((a, b) => b.record.generated_at.localeCompare(a.record.generated_at)).map(item => (
                    <tr key={`${item.record.target_draw_date}-${item.record.lookback_days}`} style={{ borderBottom: "1px solid #e2e8f0", verticalAlign: "top" }}>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>{item.record.target_draw_date}</td>
                      <td style={{ padding: 8, whiteSpace: "nowrap" }}>{item.record.generated_at.slice(0, 10)}</td>
                      <td style={{ padding: 8 }}>{item.record.lookback_days === 10000 ? "All" : item.record.lookback_days}</td>
                      <td style={{ padding: 8, minWidth: 190 }}>
                        {item.actual_draw ? <>
                          <strong style={{ color: "#047857" }}>Settled</strong>
                          <div style={{ marginTop: 4 }}>{item.actual_draw.main_numbers.join(" · ")} / ★{item.actual_draw.star_numbers.join(" · ")}</div>
                          {item.record.candidates.map(candidate => {
                            const mainHits = candidate.main_numbers.filter(number => item.actual_draw!.main_numbers.includes(number)).length;
                            const starHits = candidate.star_numbers.filter(number => item.actual_draw!.star_numbers.includes(number)).length;
                            return <div key={candidate.model_preset} style={{ color: "#475569" }}>{candidate.model_preset}: {mainHits}+{starHits} hits</div>;
                          })}
                        </> : <span style={{ color: "#a16207" }}>Pending result</span>}
                      </td>
                      <td style={{ padding: 8, minWidth: 280 }}>
                        {item.record.candidates.map(candidate => (
                          <div key={candidate.model_preset} style={{ marginBottom: 4 }}>
                            <strong style={{ textTransform: "capitalize" }}>{candidate.model_preset}:</strong>{" "}
                            {candidate.main_numbers.join(" · ")} / ★{candidate.star_numbers.join(" · ")}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

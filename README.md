# EuroMillions Predictor

A standalone, double-clickable **macOS desktop application** built with **Tauri v2, Rust, and React** for exploring historical EuroMillions draw data, frequency analytics, gap metrics, and weighted number recommendations—with zero terminal commands required at runtime.

---

## ✨ Features

- **Pre-Loaded & Persistent Draw Database:** Ships bundled with **1,999 historical EuroMillions draws** (2004–2026) and automatically initializes a writable local store in `~/Library/Application Support/` on first launch so data persists across sessions.
- **Automatic & Manual Result Updates:**
  - **Auto-Check on Startup:** Automatically checks LottoROI in the background when the app opens, displays a live status banner (`Checking LottoROI...`, `up to date`, or `Added X new draws`), and refreshes charts and recommendations if new draws are added.
  - **Manual Scrape & CSV Import:** Trigger a manual check anytime or import/merge custom EuroMillions CSV exports directly from the UI.
- **Four Interactive Analytics Views:**
  1. **Graphical Charts:** Visual draw-rate comparisons across Main Numbers (`1–50`) and Lucky Stars (`1–12`), comparing the selected lookback window against recent 50-draw momentum with recommended picks highlighted.
  2. **History Table:** Searchable and sortable draw history displaying draw dates, styled main number balls, Lucky Star badges, and jackpots.
  3. **Rolled-Up Rates & Probabilities:** Full breakdown of draw counts, empirical draw rates, recent 50-draw rates, current gap (draws since last seen), average gap, theoretical single-draw fair probabilities (`10.00%` main / `16.67%` Lucky Stars), and normalized model weights.
  4. **Recommendations & Explanations:** Generates upcoming Tuesday/Friday draw picks across **Balanced**, **Hot / Momentum**, **Cold / Overdue**, and **Theoretical** presets with per-ball metric cards.
- **Configurable Lookback Windows:** Filter charts and tables dynamically across **All Draws**, **Last 200**, **Last 100**, or **Last 50** draws.

---

## 📦 Installation (macOS)

1. Download the latest **`.dmg`** installer from the [Releases](../../releases) page.
2. Open the `.dmg` file and drag **`EuroMillion Predictor.app`** into your **Applications** folder.
3. Launch **EuroMillion Predictor** from Finder or Spotlight. *(If macOS Gatekeeper warns about an unidentified developer on first launch, right-click the app in Applications and select **Open**.)*

---

## 🛠️ Building from Source

### Prerequisites
- **macOS** (Apple Silicon or Intel)
- **Node.js** (v18+) and **npm**
- **Rust toolchain** (`rustup` / `cargo`)

### Build Commands
```bash
npm install
npx tauri build
```
The compiled `.app` bundle and `.dmg` installer will be generated inside `src-tauri/target/release/bundle/`.

---

## 📁 Project Structure

```text
├── src/
│   ├── App.tsx              # 4-view React dashboard, charts, tables & auto-scrape hook
│   └── main.tsx             # React entry point
├── src-tauri/
│   ├── data/
│   │   └── euromillions_draws.csv   # Bundled historical seed dataset
│   ├── src/
│   │   ├── lib.rs           # Rust data store, LottoROI scraper, stats & scoring commands
│   │   └── main.rs          # Tauri native entry point
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri v2 window & bundle configuration
├── index.html
├── package.json
└── vite.config.ts
```

---

## ℹ️ Statistical Independence Note

Each EuroMillions draw is a physically independent random event. Historical frequencies, gaps, and model weights are provided for analytical exploration and do not alter true mathematical draw probabilities.

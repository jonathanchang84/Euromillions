"""CSV ingestion and normalisation for EuroMillions Predictor."""
import csv
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

APP_NAME = "EuroMillionsPredictor"
USER_DATA_DIR = Path.home() / "Library" / "Application Support" / APP_NAME
BUNDLED_CSV_NAME = "euromillions_all_draws_2004_2026.csv"


def get_user_data_dir() -> Path:
    """Return the user data directory path."""
    return USER_DATA_DIR


def get_draws_csv_path() -> Path:
    """Return the path to the writable draws.csv in user data dir."""
    return USER_DATA_DIR / "draws.csv"


def get_bundled_csv_path() -> Path:
    """Return the path to the bundled seed CSV (frozen or source directory)."""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass) / "data" / BUNDLED_CSV_NAME
    src_dir = Path(__file__).parent.parent / "data"
    return src_dir / BUNDLED_CSV_NAME


def ensure_user_data_dir() -> None:
    """Create user data directory if it doesn't exist; copy bundled CSV on first launch."""
    USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    target_csv = USER_DATA_DIR / "draws.csv"
    bundled_csv = get_bundled_csv_path()
    if not target_csv.exists():
        if bundled_csv.exists():
            shutil.copy2(str(bundled_csv), str(target_csv))
        else:
            target_csv.write_text("")
    else:
        if bundled_csv.exists() and target_csv.stat().st_size == 0:
            shutil.copy2(str(bundled_csv), str(target_csv))


def parse_date(raw: str) -> str:
    """Normalise a date string to YYYY-MM-DD."""
    if not raw:
        return ""
    raw = raw.strip()
    if raw.count("-") >= 2 and raw[:4].isdigit():
        return raw
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%b %d, %Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def parse_main_numbers(raw: str) -> list:
    """Parse main numbers from a raw string like '35 · 37 · 38 · 46 · 48'."""
    if not raw:
        return []
    cleaned = raw.replace("·", ",").replace("•", ",").replace("/", ",")
    parts = [p.strip() for p in cleaned.split(",") if p.strip().isdigit()]
    nums = sorted([int(p) for p in parts if 1 <= int(p) <= 50])
    while len(nums) < 5:
        nums.append(0)
    return nums[:5]


def parse_lucky_stars(raw: str) -> list:
    """Parse Lucky Stars from a raw string like '1 · 2'."""
    if not raw:
        return []
    cleaned = raw.replace("·", ",").replace("•", ",").replace("/", ",")
    parts = [p.strip() for p in cleaned.split(",") if p.strip().isdigit()]
    stars = sorted([int(p) for p in parts if 1 <= int(p) <= 12])
    while len(stars) < 2:
        stars.append(0)
def load_draws_from_csv(csv_path: Path) -> list:
    """Load and normalise draws from a EuroMillions CSV file."""
def write_draws_to_user_csv(draws: list) -> None:
    """Write the normalised draws list to the user's draws.csv."""
    user_csv = get_draws_csv_path()
    USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not draws:
        user_csv.write_text("")
        return
    fieldnames = ["draw_date", "num_1", "num_2", "num_3", "num_4", "num_5",
                  "lucky_star_1", "lucky_star_2", "jackpot", "source_url"]
    with open(user_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for d in draws:
            writer.writerow({
                "draw_date": d["draw_date"],
                "num_1": d["num_1"],
                "num_2": d["num_2"],
                "num_3": d["num_3"],
                "num_4": d["num_4"],
                "num_5": d["num_5"],
                "lucky_star_1": d["lucky_star_1"],
                "lucky_star_2": d["lucky_star_2"],
                "jackpot": d["jackpot"],
                "source_url": d["source_url"],
            })
    ensure_user_data_dir()
    draws = []
    seen_dates = set()
    meipass = getattr(sys, "_MEIPASS", None)
    paths_to_try = []
    if meipass:
        bundled = Path(meipass) / "data" / BUNDLED_CSV_NAME
        if bundled.exists():
            paths_to_try.append(bundled)
    paths_to_try.append(csv_path)
    for csv_path_try in paths_to_try:
        if not csv_path_try.exists():
            continue
        try:
            with open(csv_path_try, "r", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f)
                if not reader.fieldnames:
                    continue
                fieldnames = [fn.strip().lower() for fn in reader.fieldnames]

                def col_variant(*names):
                    for name in names:
                        if name.strip().lower() in fieldnames:
                            return name.strip().lower()
                    return None

                date_col = col_variant("draw_date", "date", "drawdate", "DrawDate", "Draw date")
                main_cols = []
                for i in range(1, 6):
                    c = col_variant(f"num_{i}", f"ball_{i}", f"ball {i}", f"main_{i}")
                    if c:
                        main_cols.append(c)
                numbers_raw_col = col_variant("numbers_raw", "balls", "main_numbers")
                lucky_star_cols = []
                for i in range(1, 3):
                    c = col_variant(f"bonus_{i}", f"lucky_star_{i}", f"lucky star {i}")
                    if c:
                        lucky_star_cols.append(c)
                bonus_raw_col = col_variant("bonus_raw", "lucky_stars", "bonus_stars")
                jackpot_col = col_variant("jackpot", "jackpot_amount", "prize")
                source_col = col_variant("source_url", "source", "url")

                for row in reader:
                    raw_date = row[date_col] if date_col and date_col in row else ""
                    norm_date = parse_date(raw_date)
                    if not norm_date:
                        continue
                    if norm_date in seen_dates:
                        continue
                    seen_dates.add(norm_date)

                    main_nums = []
                    if numbers_raw_col and numbers_raw_col in row:
                        main_nums = parse_main_numbers(row[numbers_raw_col])
                    elif main_cols:
                        main_nums = []
                        for mc in main_cols:
                            try:
                                val = row[mc]
                                if val and val.strip().isdigit():
                                    n = int(val.strip())
                                    if 1 <= n <= 50:
                                        main_nums.append(n)
                            except Exception:
                                pass
                        if len(main_nums) < 5 and numbers_raw_col:
                            fallback = parse_main_numbers(row.get(numbers_raw_col, ""))
                            existing_set = set(main_nums)
                            for n in fallback:
                                if n not in existing_set:
                                    main_nums.append(n)
                        while len(main_nums) < 5:
                            main_nums.append(0)
                        main_nums = sorted(main_nums[:5])

                    lucky_stars = []
                    if bonus_raw_col and bonus_raw_col in row:
                        lucky_stars = parse_lucky_stars(row[bonus_raw_col])
                    elif lucky_star_cols:
                        lucky_stars = []
                        for lc in lucky_star_cols:
                            try:
                                val = row[lc]
                                if val and val.strip().isdigit():
                                    n = int(val.strip())
                                    if 1 <= n <= 12:
                                        lucky_stars.append(n)
                            except Exception:
                                pass
                        while len(lucky_stars) < 2:
                            lucky_stars.append(0)
                        lucky_stars = sorted(lucky_stars[:2])

                    jackpot = row[jackpot_col] if jackpot_col and jackpot_col in row else ""
                    url = row[source_col] if source_col and source_col in row else ""

                    draws.append({
                        "draw_date": norm_date,
                        "num_1": main_nums[0],
                        "num_2": main_nums[1],
                        "num_3": main_nums[2],
                        "num_4": main_nums[3],
                        "num_5": main_nums[4],
                        "lucky_star_1": lucky_stars[0],
                        "lucky_star_2": lucky_stars[1],
                        "jackpot": jackpot,
                        "source_url": url,
                    })
        except Exception as e:
            print(f"Warning: could not read CSV from {csv_path_try}: {e}")
            continue

    unique = {}
    for d in draws:
        unique[d["draw_date"]] = d
    result = list(unique.values())
    result.sort(key=lambda x: x["draw_date"], reverse=True)
    return result
    return stars[:2]
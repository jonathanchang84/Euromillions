use std::path::{Path, PathBuf};
use std::fs;
use serde::Deserialize;
use tauri::AppHandle;
use tauri::Manager;
use chrono::{DateTime, Utc, TimeZone};
use reqwest::blocking::Client;
use regex::Regex;

const MAIN_NUMBER_RANGE: (i32, i32) = (1, 50);
const STAR_NUMBER_RANGE: (i32, i32) = (1, 12);

fn get_app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp/euromillions_predictor"))
}

fn ensure_csv_exists(app: &AppHandle) -> PathBuf {
    let data_dir = get_app_data_dir(app);
    let csv_path = data_dir.join("draws.csv");

    if !csv_path.exists() {
        fs::create_dir_all(&data_dir).ok();
        if let Ok(res_dir) = app.path().resource_dir() {
            let bundled_path = res_dir.join("data/euromillions_draws.csv");
            if bundled_path.exists() {
                fs::copy(&bundled_path, &csv_path).ok();
            } else {
                let fallback = std::env::var("CARGO_MANIFEST_DIR")
                    .map(|d| Path::new(&d).join("data/euromillions_draws.csv"))
                    .unwrap_or_else(|_| PathBuf::from("src-tauri/data/euromillions_draws.csv"));
                if fallback.exists() {
                    fs::copy(&fallback, &csv_path).ok();
                }
            }
        } else {
            let fallback = std::env::var("CARGO_MANIFEST_DIR")
                .map(|d| Path::new(&d).join("data/euromillions_draws.csv"))
                .unwrap_or_else(|_| PathBuf::from("src-tauri/data/euromillions_draws.csv"));
            if fallback.exists() {
                fs::copy(&fallback, &csv_path).ok();
            }
        }
    }

    csv_path
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EuroMillionDraw {
    pub draw_date: String,
    pub year: i32,
    pub num_1: i32,
    pub num_2: i32,
    pub num_3: i32,
    pub num_4: i32,
    pub num_5: i32,
    pub bonus_1: i32,
    pub bonus_2: i32,
    pub numbers_raw: String,
    pub bonus_raw: String,
    pub jackpot: String,
    pub source_url: String,
}
pub fn load_draws(app: &AppHandle) -> Result<Vec<EuroMillionDraw>, String> {
    let csv_path = ensure_csv_exists(app);
    let file = fs::File::open(&csv_path).map_err(|e| format!("Failed to open CSV: {}", e))?;
    let mut rdr = csv::Reader::from_reader(file);
    let records: Result<Vec<EuroMillionDraw>, _> = rdr.deserialize().collect();
    records.map_err(|e| format!("Failed to parse CSV: {}", e))
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct DrawStats {
    pub total_draws: usize,
    pub main_number_freq: Vec<(i32, f64)>,
    pub star_number_freq: Vec<(i32, f64)>,
    pub most_common_main: i32,
    pub most_common_star: i32,
    pub least_common_main: i32,
    pub least_common_star: i32,
    pub theoretical_vs_observed_main: Vec<(i32, f64, f64)>,
    pub theoretical_vs_observed_star: Vec<(i32, f64, f64)>,
    pub jackpot_avg: f64,
    pub jackpot_total: f64,
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct RolledUpStats {
    pub main_freq: std::collections::HashMap<i32, i64>,
    pub star_freq: std::collections::HashMap<i32, i64>,
    pub pair_freq: std::collections::HashMap<String, i64>,
    pub theoretical_weights_main: std::collections::HashMap<i32, f64>,
    pub theoretical_weights_star: std::collections::HashMap<i32, f64>,
    pub normalized_weights_main: std::collections::HashMap<i32, f64>,
    pub normalized_weights_star: std::collections::HashMap<i32, f64>,
}
fn compute_stats(draws: &[EuroMillionDraw]) -> DrawStats {
    let total = draws.len();
    if total == 0 {
        return DrawStats {
            total_draws: 0,
            main_number_freq: Vec::new(),
            star_number_freq: Vec::new(),
            most_common_main: 0,
            most_common_star: 0,
            least_common_main: 0,
            least_common_star: 0,
            theoretical_vs_observed_main: Vec::new(),
            theoretical_vs_observed_star: Vec::new(),
            jackpot_avg: 0.0,
            jackpot_total: 0.0,
        };
    }

    let mut main_counts: std::collections::HashMap<i32, i64> = std::collections::HashMap::new();
    let mut star_counts: std::collections::HashMap<i32, i64> = std::collections::HashMap::new();
    let mut jackpot_total: f64 = 0.0;
    let mut jackpot_count: i64 = 0;

    for draw in draws {
        let nums = [draw.num_1, draw.num_2, draw.num_3, draw.num_4, draw.num_5];
        for &num in &nums {
            if num >= MAIN_NUMBER_RANGE.0 && num <= MAIN_NUMBER_RANGE.1 {
                *main_counts.entry(num).or_insert(0) += 1;
            }
        }
        for &bonus in &[draw.bonus_1, draw.bonus_2] {
            if bonus >= STAR_NUMBER_RANGE.0 && bonus <= STAR_NUMBER_RANGE.1 {
                *star_counts.entry(bonus).or_insert(0) += 1;
            }
        }
        if let Ok(j) = draw.jackpot.parse::<f64>() {
            jackpot_total += j;
            jackpot_count += 1;
        }
    }

    let mut main_number_freq: Vec<(i32, f64)> = Vec::new();
    for n in 1..=50 {
        let count = *main_counts.get(&n).unwrap_or(&0) as f64;
        let pct = if total > 0 { (count / total as f64) * 100.0 } else { 0.0 };
        main_number_freq.push((n, pct));
    }
    main_number_freq.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut star_number_freq: Vec<(i32, f64)> = Vec::new();
    for n in 1..=12 {
        let count = *star_counts.get(&n).unwrap_or(&0) as f64;
        let pct = if total > 0 { (count / total as f64) * 100.0 } else { 0.0 };
        star_number_freq.push((n, pct));
    }
    star_number_freq.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let most_common_main = main_number_freq.first().map(|(n, _)| *n).unwrap_or(0);
    let most_common_star = star_number_freq.first().map(|(n, _)| *n).unwrap_or(0);
    let least_common_main = main_number_freq.last().map(|(n, _)| *n).unwrap_or(0);
    let least_common_star = star_number_freq.last().map(|(n, _)| *n).unwrap_or(0);

    let theoretical_vs_observed_main: Vec<(i32, f64, f64)> = (1..=50)
        .map(|n| {
            let theoretical_pct = (1.0 / 139_838_160.0) * 100.0;
            let observed_pct = *main_counts.get(&n).unwrap_or(&0) as f64 / total as f64 * 100.0;
            (n, theoretical_pct, observed_pct)
        })
        .collect();

    let theoretical_vs_observed_star: Vec<(i32, f64, f64)> = (1..=12)
        .map(|n| {
            let theoretical_pct = (1.0 / 13_983_816.0) * 100.0;
            let observed_pct = *star_counts.get(&n).unwrap_or(&0) as f64 / total as f64 * 100.0;
            (n, theoretical_pct, observed_pct)
        })
        .collect();

    let jackpot_avg = if jackpot_count > 0 { jackpot_total / jackpot_count as f64 } else { 0.0 };

    DrawStats {
        total_draws: total,
        main_number_freq,
        star_number_freq,
        most_common_main,
        most_common_star,
        least_common_main,
        least_common_star,
        theoretical_vs_observed_main,
        theoretical_vs_observed_star,
        jackpot_avg,
        jackpot_total,
    }
}
#[derive(Debug, Clone, serde::Serialize)]
pub struct NumberRecommendation {
    pub main_numbers: Vec<i32>,
    pub star_numbers: Vec<i32>,
    pub rationale: String,
    pub lookback_days: usize,
}

fn generate_recommendation(
    stats: &DrawStats,
    model_preset: &str,
    lookback_days: usize,
) -> NumberRecommendation {
    let mut recommendation = NumberRecommendation {
        main_numbers: Vec::new(),
        star_numbers: Vec::new(),
        rationale: String::new(),
        lookback_days,
    };

    let (focus_main, focus_star, explanation) = match model_preset {
        "hot" => {
            let main: Vec<i32> = stats
                .main_number_freq
                .iter()
                .take(5)
                .map(|(n, _)| *n)
                .collect();
            let star: Vec<i32> = stats
                .star_number_freq
                .iter()
                .take(2)
                .map(|(n, _)| *n)
                .collect();
            (main, star, "Hot numbers strategy: based on most frequently drawn numbers".to_string())
        }
        "cold" => {
            let main: Vec<i32> = stats
                .main_number_freq
                .iter()
                .rev()
                .take(5)
                .map(|(n, _)| *n)
                .collect();
            let star: Vec<i32> = stats
                .star_number_freq
                .iter()
                .rev()
                .take(2)
                .map(|(n, _)| *n)
                .collect();
            (main, star, "Cold numbers strategy: based on least frequently drawn numbers (overdue)".to_string())
        }
        "balanced" => {
            (vec![5, 15, 25, 35, 45], vec![5, 8], "Balanced strategy: evenly spread numbers across the full range".to_string())
        }
        "theoretical" => {
            (vec![3, 17, 29, 38, 47], vec![4, 9], "Theoretical strategy: numbers weighted by theoretical probability alignment".to_string())
        }
        _ => {
            let main: Vec<i32> = stats
                .main_number_freq
                .iter()
                .take(5)
                .map(|(n, _)| *n)
                .collect();
            let star: Vec<i32> = stats
                .star_number_freq
                .iter()
                .take(2)
                .map(|(n, _)| *n)
                .collect();
            (main, star, "Default strategy: based on recent frequency analysis".to_string())
        }
    };

    recommendation.main_numbers = focus_main;
    recommendation.star_numbers = focus_star;
    recommendation.rationale = explanation;

    recommendation
}
#[tauri::command]
fn compute_rolled_up_stats(draws: &[EuroMillionDraw]) -> RolledUpStats {
    let main_freq: std::collections::HashMap<i32, i64> = {
        let mut m = std::collections::HashMap::new();
        for draw in draws {
            let nums = [draw.num_1, draw.num_2, draw.num_3, draw.num_4, draw.num_5];
            for &num in &nums {
                if num >= MAIN_NUMBER_RANGE.0 && num <= MAIN_NUMBER_RANGE.1 {
                    *m.entry(num).or_insert(0) += 1;
                }
            }
        }
        m
    };

    let star_freq: std::collections::HashMap<i32, i64> = {
        let mut s = std::collections::HashMap::new();
        for draw in draws {
            for &bonus in &[draw.bonus_1, draw.bonus_2] {
                if bonus >= STAR_NUMBER_RANGE.0 && bonus <= STAR_NUMBER_RANGE.1 {
                    *s.entry(bonus).or_insert(0) += 1;
                }
            }
        }
        s
    };

    let pair_freq: std::collections::HashMap<String, i64> = {
        let mut p = std::collections::HashMap::new();
        for draw in draws {
            let mut nums: Vec<i32> = [draw.num_1, draw.num_2, draw.num_3, draw.num_4, draw.num_5]
                .into_iter()
                .filter(|&n| n >= MAIN_NUMBER_RANGE.0 && n <= MAIN_NUMBER_RANGE.1)
                .collect();
            nums.sort();
            if nums.len() >= 2 {
                let key = format!("{}-{}", nums[0], nums[1]);
                *p.entry(key).or_insert(0) += 1;
            }
        }
        p
    };

    let theoretical_weights_main: std::collections::HashMap<i32, f64> = (1..=50)
        .map(|n| (n, 1.0 / 50.0))
        .collect();

    let theoretical_weights_star: std::collections::HashMap<i32, f64> = (1..=12)
        .map(|n| (n, 1.0 / 12.0))
        .collect();

    let total_main_draws: f64 = draws.len() as f64 * 5.0;
    let normalized_weights_main: std::collections::HashMap<i32, f64> = main_freq
        .iter()
        .map(|(&n, &count)| (n, count as f64 / total_main_draws))
        .collect();

    let total_star_draws: f64 = draws.len() as f64 * 2.0;
    let normalized_weights_star: std::collections::HashMap<i32, f64> = star_freq
        .iter()
        .map(|(&n, &count)| (n, count as f64 / total_star_draws))
        .collect();

    RolledUpStats {
        main_freq,
        star_freq,
        pair_freq,
        theoretical_weights_main,
        theoretical_weights_star,
        normalized_weights_main,
        normalized_weights_star,
    }
}
#[tauri::command]
fn load_euro_million_data(app: tauri::AppHandle) -> Result<String, String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    Ok(format!("Loaded {} draws", draws.len()))
}

#[tauri::command]
fn get_euro_million_stats(app: tauri::AppHandle) -> Result<String, String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    let stats = compute_stats(&draws);
    Ok(serde_json::to_string(&stats).unwrap_or_default())
}

#[tauri::command]
fn get_rolled_up_stats(app: tauri::AppHandle) -> Result<String, String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    let stats = compute_rolled_up_stats(&draws);
    Ok(serde_json::to_string(&stats).unwrap_or_default())
}

#[tauri::command]
fn get_recommendation(
    app: tauri::AppHandle,
    model_preset: String,
    lookback_days: usize,
) -> Result<String, String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    let stats = compute_stats(&draws);
    let rec = generate_recommendation(&stats, &model_preset, lookback_days);
    Ok(serde_json::to_string(&rec).unwrap_or_default())
}

#[tauri::command]
fn get_recent_draws(app: tauri::AppHandle, limit: i32) -> Result<String, String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    let recent: Vec<&EuroMillionDraw> = draws.iter().take(limit as usize).collect();
    let lines: Vec<String> = recent.iter().map(|d| {
        format!(
            "{} | {} {} {} {} {} | {} {} | {}",
            d.draw_date, d.num_1, d.num_2, d.num_3, d.num_4, d.num_5, d.bonus_1, d.bonus_2, d.jackpot
        )
    }).collect();
    Ok(lines.join("\n"))
}

#[tauri::command]
fn init_app_data(app: tauri::AppHandle) -> Result<String, String> {
    let csv_path = ensure_csv_exists(&app);
    Ok(format!("App data initialized at: {}", csv_path.display()))
}


#[tauri::command]
fn get_all_draws(app: tauri::AppHandle) -> Result<Vec<EuroMillionDraw>, String> {
    load_draws(&app)
}

#[tauri::command]
fn import_csv(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    let src = std::path::Path::new(&file_path);
    if !src.exists() {
        return Err(format!("CSV file not found: {}", file_path));
    }
    let content = fs::read_to_string(src).map_err(|e| format!("Failed to read CSV: {}", e))?;
    let dest = ensure_csv_exists(&app);
    fs::write(&dest, content).map_err(|e| format!("Failed to write CSV: {}", e))?;
    let draws = load_draws(&app)?;
    Ok(format!("Imported {} draws", draws.len()))
}

#[tauri::command]
fn scrape_new_draws(app: tauri::AppHandle) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let body = client
        .get("https://lottoroi.com/en/lottery/euromillions/draws")
        .send()
        .map_err(|e| format!("Failed to fetch draws: {}", e))?
        .text()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let re = Regex::new(
        r"(\d{4}-\d{2}-\d{2}).*?(\d{1,2})\s*[·,]\s*(\d{1,2})\s*[·,]\s*(\d{1,2})\s*[·,]\s*(\d{1,2})\s*[·,]\s*(\d{1,2}).*?(\d{1,2})\s*[·,]\s*(\d{1,2})",
    )
    .map_err(|e| format!("Regex error: {}", e))?;

    let mut new_rows: Vec<(String, i32, i32, i32, i32, i32, i32, i32)> = Vec::new();
    for cap in re.captures_iter(&body) {
        let date = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let nums: Vec<i32> = (2..7)
            .filter_map(|i| cap.get(i).and_then(|m| m.as_str().parse::<i32>().ok()))
            .collect();
        let bonuses: Vec<i32> = (7..9)
            .filter_map(|i| cap.get(i).and_then(|m| m.as_str().parse::<i32>().ok()))
            .collect();
        if !date.is_empty() && nums.len() == 5 && bonuses.len() == 2 {
            new_rows.push((date, nums[0], nums[1], nums[2], nums[3], nums[4], bonuses[0], bonuses[1]));
        }
    }

    let csv_path = ensure_csv_exists(&app);
    let existing = load_draws(&app).unwrap_or_default();
    let existing_dates: std::collections::HashSet<String> =
        existing.iter().map(|d| d.draw_date.clone()).collect();

    let mut added_rows = String::new();
    let mut added_count: usize = 0;
    for (date, n1, n2, n3, n4, n5, b1, b2) in &new_rows {
        if existing_dates.contains(date) {
            continue;
        }
        let year = date.split('-').next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        added_rows.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},\"{} · {} · {} · {} · {}\",\"{} · {}\",\"\",https://lottoroi.com/en/lottery/euromillions/draws\n",
            date, year, n1, n2, n3, n4, n5, b1, b2, n1, n2, n3, n4, n5, b1, b2
        ));
        added_count += 1;
    }

    if added_count > 0 {
        let existing_text = fs::read_to_string(&csv_path).unwrap_or_default();
        let mut lines = existing_text.lines();
        let header = lines.next().unwrap_or(
            "draw_date,year,num_1,num_2,num_3,num_4,num_5,bonus_1,bonus_2,numbers_raw,bonus_raw,jackpot,source_url",
        );
        let rest: Vec<&str> = lines.collect();
        let updated = format!("{}\n{}{}", header, added_rows, rest.join("\n"));
        fs::write(&csv_path, updated).map_err(|e| format!("Failed to write CSV: {}", e))?;
    }

    Ok(format!("Added {} new draws", added_count))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_euro_million_data,
            get_all_draws,
            get_euro_million_stats,
            get_rolled_up_stats,
            get_recommendation,
            get_recent_draws,
            init_app_data,
            import_csv,
            scrape_new_draws
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

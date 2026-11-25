use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use regex::Regex;

use crate::csv_operations::{ensure_csv_exists, load_draws, read_draws, rewrite_csv};
use crate::stats::{compute_rolled_up_stats, compute_stats, generate_recommendation};
use crate::{
    AppError, AppResult, DrawBuilder, EuroMillionDraw, LOTTEROI_URL,
};

const PREDICTION_PRESETS: [&str; 4] = ["balanced", "hot", "cold", "theoretical"];
const MIN_ADAPTIVE_DRAWS: usize = 10;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PredictionCandidate {
    pub model_preset: String,
    pub main_numbers: Vec<i32>,
    pub star_numbers: Vec<i32>,
    pub rationale: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PredictionRecord {
    pub target_draw_date: String,
    pub generated_at: String,
    pub lookback_days: usize,
    pub candidates: Vec<PredictionCandidate>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PredictionDraw {
    pub draw_date: String,
    pub main_numbers: Vec<i32>,
    pub star_numbers: Vec<i32>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PredictionHistoryItem {
    pub record: PredictionRecord,
    pub actual_draw: Option<PredictionDraw>,
}

#[derive(Debug, serde::Serialize)]
struct RecommendationResult {
    target_draw_date: String,
    model_preset: String,
    effective_model: String,
    main_numbers: Vec<i32>,
    star_numbers: Vec<i32>,
    rationale: String,
    lookback_days: usize,
}

fn prediction_history_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let csv_path = ensure_csv_exists(app)?;
    let data_dir = csv_path
        .parent()
        .ok_or_else(|| AppError::Message("App data directory is unavailable".to_string()))?;
    Ok(data_dir.join("prediction_history.json"))
}

fn lock_prediction_history(app: &tauri::AppHandle, exclusive: bool) -> AppResult<fs::File> {
    let lock_path = prediction_history_path(app)?.with_extension("json.lock");
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)?;
    if exclusive {
        fs2::FileExt::lock_exclusive(&lock_file)?;
    } else {
        fs2::FileExt::lock_shared(&lock_file)?;
    }
    Ok(lock_file)
}

fn load_prediction_records(app: &tauri::AppHandle) -> AppResult<Vec<PredictionRecord>> {
    let path = prediction_history_path(app)?;
    match fs::read_to_string(path) {
        Ok(contents) => Ok(serde_json::from_str(&contents)?),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error.into()),
    }
}

fn save_prediction_records(
    app: &tauri::AppHandle,
    records: &[PredictionRecord],
) -> AppResult<()> {
    let path = prediction_history_path(app)?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, serde_json::to_vec_pretty(records)?)?;
    fs::rename(temporary_path, path)?;
    Ok(())
}

fn next_draw_date(today: NaiveDate, draws: &[EuroMillionDraw]) -> AppResult<String> {
    let latest_draw_date = draws
        .iter()
        .filter_map(|draw| NaiveDate::parse_from_str(&draw.draw_date, "%Y-%m-%d").ok())
        .max();
    let start = latest_draw_date.map_or(today, |latest| latest.max(today));
    for offset in 0..=14 {
        let date = start + Duration::days(offset);
        let is_draw_day = matches!(date.weekday(), chrono::Weekday::Tue | chrono::Weekday::Fri);
        let is_after_latest = latest_draw_date.is_none_or(|latest| date > latest);
        if is_draw_day && is_after_latest {
            return Ok(date.format("%Y-%m-%d").to_string());
        }
    }
    Err(AppError::Message(
        "Could not determine the next EuroMillions draw date".to_string(),
    ))
}

fn draws_for_lookback(
    draws: &[EuroMillionDraw],
    today: NaiveDate,
    lookback_days: usize,
) -> Vec<EuroMillionDraw> {
    let days = i64::try_from(lookback_days).unwrap_or(i64::MAX);
    let cutoff = today
        .checked_sub_signed(Duration::days(days))
        .unwrap_or(NaiveDate::MIN);
    draws
        .iter()
        .filter(|draw| {
            NaiveDate::parse_from_str(&draw.draw_date, "%Y-%m-%d")
                .is_ok_and(|date| date >= cutoff && date <= today)
        })
        .cloned()
        .collect()
}

fn settled_records<'a>(
    records: &'a [PredictionRecord],
    draws: &'a [EuroMillionDraw],
) -> Vec<(&'a PredictionRecord, &'a EuroMillionDraw)> {
    let draws_by_date: HashMap<&str, &EuroMillionDraw> = draws
        .iter()
        .map(|draw| (draw.draw_date.as_str(), draw))
        .collect();
    let mut earliest_by_target: BTreeMap<&str, (&PredictionRecord, &EuroMillionDraw)> =
        BTreeMap::new();
    for record in records {
        let Some(draw) = draws_by_date.get(record.target_draw_date.as_str()) else {
            continue;
        };
        let entry = earliest_by_target
            .entry(record.target_draw_date.as_str())
            .or_insert((record, *draw));
        if record.generated_at < entry.0.generated_at {
            *entry = (record, *draw);
        }
    }
    earliest_by_target.into_values().collect()
}

fn hit_count(predicted: &[i32], actual: &[i32]) -> usize {
    predicted.iter().filter(|number| actual.contains(number)).count()
}

fn learned_preset(
    records: &[PredictionRecord],
    draws: &[EuroMillionDraw],
) -> (String, usize, Option<f64>) {
    let settled = settled_records(records, draws);
    if settled.len() < MIN_ADAPTIVE_DRAWS {
        return ("balanced".to_string(), settled.len(), None);
    }

    let mut best_preset = PREDICTION_PRESETS[0];
    let mut best_average = f64::NEG_INFINITY;
    for preset in PREDICTION_PRESETS {
        let total_hits: usize = settled
            .iter()
            .filter_map(|(record, draw)| {
                let candidate = record
                    .candidates
                    .iter()
                    .find(|candidate| candidate.model_preset == preset)?;
                let main = [
                    draw.num_1,
                    draw.num_2,
                    draw.num_3,
                    draw.num_4,
                    draw.num_5,
                ];
                let stars = [draw.bonus_1, draw.bonus_2];
                Some(
                    hit_count(&candidate.main_numbers, &main)
                        + hit_count(&candidate.star_numbers, &stars),
                )
            })
            .sum();
        let average = total_hits as f64 / settled.len() as f64;
        if average > best_average {
            best_preset = preset;
            best_average = average;
        }
    }
    (best_preset.to_string(), settled.len(), Some(best_average))
}

fn candidate_from_recommendation(
    model_preset: &str,
    stats: &crate::DrawStats,
    lookback_days: usize,
) -> PredictionCandidate {
    let recommendation = generate_recommendation(stats, model_preset, lookback_days);
    PredictionCandidate {
        model_preset: model_preset.to_string(),
        main_numbers: recommendation.main_numbers,
        star_numbers: recommendation.star_numbers,
        rationale: recommendation.rationale,
    }
}

fn parse_scraped_draws(body: &str) -> AppResult<Vec<EuroMillionDraw>> {
    let tags = Regex::new(r"<[^>]*>")?;
    let text = tags.replace_all(body, " ");
    let re = Regex::new(
        r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\s+(\d{1,2})[·\s]+\s*(\d{1,2})[·\s]+\s*(\d{1,2})[·\s]+\s*(\d{1,2})[·\s]+\s*(\d{1,2})\s*[·\s]+\s*(\d{1,2})[·\s]+\s*(\d{1,2})(?:\s*[·\s]+\s*(€\d+M))?",
    )?;
    let mut draws = Vec::new();

    for cap in re.captures_iter(&text) {
        let Some(date) = cap
            .get(1)
            .and_then(|value| NaiveDate::parse_from_str(value.as_str(), "%B %d, %Y").ok())
        else {
            continue;
        };
        let numbers: Vec<i32> = (2..7)
            .filter_map(|index| cap.get(index).and_then(|value| value.as_str().parse().ok()))
            .collect();
        let stars: Vec<i32> = (7..9)
            .filter_map(|index| cap.get(index).and_then(|value| value.as_str().parse().ok()))
            .collect();
        if numbers.len() != 5
            || stars.len() != 2
            || numbers.iter().any(|number| !(1..=50).contains(number))
            || stars.iter().any(|number| !(1..=12).contains(number))
            || numbers.iter().collect::<HashSet<_>>().len() != 5
            || stars[0] == stars[1]
        {
            continue;
        }

        draws.push(EuroMillionDraw {
            draw_date: date.format("%Y-%m-%d").to_string(),
            year: date.year(),
            num_1: numbers[0],
            num_2: numbers[1],
            num_3: numbers[2],
            num_4: numbers[3],
            num_5: numbers[4],
            bonus_1: stars[0],
            bonus_2: stars[1],
            numbers_raw: numbers.iter().map(i32::to_string).collect::<Vec<_>>().join(" · "),
            bonus_raw: stars.iter().map(i32::to_string).collect::<Vec<_>>().join(" · "),
            jackpot: cap.get(9).map_or_else(String::new, |value| value.as_str().to_string()),
            source_url: LOTTEROI_URL.to_string(),
        });
    }

    if draws.is_empty() {
        return Err(AppError::Message(
            "No valid EuroMillions draw rows found in the LottoROI response".to_string(),
        ));
    }
    Ok(draws)
}

#[tauri::command]
pub fn load_euro_million_data(app: tauri::AppHandle) -> AppResult<String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    Ok(format!("Loaded {} draws", draws.len()))
}

#[tauri::command]
pub fn get_euro_million_stats(app: tauri::AppHandle) -> AppResult<String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    Ok(serde_json::to_string(&compute_stats(&draws))?)
}

#[tauri::command]
pub fn get_rolled_up_stats(app: tauri::AppHandle) -> AppResult<String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    Ok(serde_json::to_string(&compute_rolled_up_stats(&draws))?)
}

#[tauri::command]
pub fn get_recommendation(
    app: tauri::AppHandle,
    model_preset: String,
    lookback_days: usize,
) -> AppResult<String> {
    let _history_lock = lock_prediction_history(&app, true)?;
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    let records = load_prediction_records(&app)?;
    let today = Local::now().date_naive();
    let target_draw_date = next_draw_date(today, &draws)?;
    let lookback_draws = draws_for_lookback(&draws, today, lookback_days);
    if lookback_draws.is_empty() {
        return Err(AppError::Message(
            "No draw results are available within the selected lookback window".to_string(),
        ));
    }
    let stats = compute_stats(&lookback_draws);

    let existing = records.iter().find(|record| {
        record.target_draw_date == target_draw_date && record.lookback_days == lookback_days
    });
    let candidates = if let Some(record) = existing {
        record.candidates.clone()
    } else {
        let candidates: Vec<PredictionCandidate> = PREDICTION_PRESETS
            .iter()
            .map(|preset| candidate_from_recommendation(preset, &stats, lookback_days))
            .collect();
        let mut updated_records = records.clone();
        updated_records.push(PredictionRecord {
            target_draw_date: target_draw_date.clone(),
            generated_at: Utc::now().to_rfc3339(),
            lookback_days,
            candidates: candidates.clone(),
        });
        save_prediction_records(&app, &updated_records)?;
        candidates
    };

    let (learned, settled_count, average_hits) = learned_preset(&records, &draws);
    let effective_model = if model_preset == "adaptive" {
        learned
    } else if PREDICTION_PRESETS.contains(&model_preset.as_str()) {
        model_preset.clone()
    } else {
        "balanced".to_string()
    };
    let candidate = candidates
        .iter()
        .find(|candidate| candidate.model_preset == effective_model)
        .ok_or_else(|| AppError::Message("Prediction strategy was not available".to_string()))?;
    let mut rationale = candidate.rationale.clone();
    if model_preset == "adaptive" {
        rationale = match average_hits {
            Some(average) => format!(
                "Adaptive mode selected {} ({} settled draws; {:.2} average matches). Historical results do not change the odds of future draws.",
                effective_model, settled_count, average
            ),
            None => format!(
                "Adaptive mode is warming up: {} of {} settled draws available. Using the balanced strategy until enough outcomes are recorded. Historical results do not change the odds of future draws.",
                settled_count, MIN_ADAPTIVE_DRAWS
            ),
        };
    }
    Ok(serde_json::to_string(&RecommendationResult {
        target_draw_date,
        model_preset,
        effective_model,
        main_numbers: candidate.main_numbers.clone(),
        star_numbers: candidate.star_numbers.clone(),
        rationale,
        lookback_days,
    })?)
}

#[tauri::command]
pub fn get_prediction_history(app: tauri::AppHandle) -> AppResult<Vec<PredictionHistoryItem>> {
    let _history_lock = lock_prediction_history(&app, false)?;
    let records = load_prediction_records(&app)?;
    let draws = load_draws(&app)?;
    let draws_by_date: HashMap<&str, &EuroMillionDraw> = draws
        .iter()
        .map(|draw| (draw.draw_date.as_str(), draw))
        .collect();
    Ok(records
        .into_iter()
        .map(|record| PredictionHistoryItem {
            actual_draw: draws_by_date
                .get(record.target_draw_date.as_str())
                .map(|draw| PredictionDraw {
                    draw_date: draw.draw_date.clone(),
                    main_numbers: vec![
                        draw.num_1,
                        draw.num_2,
                        draw.num_3,
                        draw.num_4,
                        draw.num_5,
                    ],
                    star_numbers: vec![draw.bonus_1, draw.bonus_2],
                }),
            record,
        })
        .collect())
}

#[tauri::command]
pub fn get_recent_draws(app: tauri::AppHandle, limit: i32) -> AppResult<String> {
    let draws = load_draws(&app)?;
    if draws.is_empty() {
        return Ok("No data available".to_string());
    }
    let recent: Vec<&EuroMillionDraw> = draws.iter().take(limit.max(0) as usize).collect();
    let lines: Vec<String> = recent
        .iter()
        .map(|draw| {
            format!(
                "{} | {} {} {} {} {} | {} {} | {}",
                draw.draw_date,
                draw.num_1,
                draw.num_2,
                draw.num_3,
                draw.num_4,
                draw.num_5,
                draw.bonus_1,
                draw.bonus_2,
                draw.jackpot
            )
        })
        .collect();
    Ok(lines.join("\n"))
}

#[tauri::command]
pub fn init_app_data(app: tauri::AppHandle) -> AppResult<String> {
    let csv_path = ensure_csv_exists(&app)?;
    Ok(format!("App data initialized at: {}", csv_path.display()))
}

#[tauri::command]
pub fn get_all_draws(app: tauri::AppHandle) -> AppResult<Vec<EuroMillionDraw>> {
    load_draws(&app)
}

#[tauri::command]
pub fn import_csv(app: tauri::AppHandle, file_path: String) -> AppResult<String> {
    let source = Path::new(&file_path);
    if !source.exists() {
        return Err(AppError::Message(format!("CSV file not found: {}", file_path)));
    }
    let imported = read_draws(source)?;
    rewrite_csv(&app, &imported)?;
    Ok(format!("Imported {} draws", imported.len()))
}

#[tauri::command]
pub fn scrape_new_draws(app: tauri::AppHandle) -> AppResult<String> {
    let body = reqwest::blocking::Client::new()
        .get(LOTTEROI_URL)
        .send()?
        .text()?;
    let scraped_draws = parse_scraped_draws(&body)?;
    let mut draws = load_draws(&app)?;
    let mut dates: HashSet<String> = draws.iter().map(|draw| draw.draw_date.clone()).collect();
    let mut added_count = 0;
    for draw in scraped_draws {
        if dates.insert(draw.draw_date.clone()) {
            draws.push(draw);
            added_count += 1;
        }
    }

    if added_count > 0 {
        draws.sort_by(|left, right| right.draw_date.cmp(&left.draw_date));
        rewrite_csv(&app, &draws)?;
    }
    Ok(format!("Added {} new draws", added_count))
}

fn make_draw(
    draw_date: String,
    main_numbers: [i32; 5],
    star_numbers: [i32; 2],
    jackpot: String,
) -> AppResult<EuroMillionDraw> {
    Ok(DrawBuilder::new(draw_date, main_numbers, star_numbers)?
        .jackpot(jackpot)
        .build())
}

#[tauri::command]
pub fn add_draw(
    app: tauri::AppHandle,
    draw_date: String,
    num_1: i32,
    num_2: i32,
    num_3: i32,
    num_4: i32,
    num_5: i32,
    bonus_1: i32,
    bonus_2: i32,
    jackpot: String,
) -> AppResult<String> {
    let new_draw = make_draw(
        draw_date.clone(),
        [num_1, num_2, num_3, num_4, num_5],
        [bonus_1, bonus_2],
        jackpot,
    )?;
    let mut draws = load_draws(&app)?;
    if draws.iter().any(|draw| draw.draw_date == draw_date) {
        return Err(AppError::DuplicateDraw(draw_date));
    }
    draws.push(new_draw);
    draws.sort_by(|left, right| right.draw_date.cmp(&left.draw_date));
    rewrite_csv(&app, &draws)?;
    Ok(format!("Added draw for {}", draw_date))
}

#[tauri::command]
pub fn update_draw(
    app: tauri::AppHandle,
    draw_date: String,
    num_1: i32,
    num_2: i32,
    num_3: i32,
    num_4: i32,
    num_5: i32,
    bonus_1: i32,
    bonus_2: i32,
    jackpot: String,
) -> AppResult<String> {
    let updated_draw = make_draw(
        draw_date.clone(),
        [num_1, num_2, num_3, num_4, num_5],
        [bonus_1, bonus_2],
        jackpot,
    )?;
    let mut draws = load_draws(&app)?;
    let mut found = false;
    for draw in &mut draws {
        if draw.draw_date == draw_date {
            *draw = updated_draw.clone();
            found = true;
        }
    }
    if !found {
        return Err(AppError::DrawNotFound(draw_date));
    }
    rewrite_csv(&app, &draws)?;
    Ok(format!("Updated draw for {}", draw_date))
}

#[tauri::command]
pub fn delete_draw(app: tauri::AppHandle, draw_date: String) -> AppResult<String> {
    let mut draws = load_draws(&app)?;
    let original_len = draws.len();
    draws.retain(|draw| draw.draw_date != draw_date);
    let removed = original_len - draws.len();
    if removed > 0 {
        rewrite_csv(&app, &draws)?;
    }
    Ok(format!("Removed {} draw(s)", removed))
}

#[tauri::command]
pub fn list_duplicate_draws(app: tauri::AppHandle) -> AppResult<String> {
    let draws = load_draws(&app)?;
    let mut indices_by_date: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, draw) in draws.iter().enumerate() {
        indices_by_date
            .entry(draw.draw_date.clone())
            .or_default()
            .push(index);
    }
    let groups: Vec<serde_json::Value> = indices_by_date
        .into_iter()
        .filter(|(_, indices)| indices.len() > 1)
        .map(|(draw_date, indices)| {
            let rows: Vec<serde_json::Value> = indices
                .into_iter()
                .map(|row_index| {
                    let draw = &draws[row_index];
                    serde_json::json!({
                        "row_index": row_index,
                        "draw_date": draw.draw_date,
                        "num_1": draw.num_1,
                        "num_2": draw.num_2,
                        "num_3": draw.num_3,
                        "num_4": draw.num_4,
                        "num_5": draw.num_5,
                        "bonus_1": draw.bonus_1,
                        "bonus_2": draw.bonus_2,
                        "numbers_raw": draw.numbers_raw,
                        "bonus_raw": draw.bonus_raw,
                        "jackpot": draw.jackpot
                    })
                })
                .collect();
            serde_json::json!({ "draw_date": draw_date, "rows": rows })
        })
        .collect();
    Ok(serde_json::to_string(&groups)?)
}

#[tauri::command]
pub fn delete_draw_rows(app: tauri::AppHandle, row_indices: Vec<usize>) -> AppResult<String> {
    let draws = load_draws(&app)?;
    let selected: HashSet<usize> = row_indices.into_iter().collect();
    if selected.is_empty() {
        return Err(AppError::Message(
            "Select at least one duplicate row to delete".to_string(),
        ));
    }
    if selected.iter().any(|index| *index >= draws.len()) {
        return Err(AppError::Message(
            "A selected row index is out of range".to_string(),
        ));
    }

    let mut date_counts: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for (index, draw) in draws.iter().enumerate() {
        let counts = date_counts.entry(&draw.draw_date).or_default();
        counts.0 += 1;
        if selected.contains(&index) {
            counts.1 += 1;
        }
    }
    if selected
        .iter()
        .any(|index| date_counts[draws[*index].draw_date.as_str()].0 < 2)
    {
        return Err(AppError::Message(
            "Only duplicate rows can be removed with this action".to_string(),
        ));
    }
    if date_counts
        .values()
        .any(|(total, selected)| total == selected)
    {
        return Err(AppError::Message(
            "At least one row must remain for every draw date".to_string(),
        ));
    }

    let kept: Vec<EuroMillionDraw> = draws
        .into_iter()
        .enumerate()
        .filter_map(|(index, draw)| (!selected.contains(&index)).then_some(draw))
        .collect();
    let removed = selected.len();
    rewrite_csv(&app, &kept)?;
    Ok(format!("Removed {} duplicate row(s)", removed))
}

#[tauri::command]
pub fn revert_draws(app: tauri::AppHandle) -> AppResult<String> {
    let csv_path = ensure_csv_exists(&app)?;
    let backup_path = csv_path.with_extension("csv.bak");
    read_draws(&backup_path)?;
    fs::copy(&backup_path, &csv_path)?;
    Ok("Restored draw data from the last backup".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        draws_for_lookback, learned_preset, make_draw, next_draw_date, parse_scraped_draws,
        PredictionCandidate, PredictionRecord,
    };
    use crate::EuroMillionDraw;
    use chrono::NaiveDate;

    #[test]
    fn parses_lottoroi_result_row() {
        let html = r#"
            <time><span>Nov 20</span><span>November 20, 2026</span></time>
            <td>8 · 21 · 24 · 36 · 49</td>
            <td>1 · 8</td>
            <td>€37M</td>
        "#;
        let draws = parse_scraped_draws(html).unwrap();
        assert_eq!(draws.len(), 1);
        assert_eq!(draws[0].draw_date, "2026-11-20");
        assert_eq!(
            [
                draws[0].num_1,
                draws[0].num_2,
                draws[0].num_3,
                draws[0].num_4,
                draws[0].num_5
            ],
            [8, 21, 24, 36, 49]
        );
        assert_eq!([draws[0].bonus_1, draws[0].bonus_2], [1, 8]);
        assert_eq!(draws[0].jackpot, "€37M");
    }

    #[test]
    fn rejects_invalid_manual_draw_numbers() {
        let result = make_draw(
            "2026-11-20".to_string(),
            [8, 21, 21, 36, 49],
            [1, 8],
            String::new(),
        );
        assert!(result.unwrap_err().to_string().contains("must be unique"));
    }

    #[test]
    fn adaptive_model_uses_only_settled_draws_and_ranks_strategies() {
        let presets = ["balanced", "hot", "cold", "theoretical"];
        let mut records = Vec::new();
        let mut draws = Vec::new();
        let start = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        for offset in 0..10 {
            let date = (start + chrono::Duration::days(offset)).format("%Y-%m-%d").to_string();
            draws.push(EuroMillionDraw {
                draw_date: date.clone(),
                year: 2026,
                num_1: 1,
                num_2: 2,
                num_3: 3,
                num_4: 4,
                num_5: 5,
                bonus_1: 1,
                bonus_2: 2,
                numbers_raw: String::new(),
                bonus_raw: String::new(),
                jackpot: String::new(),
                source_url: String::new(),
            });
            let candidates = presets
                .iter()
                .map(|preset| {
                    let is_hot = *preset == "hot";
                    PredictionCandidate {
                        model_preset: (*preset).to_string(),
                        main_numbers: if is_hot { vec![1, 2, 3, 4, 5] } else { vec![6, 7, 8, 9, 10] },
                        star_numbers: if is_hot { vec![1, 2] } else { vec![3, 4] },
                        rationale: String::new(),
                    }
                })
                .collect();
            records.push(PredictionRecord {
                target_draw_date: date,
                generated_at: format!("2025-12-{:02}T00:00:00Z", offset + 1),
                lookback_days: 10000,
                candidates,
            });
        }

        assert_eq!(learned_preset(&records[..9], &draws[..9]), ("balanced".to_string(), 9, None));
        assert_eq!(learned_preset(&records, &draws), ("hot".to_string(), 10, Some(7.0)));
        assert_eq!(
            draws_for_lookback(&draws, start + chrono::Duration::days(9), 5).len(),
            6
        );
    }

    #[test]
    fn schedules_the_next_draw_after_today_and_latest_result() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 25).unwrap();
        assert_eq!(next_draw_date(today, &[]).unwrap(), "2026-11-27");
    }
}

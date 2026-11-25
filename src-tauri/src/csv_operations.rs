use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::{AppError, AppResult, EuroMillionDraw};

fn get_app_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("/tmp/euromillions_predictor"))
}

/// Return the app-data CSV path, initializing it from the bundled draw history when needed.
pub fn ensure_csv_exists(app: &AppHandle) -> AppResult<PathBuf> {
    let data_dir = get_app_data_dir(app);
    let csv_path = data_dir.join("draws.csv");

    if !csv_path.exists() {
        fs::create_dir_all(&data_dir)?;
        let bundled_path = app
            .path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("data/euromillions_draws.csv"))
            .filter(|path| path.exists());
        let fallback_path = std::env::var("CARGO_MANIFEST_DIR")
            .map(|dir| Path::new(&dir).join("data/euromillions_draws.csv"))
            .unwrap_or_else(|_| PathBuf::from("src-tauri/data/euromillions_draws.csv"));
        let source_path = bundled_path
            .or_else(|| fallback_path.exists().then_some(fallback_path))
            .ok_or_else(|| AppError::Message("Bundled draw data was not found".to_string()))?;
        fs::copy(source_path, &csv_path)?;
    }

    Ok(csv_path)
}

pub(crate) fn read_draws(path: &Path) -> AppResult<Vec<EuroMillionDraw>> {
    let file = fs::File::open(path)?;
    let mut reader = csv::Reader::from_reader(file);
    Ok(reader
        .deserialize()
        .collect::<Result<Vec<EuroMillionDraw>, _>>()?)
}

pub fn load_draws(app: &AppHandle) -> AppResult<Vec<EuroMillionDraw>> {
    read_draws(&ensure_csv_exists(app)?)
}

fn serialize_draws(draws: &[EuroMillionDraw]) -> AppResult<Vec<u8>> {
    let mut writer = csv::WriterBuilder::new()
        .has_headers(false)
        .from_writer(Vec::new());
    writer.write_record([
        "draw_date",
        "year",
        "num_1",
        "num_2",
        "num_3",
        "num_4",
        "num_5",
        "bonus_1",
        "bonus_2",
        "numbers_raw",
        "bonus_raw",
        "jackpot",
        "source_url",
    ])?;
    for draw in draws {
        writer.serialize(draw)?;
    }
    writer
        .into_inner()
        .map_err(|error| AppError::Io(error.into_error()))
}

pub(crate) fn rewrite_csv(app: &AppHandle, draws: &[EuroMillionDraw]) -> AppResult<()> {
    let csv_path = ensure_csv_exists(app)?;
    let csv_content = serialize_draws(draws)?;
    let backup_path = csv_path.with_extension("csv.bak");
    if csv_path.exists() {
        fs::copy(&csv_path, &backup_path)?;
    }
    fs::write(&csv_path, csv_content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::serialize_draws;
    use crate::EuroMillionDraw;

    #[test]
    fn serialized_draw_csv_has_one_header_and_round_trips() {
        let draw = EuroMillionDraw {
            draw_date: "2026-11-20".to_string(),
            year: 2026,
            num_1: 8,
            num_2: 21,
            num_3: 24,
            num_4: 36,
            num_5: 49,
            bonus_1: 1,
            bonus_2: 8,
            numbers_raw: "8 · 21 · 24 · 36 · 49".to_string(),
            bonus_raw: "1 · 8".to_string(),
            jackpot: "€37M".to_string(),
            source_url: "https://lottoroi.com/en/lottery/euromillions/draws".to_string(),
        };
        let csv = serialize_draws(&[draw]).unwrap();
        let parsed: Vec<EuroMillionDraw> = csv::Reader::from_reader(csv.as_slice())
            .deserialize()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].jackpot, "€37M");
    }
}

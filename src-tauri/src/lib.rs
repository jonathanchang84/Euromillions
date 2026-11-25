use std::collections::HashSet;

use chrono::{Datelike, NaiveDate};

pub mod commands;
mod csv_operations;
pub mod stats;

pub use csv_operations::load_draws;
pub use stats::{DrawStats, NumberRecommendation, RolledUpStats};

pub(crate) const MAIN_NUMBER_RANGE: (i32, i32) = (1, 50);
pub(crate) const STAR_NUMBER_RANGE: (i32, i32) = (1, 12);
pub(crate) const LOTTEROI_URL: &str = "https://lottoroi.com/en/lottery/euromillions/draws";

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("File operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("CSV operation failed: {0}")]
    Csv(#[from] csv::Error),
    #[error("Regular expression failed: {0}")]
    Regex(#[from] regex::Error),
    #[error("Network request failed: {0}")]
    Network(#[from] reqwest::Error),
    #[error("JSON serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid date: {0}")]
    InvalidDate(String),
    #[error("Invalid number: {0}")]
    InvalidNumber(String),
    #[error("A draw already exists for {0}")]
    DuplicateDraw(String),
    #[error("No draw found for {0}")]
    DrawNotFound(String),
    #[error("{0}")]
    Message(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

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

pub struct DrawBuilder {
    draw_date: String,
    date: NaiveDate,
    main_numbers: [i32; 5],
    star_numbers: [i32; 2],
    jackpot: String,
}

impl DrawBuilder {
    pub fn new(
        draw_date: String,
        main_numbers: [i32; 5],
        star_numbers: [i32; 2],
    ) -> AppResult<Self> {
        let date = NaiveDate::parse_from_str(&draw_date, "%Y-%m-%d")
            .map_err(|_| AppError::InvalidDate(draw_date.clone()))?;
        if main_numbers
            .iter()
            .any(|number| !(MAIN_NUMBER_RANGE.0..=MAIN_NUMBER_RANGE.1).contains(number))
        {
            return Err(AppError::InvalidNumber(
                "main numbers must be between 1 and 50".to_string(),
            ));
        }
        if star_numbers
            .iter()
            .any(|number| !(STAR_NUMBER_RANGE.0..=STAR_NUMBER_RANGE.1).contains(number))
        {
            return Err(AppError::InvalidNumber(
                "star numbers must be between 1 and 12".to_string(),
            ));
        }
        if main_numbers.iter().collect::<HashSet<_>>().len() != main_numbers.len() {
            return Err(AppError::InvalidNumber(
                "main numbers must be unique".to_string(),
            ));
        }
        if star_numbers[0] == star_numbers[1] {
            return Err(AppError::InvalidNumber(
                "star numbers must be unique".to_string(),
            ));
        }

        Ok(Self {
            draw_date,
            date,
            main_numbers,
            star_numbers,
            jackpot: String::new(),
        })
    }

    pub fn jackpot(mut self, jackpot: String) -> Self {
        self.jackpot = jackpot;
        self
    }

    pub fn build(self) -> EuroMillionDraw {
        EuroMillionDraw {
            draw_date: self.draw_date,
            year: self.date.year(),
            num_1: self.main_numbers[0],
            num_2: self.main_numbers[1],
            num_3: self.main_numbers[2],
            num_4: self.main_numbers[3],
            num_5: self.main_numbers[4],
            bonus_1: self.star_numbers[0],
            bonus_2: self.star_numbers[1],
            numbers_raw: self
                .main_numbers
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join(" · "),
            bonus_raw: self
                .star_numbers
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join(" · "),
            jackpot: self.jackpot,
            source_url: LOTTEROI_URL.to_string(),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::load_euro_million_data,
            commands::get_all_draws,
            commands::get_euro_million_stats,
            commands::get_rolled_up_stats,
            commands::get_recommendation,
            commands::get_prediction_history,
            commands::get_recent_draws,
            commands::init_app_data,
            commands::import_csv,
            commands::scrape_new_draws,
            commands::add_draw,
            commands::update_draw,
            commands::delete_draw,
            commands::list_duplicate_draws,
            commands::delete_draw_rows,
            commands::revert_draws
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

#[cfg(test)]
mod tests {
    use super::DrawBuilder;

    #[test]
    fn draw_builder_creates_valid_draw_fields() {
        let draw = DrawBuilder::new("2026-11-20".to_string(), [8, 21, 24, 36, 49], [1, 8])
            .unwrap()
            .jackpot("€37M".to_string())
            .build();

        assert_eq!(draw.year, 2026);
        assert_eq!(draw.numbers_raw, "8 · 21 · 24 · 36 · 49");
        assert_eq!(draw.bonus_raw, "1 · 8");
        assert_eq!(draw.jackpot, "€37M");
    }
}

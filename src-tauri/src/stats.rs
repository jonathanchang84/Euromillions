use std::collections::HashMap;

use super::{EuroMillionDraw, MAIN_NUMBER_RANGE, STAR_NUMBER_RANGE};

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
    pub main_freq: HashMap<i32, i64>,
    pub star_freq: HashMap<i32, i64>,
    pub pair_freq: HashMap<String, i64>,
    pub theoretical_weights_main: HashMap<i32, f64>,
    pub theoretical_weights_star: HashMap<i32, f64>,
    pub normalized_weights_main: HashMap<i32, f64>,
    pub normalized_weights_star: HashMap<i32, f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct NumberRecommendation {
    pub main_numbers: Vec<i32>,
    pub star_numbers: Vec<i32>,
    pub rationale: String,
    pub lookback_days: usize,
}

pub(crate) fn compute_stats(draws: &[EuroMillionDraw]) -> DrawStats {
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

    let mut main_counts: HashMap<i32, i64> = HashMap::new();
    let mut star_counts: HashMap<i32, i64> = HashMap::new();
    let mut jackpot_total = 0.0;
    let mut jackpot_count = 0;

    for draw in draws {
        for num in [draw.num_1, draw.num_2, draw.num_3, draw.num_4, draw.num_5] {
            if (MAIN_NUMBER_RANGE.0..=MAIN_NUMBER_RANGE.1).contains(&num) {
                *main_counts.entry(num).or_insert(0) += 1;
            }
        }
        for bonus in [draw.bonus_1, draw.bonus_2] {
            if (STAR_NUMBER_RANGE.0..=STAR_NUMBER_RANGE.1).contains(&bonus) {
                *star_counts.entry(bonus).or_insert(0) += 1;
            }
        }
        if let Ok(jackpot) = draw.jackpot.parse::<f64>() {
            jackpot_total += jackpot;
            jackpot_count += 1;
        }
    }

    let mut main_number_freq: Vec<(i32, f64)> = (MAIN_NUMBER_RANGE.0..=MAIN_NUMBER_RANGE.1)
        .map(|number| {
            let count = *main_counts.get(&number).unwrap_or(&0) as f64;
            (number, count / total as f64 * 100.0)
        })
        .collect();
    main_number_freq.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut star_number_freq: Vec<(i32, f64)> = (STAR_NUMBER_RANGE.0..=STAR_NUMBER_RANGE.1)
        .map(|number| {
            let count = *star_counts.get(&number).unwrap_or(&0) as f64;
            (number, count / total as f64 * 100.0)
        })
        .collect();
    star_number_freq.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let theoretical_vs_observed_main = (MAIN_NUMBER_RANGE.0..=MAIN_NUMBER_RANGE.1)
        .map(|number| {
            let theoretical_pct = (1.0 / 139_838_160.0) * 100.0;
            let observed_pct = *main_counts.get(&number).unwrap_or(&0) as f64 / total as f64 * 100.0;
            (number, theoretical_pct, observed_pct)
        })
        .collect();
    let theoretical_vs_observed_star = (STAR_NUMBER_RANGE.0..=STAR_NUMBER_RANGE.1)
        .map(|number| {
            let theoretical_pct = (1.0 / 13_983_816.0) * 100.0;
            let observed_pct = *star_counts.get(&number).unwrap_or(&0) as f64 / total as f64 * 100.0;
            (number, theoretical_pct, observed_pct)
        })
        .collect();

    DrawStats {
        total_draws: total,
        most_common_main: main_number_freq.first().map_or(0, |(number, _)| *number),
        most_common_star: star_number_freq.first().map_or(0, |(number, _)| *number),
        least_common_main: main_number_freq.last().map_or(0, |(number, _)| *number),
        least_common_star: star_number_freq.last().map_or(0, |(number, _)| *number),
        main_number_freq,
        star_number_freq,
        theoretical_vs_observed_main,
        theoretical_vs_observed_star,
        jackpot_avg: if jackpot_count > 0 {
            jackpot_total / jackpot_count as f64
        } else {
            0.0
        },
        jackpot_total,
    }
}

pub(crate) fn generate_recommendation(
    stats: &DrawStats,
    model_preset: &str,
    lookback_days: usize,
) -> NumberRecommendation {
    let (main_numbers, star_numbers, rationale) = match model_preset {
        "hot" => (
            stats
                .main_number_freq
                .iter()
                .take(5)
                .map(|(number, _)| *number)
                .collect(),
            stats
                .star_number_freq
                .iter()
                .take(2)
                .map(|(number, _)| *number)
                .collect(),
            "Hot numbers strategy: based on most frequently drawn numbers",
        ),
        "cold" => (
            stats
                .main_number_freq
                .iter()
                .rev()
                .take(5)
                .map(|(number, _)| *number)
                .collect(),
            stats
                .star_number_freq
                .iter()
                .rev()
                .take(2)
                .map(|(number, _)| *number)
                .collect(),
            "Cold numbers strategy: based on least frequently drawn numbers (overdue)",
        ),
        "balanced" => (
            vec![5, 15, 25, 35, 45],
            vec![5, 8],
            "Balanced strategy: evenly spread numbers across the full range",
        ),
        "theoretical" => (
            vec![3, 17, 29, 38, 47],
            vec![4, 9],
            "Theoretical strategy: numbers weighted by theoretical probability alignment",
        ),
        _ => (
            stats
                .main_number_freq
                .iter()
                .take(5)
                .map(|(number, _)| *number)
                .collect(),
            stats
                .star_number_freq
                .iter()
                .take(2)
                .map(|(number, _)| *number)
                .collect(),
            "Default strategy: based on recent frequency analysis",
        ),
    };

    NumberRecommendation {
        main_numbers,
        star_numbers,
        rationale: rationale.to_string(),
        lookback_days,
    }
}

pub(crate) fn compute_rolled_up_stats(draws: &[EuroMillionDraw]) -> RolledUpStats {
    let mut main_freq: HashMap<i32, i64> = HashMap::new();
    let mut star_freq: HashMap<i32, i64> = HashMap::new();
    let mut pair_freq: HashMap<String, i64> = HashMap::new();

    for draw in draws {
        let mut numbers = Vec::new();
        for number in [draw.num_1, draw.num_2, draw.num_3, draw.num_4, draw.num_5] {
            if (MAIN_NUMBER_RANGE.0..=MAIN_NUMBER_RANGE.1).contains(&number) {
                *main_freq.entry(number).or_insert(0) += 1;
                numbers.push(number);
            }
        }
        for star in [draw.bonus_1, draw.bonus_2] {
            if (STAR_NUMBER_RANGE.0..=STAR_NUMBER_RANGE.1).contains(&star) {
                *star_freq.entry(star).or_insert(0) += 1;
            }
        }
        numbers.sort_unstable();
        if numbers.len() >= 2 {
            *pair_freq
                .entry(format!("{}-{}", numbers[0], numbers[1]))
                .or_insert(0) += 1;
        }
    }

    let theoretical_weights_main = (MAIN_NUMBER_RANGE.0..=MAIN_NUMBER_RANGE.1)
        .map(|number| (number, 1.0 / 50.0))
        .collect();
    let theoretical_weights_star = (STAR_NUMBER_RANGE.0..=STAR_NUMBER_RANGE.1)
        .map(|number| (number, 1.0 / 12.0))
        .collect();
    let total_main_draws = draws.len() as f64 * 5.0;
    let normalized_weights_main = main_freq
        .iter()
        .map(|(&number, &count)| (number, count as f64 / total_main_draws))
        .collect();
    let total_star_draws = draws.len() as f64 * 2.0;
    let normalized_weights_star = star_freq
        .iter()
        .map(|(&number, &count)| (number, count as f64 / total_star_draws))
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

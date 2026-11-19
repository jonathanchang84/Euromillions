"""Scoring model and recommendation logic for EuroMillions Predictor."""

from collections import defaultdict
from typing import Dict, List, Tuple

# Theoretical probabilities
THEORETICAL_MAIN_PROB = 5 / 50  # 10.00% per main number in a single draw
THEORETICAL_STAR_PROB = 2 / 12  # 16.67% per Lucky Star in a single draw

# Scoring weights (configurable)
LONG_TERM_WEIGHT = 0.5  # Weight for long-term frequency
SHORT_TERM_WEIGHT = 0.3  # Weight for recent/momentum performance
GAP_WEIGHT = 0.2  # Weight for overdue/gap factor


def compute_long_term_score(count: int, total_draws: int, theoretical_prob: float) -> float:
    """Compute long-term frequency score.

    Returns the empirical draw rate relative to expected rate,
    normalized to theoretical probability.
    """
    if total_draws == 0:
        return 0.0
    empirical_rate = count / total_draws
    # Score: how much the empirical rate exceeds or falls short of theoretical
    if theoretical_prob > 0:
        return empirical_rate / theoretical_prob
    return 0.0


def compute_short_term_score(count: int, window_size: int, theoretical_prob: float) -> float:
    """Compute short-term recency/momentum score.

    Based on appearances in the last N draws.
    """
    if window_size == 0:
        return 0.0
    empirical_rate = count / window_size
    if theoretical_prob > 0:
        return empirical_rate / theoretical_prob
    return 0.0


def compute_gap_score(gaps_since_last: int, average_gap: float, theoretical_cycle: float) -> float:
    """Compute gap/overdue factor.

    Draws since last seen relative to expected cycle length.
    - If gaps_since_last < theoretical_cycle: slightly positive (recent)
    - If gaps_since_last > theoretical_cycle: positive (overdue)
    - Normalized by average gap
    """
    if average_gap == 0:
        return 0.0

    # Ratio of actual gap to expected cycle
    gap_ratio = gaps_since_last / theoretical_cycle if theoretical_cycle > 0 else 0

    # Ratio of actual gap to average gap
    avg_ratio = gaps_since_last / average_gap if average_gap > 0 else 0

    # Combined score: overdue numbers get a boost, recent numbers get modest score
    # Cap at reasonable range
    score = min(avg_ratio / 10, 10.0)  # Normalized score

    return max(score, 0.0)


def compute_composite_score(
    long_term_ratio: float,
    short_term_ratio: float,
    gap_score: float,
    long_term_weight: float = LONG_TERM_WEIGHT,
    short_term_weight: float = SHORT_TERM_WEIGHT,
    gap_weight: float = GAP_WEIGHT,
) -> float:
    """Compute a composite score combining all three signals.

    Returns a positive score representing the overall recommendation strength.
    """
    score = (
        long_term_weight * long_term_ratio
        + short_term_weight * short_term_ratio
        + gap_weight * gap_score
    )
    return max(score, 0.0)


def recommend_numbers(
    long_term_counts: Dict[int, int],
    short_term_counts: Dict[int, int],
    gap_info: Dict[int, Tuple[int, float]],  # (draws_since_last, average_gap)
    total_draws: int,
    main_range: tuple = (1, 50),
    star_range: tuple = (1, 12),
    main_theoretical_prob: float = THEORETICAL_MAIN_PROB,
    star_theoretical_prob: float = THEORETICAL_STAR_PROB,
    window_size: int = 50,
    long_term_weight: float = LONG_TERM_WEIGHT,
    short_term_weight: float = SHORT_TERM_WEIGHT,
    gap_weight: float = GAP_WEIGHT,
) -> Dict[int, float]:
    """Generate recommendation scores for numbers.

    Returns a dict mapping each number to its composite score.
    Scores are relative probabilities (not necessarily summing to 1).
    """
    scores = {}

    # Long-term scores for main numbers
    for num in range(main_range[0], main_range[1] + 1):
        count = long_term_counts.get(num, 0)
        long_term_ratio = compute_long_term_score(count, total_draws, main_theoretical_prob)

        # Short-term recency score
        short_count = short_term_counts.get(num, 0)
        short_term_ratio = compute_short_term_score(short_count, window_size, main_theoretical_prob)

        # Gap score
        gap_draws, average_gap = gap_info.get(num, (0, 1))
        gap_score = compute_gap_score(gap_draws, average_gap, main_theoretical_prob * window_size / total_draws if total_draws > 0 else 1)

        # Composite score
        composite = compute_composite_score(
            long_term_ratio, short_term_ratio, gap_score,
            long_term_weight, short_term_weight, gap_weight,
        )
        scores[num] = composite

    # For Lucky Stars, use the same logic with star parameters
    for star in range(star_range[0], star_range[1] + 1):
        count = long_term_counts.get(star, 0)  # Using main number counts as placeholder;
        # in a full implementation, would use star-specific counts
        long_term_ratio = compute_long_term_score(count, total_draws, star_theoretical_prob)
        short_term_ratio = compute_short_term_score(0, window_size, star_theoretical_prob)  # placeholder
        gap_draws, average_gap = gap_info.get(star, (0, 1))
        gap_score = compute_gap_score(gap_draws, average_gap, star_theoretical_prob * window_size / total_draws if total_draws > 0 else 1)
        composite = compute_composite_score(
            long_term_ratio, short_term_ratio, gap_score,
            long_term_weight, short_term_weight, gap_weight,
        )
        scores[star] = composite

    return scores
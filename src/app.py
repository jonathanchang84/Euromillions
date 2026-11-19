"""Main application entry point for EuroMillions Predictor."""

import sys
import os
from pathlib import Path

# Ensure src directory is in path for imports
src_dir = os.path.dirname(os.path.abspath(__file__))
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

from data_store import (
    load_draws_from_csv,
    write_draws_to_user_csv,
    parse_date,
    parse_main_numbers,
    parse_lucky_stars,
    get_draws_csv_path,
)
from predictor import (
    compute_long_term_score,
    compute_short_term_score,
    compute_gap_score,
    compute_composite_score,
    recommend_numbers,
)
from scraper import scrape_new_draws
try:
    from charts import draw_frequency_chart, draw_trend_chart, draw_probability_bar
except ImportError:
    draw_frequency_chart = draw_trend_chart = draw_probability_bar = None
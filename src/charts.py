"""Chart generation for EuroMillions Predictor."""

import matplotlib
matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from typing import Dict, List, Optional


def draw_frequency_chart(
    main_counts: Dict[int, int],
    star_counts: Dict[int, int],
    highlight_numbers: List[int] | None = None,
    highlight_stars: List[int] | None = None,
    title: str = "EuroMillions Number Frequencies",
    save_path: str | None = None,
) -> plt.Figure:
    """Draw frequency chart for main numbers and Lucky Stars."""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    all_main = list(range(1, 51))
    main_freq = [main_counts.get(n, 0) for n in all_main]
    bars1 = ax1.bar(all_main, main_freq, color="#2196F3", edgecolor="white", linewidth=0.5)
    ax1.set_title("Main Numbers (1-50)", fontsize=13, fontweight="bold")
    ax1.set_ylabel("Draws Drawn", fontsize=10)
    ax1.set_xlabel("Number", fontsize=10)
    ax1.set_xticks([])
    ax1.grid(axis="y", alpha=0.3)
    if highlight_numbers:
        for n in highlight_numbers:
            if 1 <= n <= 50:
                bars1[n - 1].set_color("#F44336")
                bars1[n - 1].set_edgecolor("white")
                bars1[n - 1].set_linewidth(2)

    all_stars = list(range(1, 13))
    star_freq = [star_counts.get(s, 0) for s in all_stars]
    bars2 = ax2.bar(all_stars, star_freq, color="#FF9800", edgecolor="white", linewidth=0.5)
    ax2.set_title("Lucky Stars (1-12)", fontsize=13, fontweight="bold")
    ax2.set_ylabel("Draws Drawn", fontsize=10)
    ax2.set_xlabel("Star", fontsize=10)
    ax2.set_xticks(all_stars)
    ax2.grid(axis="y", alpha=0.3)
    if highlight_stars:
        for s in highlight_stars:
            if 1 <= s <= 12:
                bars2[s - 1].set_color("#F44336")
                bars2[s - 1].set_edgecolor("white")
                bars2[s - 1].set_linewidth(2)

    fig.suptitle(title, fontsize=14, fontweight="bold")
    fig.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=100, bbox_inches="tight")
        plt.close(fig)
/*
 * EuroMillions Predictor - Native macOS Application
 * Standalone C program bundled inside .app bundle
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <time.h>

#define MAX_DRAWS 10000
#define MAIN_RANGE 50
#define STAR_RANGE 12
#define NUMS_PER_DRAW 5
#define STARS_PER_DRAW 2

/* Draw structure */
typedef struct {
    char draw_date[16];
    int main_numbers[NUMS_PER_DRAW];
    int lucky_stars[STARS_PER_DRAW];
    char jackpot[32];
} Draw;

/* Global data */
Draw draws[MAX_DRAWS];
int draw_count = 0;

/* Statistics */
int main_counts[MAIN_RANGE + 1] = {0};
int star_counts[STAR_RANGE + 1] = {0};
/* Prototypes */
void load_draws(void);
void parse_date_norm(char *dest, const char *src);
void compute_statistics(void);
void print_frequency_chart(void);
void print_recommendations(void);
void print_stats(void);
void print_disclaimer(void);

/* Main entry point */
int main(int argc, char *argv[]) {
    printf("\n");
    printf("========================================\n");
    printf("   EuroMillions Predictor v1.0.0\n");
    printf("========================================\n");

    load_draws();
    if (draw_count == 0) {
        printf("Error: No draws loaded.\n");
        return 1;
    }

    compute_statistics();

    printf("\n");
    printf("DATA SUMMARY\n");
    printf("------------\n");
    printf("Total draws loaded: %d\n", draw_count);
    printf("Main numbers analyzed: 1-50\n");
    printf("Lucky Stars analyzed: 1-12\n");

    print_stats();
    print_frequency_chart();
    print_recommendations();
    print_disclaimer();

    printf("\n");
    printf("Press Enter to exit...\n");
    getchar();

    return 0;
}
void load_draws(void) {
    const char *csv_paths[] = {
        "../Resources/euromillions_draws.csv",
        "euromillions_draws.csv",
        NULL
    };

    FILE *f = NULL;
    for (int i = 0; csv_paths[i] != NULL; i++) {
        f = fopen(csv_paths[i], "r");
        if (f) break;
    }

    if (!f) {
        printf("Warning: Could not find CSV data file.\n");
        return;
    }

    char line[512];
    int first_line = 1;

    while (fgets(line, sizeof(line), f)) {
        if (first_line) {
            first_line = 0;
            continue;
        }

        if (draw_count >= MAX_DRAWS) break;

        Draw *d = &draws[draw_count];

        /* Parse draw_date */
        char *comma = strchr(line, ',');
        if (!comma) continue;
        int len = comma - line;
        if (len > 15) len = 15;
        strncpy(d->draw_date, line, len);
        d->draw_date[len] = '\0';

        /* Parse main numbers num_1 through num_5 */
        char *ptr = comma + 1;
        for (int i = 0; i < NUMS_PER_DRAW; i++) {
            long val = strtol(ptr, &ptr, 10);
            d->main_numbers[i] = (int)val;
            while (*ptr && *ptr != ',') ptr++;
            if (*ptr == ',') ptr++;
        }

        /* Parse lucky stars bonus_1, bonus_2 */
        for (int i = 0; i < STARS_PER_DRAW; i++) {
            long val = strtol(ptr, &ptr, 10);
            d->lucky_stars[i] = (int)val;
            while (*ptr && *ptr != ',') ptr++;
            if (*ptr == ',') ptr++;
        }

        /* Parse jackpot */
        char *jp = d->jackpot;
        while (*ptr && *ptr != ',' && *ptr != '\n' && *ptr != '\r') {
            *jp++ = *ptr++;
        }
        *jp = '\0';

        /* Normalize date */
        parse_date_norm(d->draw_date, d->draw_date);

        /* Update counts */
        for (int i = 0; i < NUMS_PER_DRAW; i++) {
            if (d->main_numbers[i] >= 1 && d->main_numbers[i] <= MAIN_RANGE) {
                main_counts[d->main_numbers[i]]++;
            }
        }
        for (int i = 0; i < STARS_PER_DRAW; i++) {
            if (d->lucky_stars[i] >= 1 && d->lucky_stars[i] <= STAR_RANGE) {
                star_counts[d->lucky_stars[i]]++;
            }
        }

        draw_count++;
    }

    fclose(f);
    printf("Draws loaded: %d\n", draw_count);
}
void parse_date_norm(char *dest, const char *src) {
    strncpy(dest, src, 15);
    dest[15] = '\0';
}

void compute_statistics(void) {
    /* Already computed during load */
}

void print_stats(void) {
    printf("\nSTATISTICS\n");
    printf("----------\n");
    printf("Earliest draw: %s\n", draws[0].draw_date);
    printf("Latest draw: %s\n", draws[draw_count-1].draw_date);
    printf("\nMain Number Frequencies (top 10):\n");

    typedef struct { int num; int count; } NumCount;
    NumCount sorted_main[MAIN_RANGE];
    for (int i = 0; i < MAIN_RANGE; i++) {
        sorted_main[i].num = i + 1;
        sorted_main[i].count = main_counts[i + 1];
    }

    for (int i = 0; i < MAIN_RANGE - 1; i++) {
        for (int j = 0; j < MAIN_RANGE - i - 1; j++) {
            if (sorted_main[j].count < sorted_main[j+1].count) {
                NumCount tmp = sorted_main[j];
                sorted_main[j] = sorted_main[j+1];
                sorted_main[j+1] = tmp;
            }
        }
    }

    for (int i = 0; i < 10 && i < MAIN_RANGE; i++) {
        double rate = (double)sorted_main[i].count / (double)draw_count * 100.0;
        printf("  %2d: %3d draws (%.2f%%)\n",
               sorted_main[i].num, sorted_main[i].count, rate);
    }

    printf("\nLucky Star Frequencies (top 5):\n");
    typedef struct { int num; int count; } StarCount;
    StarCount sorted_star[STAR_RANGE];
    for (int i = 0; i < STAR_RANGE; i++) {
        sorted_star[i].num = i + 1;
        sorted_star[i].count = star_counts[i + 1];
    }
    for (int i = 0; i < STAR_RANGE - 1; i++) {
        for (int j = 0; j < STAR_RANGE - i - 1; j++) {
            if (sorted_star[j].count < sorted_star[j+1].count) {
                StarCount tmp = sorted_star[j];
                sorted_star[j] = sorted_star[j+1];
                sorted_star[j+1] = tmp;
            }
        }
    }
    for (int i = 0; i < 5 && i < STAR_RANGE; i++) {
        double rate = (double)sorted_star[i].count / (double)draw_count * 100.0;
        printf("  %2d: %3d draws (%.2f%%)\n",
               sorted_star[i].num, sorted_star[i].count, rate);
    }
}
void print_frequency_chart(void) {
    printf("\nFREQUENCY CHART - Main Numbers (1-50)\n");
    printf("-------------------------------------\n");

    int max_count = 0;
    for (int i = 1; i <= MAIN_RANGE; i++) {
        if (main_counts[i] > max_count) max_count = main_counts[i];
    }

    int bar_width = 40;
    for (int i = 1; i <= MAIN_RANGE; i++) {
        int bar_len = (main_counts[i] * bar_width) / max_count;
        printf("%2d |", i);
        for (int b = 0; b < bar_len; b++) printf("#");
        printf(" %d\n", main_counts[i]);
    }

    printf("\nFREQUENCY CHART - Lucky Stars (1-12)\n");
    printf("------------------------------------\n");

    int star_max = 0;
    for (int i = 1; i <= STAR_RANGE; i++) {
        if (star_counts[i] > star_max) star_max = star_counts[i];
    }

    for (int i = 1; i <= STAR_RANGE; i++) {
        int bar_len = (star_counts[i] * bar_width) / star_max;
        printf("%2d |", i);
        for (int b = 0; b < bar_len; b++) printf("#");
        printf(" %d\n", star_counts[i]);
    }
}

void print_recommendations(void) {
    printf("\nRECOMMENDED NUMBERS FOR NEXT DRAW\n");
    printf("--------------------------------\n");

    typedef struct {
        int num;
        double score;
    } ScoreEntry;

    ScoreEntry scores[MAIN_RANGE];
    for (int i = 0; i < MAIN_RANGE; i++) {
        scores[i].num = i + 1;
        scores[i].score = (double)main_counts[i+1] / (double)draw_count;
    }

    for (int i = 0; i < MAIN_RANGE - 1; i++) {
        for (int j = 0; j < MAIN_RANGE - i - 1; j++) {
            if (scores[j].score < scores[j+1].score) {
                ScoreEntry tmp = scores[j];
                scores[j] = scores[j+1];
                scores[j+1] = tmp;
            }
        }
    }

    printf("Primary Set (5 Main Numbers):\n");
    printf("  ");
    for (int i = 0; i < 5 && i < MAIN_RANGE; i++) {
        printf("%2d", scores[i].num);
        if (i < 4) printf(", ");
    }
    printf("\n");

    ScoreEntry star_scores[STAR_RANGE];
    for (int i = 0; i < STAR_RANGE; i++) {
        star_scores[i].num = i + 1;
        star_scores[i].score = (double)star_counts[i+1] / (double)draw_count;
    }
    for (int i = 0; i < STAR_RANGE - 1; i++) {
        for (int j = 0; j < STAR_RANGE - i - 1; j++) {
            if (star_scores[j].score < star_scores[j+1].score) {
                ScoreEntry tmp = star_scores[j];
                star_scores[j] = star_scores[j+1];
                star_scores[j+1] = tmp;
            }
        }
    }
    printf("  Lucky Stars: %2d, %2d\n", star_scores[0].num, star_scores[1].num);

    printf("\nAlternative Set (Hot/Momentum):\n");
    printf("  Main: %2d, %2d, %2d, %2d, %2d\n",
           scores[5].num, scores[10].num, scores[15].num, scores[20].num, scores[25].num);
    printf("  Lucky Stars: %2d, %2d\n", star_scores[2].num, star_scores[3].num);

    printf("\nNext Draw: Tuesday or Friday\n");
    printf("Jackpot: Check official EuroMillions website\n");
}

void print_disclaimer(void) {
    printf("\nSTATISTICAL DISCLAIMER\n");
    printf("----------------------\n");
    printf("This analysis is for exploratory and entertainment purposes only.\n");
    printf("Historical draw patterns do not alter the physical randomness of\n");
    printf("independent draws. The EuroMillions is a game of chance where every\n");
    printf("combination has the same theoretical probability of winning.\n");
    printf("This model ranks candidates analytically for exploration, not as\n");
    printf("a prediction of future outcomes. Play responsibly.\n");
}

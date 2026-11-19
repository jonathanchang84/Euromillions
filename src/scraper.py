"""Web scraper for EuroMillions draws from LottoROI."""

import bs4
import requests
from datetime import datetime
from pathlib import Path

BASE_URL = "https://lottoroi.com"
DRAWS_URL = BASE_URL + "/en/lottery/euromillions/draws"


def fetch_page(url: str, headers: dict | None = None) -> bs4.BeautifulSoup | None:
    """Fetch a web page and return BeautifulSoup object."""
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        return bs4.BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"Warning: could not fetch {url}: {e}")
        return None


def parse_draw_date(raw: str) -> str:
    """Normalise a date string to YYYY-MM-DD format."""
    if not raw:
        return ""
    raw = raw.strip()
    if raw.count("-") >= 2 and raw[:4].isdigit():
        return raw
    from datetime import datetime
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%b %d, %Y", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw


def get_year_pages() -> list[tuple[str, str]]:
    """Get list of (year, year_page_url) for EuroMillions draws."""
    soup = fetch_page(DRAWS_URL)
    if not soup:
        return []

    year_links = []
    for link in soup.select("a"):
        href = link.get("href", "")
        if href.startswith("/en/lottery/euromillions/draws/"):
            year = href.split("/")[-1] if "/" in href else ""
            if year.isdigit() and int(year) >= 2004:
                full_url = BASE_URL + href if href.startswith("/") else href
                year_links.append((year, full_url))

    seen = set()
    unique_links = []
    for y, u in year_links:
        if y not in seen:
            seen.add(y)
            unique_links.append((y, u))

    return unique_links


def parse_draw_row(row: bs4.Tag) -> dict | None:
    """Parse a single draw row from the LottoROI table."""
    cols = row.find_all("td")
    if len(cols) < 5:
        return None

    date_elem = cols[0].get_text(strip=True)
    draw_date = parse_draw_date(date_elem)
    if not draw_date:
        return None

    numbers_raw = cols[3].get_text(strip=True) if len(cols) > 3 else ""
    main_numbers = []
    for part in numbers_raw.replace("·", ",").replace("•", ",").split(","):
        part = part.strip()
        if part.isdigit():
            n = int(part)
            if 1 <= n <= 50:
                main_numbers.append(n)
    main_numbers = sorted(main_numbers[:5])

    stars_raw = cols[4].get_text(strip=True) if len(cols) > 4 else ""
    lucky_stars = []
    for part in stars_raw.replace("·", ",").replace("•", ",").split(","):
        part = part.strip()
        if part.isdigit():
            n = int(part)
            if 1 <= n <= 12:
                lucky_stars.append(n)
    lucky_stars = sorted(lucky_stars[:2])

    jackpot = cols[2].get_text(strip=True) if len(cols) > 2 else ""

    source_url = ""
    if cols[0].find("a"):
        source_url = BASE_URL + cols[0].find("a")["href"]

    return {
        "draw_date": draw_date,
        "num_1": main_numbers[0] if len(main_numbers) > 0 else 0,
        "num_2": main_numbers[1] if len(main_numbers) > 1 else 0,
        "num_3": main_numbers[2] if len(main_numbers) > 2 else 0,
        "num_4": main_numbers[3] if len(main_numbers) > 3 else 0,
        "num_5": main_numbers[4] if len(main_numbers) > 4 else 0,
        "lucky_star_1": lucky_stars[0] if len(lucky_stars) > 0 else 0,
        "lucky_star_2": lucky_stars[1] if len(lucky_stars) > 1 else 0,
        "jackpot": jackpot,
        "source_url": source_url,
    }


def scrape_new_draws(existing_dates: set[str]) -> list[dict]:
    """Scrape newer draws from LottoROI and return only new records.

    Returns list of draw dicts for dates not already in existing_dates.
    """
    new_draws = []
    year_pages = get_year_pages()

    soup = fetch_page(DRAWS_URL)
    if not soup:
        return new_draws

    for row in soup.select("tr"):
        parsed = parse_draw_row(row)
        if parsed and parsed["draw_date"] not in existing_dates:
            new_draws.append(parsed)

    for year, year_url in year_pages:
        soup = fetch_page(year_url)
        if not soup:
            continue
        for row in soup.select("tr"):
            parsed = parse_draw_row(row)
            if parsed and parsed["draw_date"] not in existing_dates:
                new_draws.append(parsed)

    seen_dates = set()
    deduped_draws = []
    for d in new_draws:
        if d["draw_date"] not in seen_dates:
            seen_dates.add(d["draw_date"])
            deduped_draws.append(d)

    return deduped_draws
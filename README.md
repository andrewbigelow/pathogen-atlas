# Pathogen Atlas

This is the Team 5 interactive visualization of **NCBI Pathogen Detection** isolates joined to **USDA ERS Farm Income and Wealth Statistics** (annual cash receipts by commodity and state). It implements visualization tasks T1–T9 from the process book.

The stack is FastAPI with DuckDB on the backend and React, TypeScript, D3 and us-atlas on the frontend.

## Run it

### Option A: one command (macOS/Linux, needs Python 3.10+ and Node 20+)

```bash
./run.sh
```

Then open http://localhost:8000.

The script does the following:

1. Creates `.venv` and installs `backend/requirements.txt`.
2. Uses `data/processed/*.parquet` if it exists (about 24 MB, included). If it doesn't exist, the script downloads the raw data (about 1.8 GB) and rebuilds it.
3. Builds the frontend into `frontend/dist`.
4. Serves both the API and the app on port 8000.

Use `PORT=9000 ./run.sh` to change the port, and `REBUILD=1 ./run.sh` to rebuild the frontend.

### Option B: Docker

```bash
docker compose up --build
```

Then open http://localhost:8000. The image uses the prebuilt `data/processed` files.

### Frontend development (hot reload)

```bash
.venv/bin/uvicorn backend.main:app --port 8000 --reload   # terminal 1
cd frontend && npm install && npm run dev                  # terminal 2 -> http://localhost:5173
```

## Refresh the data

```bash
./pipeline/download.sh                 # latest NCBI snapshot + latest USDA release
.venv/bin/python pipeline/build_data.py
```

By default the download includes Salmonella, Campylobacter, Listeria and E. coli/Shigella. To limit it, set `ATLAS_ORGANISMS="Salmonella Listeria"`.

## What is in the data

| Organism | US isolates | With state | In a SNP cluster |
|---|---|---|---|
| Salmonella | 573,428 | 134,638 | 523,966 |
| E. coli / Shigella | 204,726 | 66,677 | 136,785 |
| Campylobacter | 102,031 | 63,288 | 88,527 |
| Listeria | 38,470 | 24,266 | 32,539 |

The data also includes 3.4M isolate × AMR gene calls (3,543 distinct genes) and USDA cash receipts for 50 states, 1990–2026, across 11 commodity groups.

Counts are from the NCBI snapshot of 13–15 Nov 2026 and the USDA release of 3 Sep 2026.

### Derived fields (`pipeline/build_data.py`)

- **state**: taken from `food_origin` (for example `USA:CA`) when it is present, otherwise from `geo_loc_name`.
- **year**: the first four digits of `collection_date`.
- **source**:
  - Human clinical, Food, Animal or Environment, from `epi_type`, `source_type` and `IFSAC_category`.
  - Records with none of those (mostly FSIS meat and cecal samples) are classified from free-text `isolation_source` and `host` keywords.
  - About 11k records stay Unknown.
- **subsource**: the IFSAC food category, the animal species, or the environment type. Labels are standardized and the long tail is folded into "other".
- **AMR gene**: `AMR_genotypes` split on commas, with `=PARTIAL`/`=COMPLETE` suffixes removed.

## Tasks → views

| Task | Tab | View |
|---|---|---|
| T1 states above an adjusted-rate threshold | Geography | Choropleth + ranked bars + log threshold slider |
| T2 years a state is above threshold | Geography | State × year heatmap (dots mark years above threshold) + focus line chart |
| T3 compare states on AMR gene prevalence | Resistance | Choropleth + ranked prevalence with 95% Wilson CI + national trend |
| T4 prevalence vs adjusted detection discrepancy | Resistance | Log scatter, percentile-rank discrepancy slider, flagged table |
| T5 top-k clusters above a discovery-rate threshold | SNP clusters | Ranked bars stacked by source, threshold line |
| T6 clusters with similar discovery curves | SNP clusters | Correlation network (force layout) + small multiples + correlation matrix |
| T7 source share of a gene's carriers over time | Sources | Stacked area (share / count / carriage %) + sub-source treemap |
| T8 compare source shares between states over time | Sources | Small-multiple 100% bars per state + per-state treemap |
| T9 share with usable date and state | Header (always visible) + Data coverage tab | Proportional bar linked to the filters; breakdown by source and year |

The header holds a two-thumb year slider with a **Combine years by** selector (sum, mean, median, min, max). Each measure is computed per year and then combined; "sum" pools the years.

Below it, the **Selected states** bar holds the shared state selection. Click a state on any chart to select only that state; Ctrl/⌘-click adds or removes one. The selection drives the line comparison on Geography, the selected-states table and trend lines on Resistance, the optional "Selected states" scope on SNP clusters, and the panels on Sources.

Each tab has its own filter row with the dropdowns that apply to it:

- **Normalize by**: economic output (receipts of a chosen commodity), species (each host species divided by its own commodity), or none.
- **Pathogen species**, **Host species** and **Food product**: checkbox dropdowns. Check several to combine them (for example chicken + cattle); nothing checked means all. Food products are grouped by host and limited to the checked hosts.
- **AMR gene(s)**: searchable checkboxes. Several genes means isolates carrying any of them.
- **Min. isolates**.
- **Isolate sources**.

The pathogen, host, product, source and normalization choices are shared across tabs.

## Credits

Data comes from NCBI Pathogen Detection (please acknowledge NCBI and the submitting agencies) and USDA ERS Farm Income and Wealth Statistics (public domain).

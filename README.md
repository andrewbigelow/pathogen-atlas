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

| Task | Page | View |
|---|---|---|
| T1 states above an adjusted-rate threshold | State surveillance | Shared map (colour by detection rate) + linear ranked bars with a draggable threshold line/handle |
| T2 years a state is above threshold | State surveillance | Line chart per selected state, draggable horizontal threshold (synced with T1), years above listed in the summary table |
| T3 compare states on AMR gene prevalence | State surveillance | Map (colour by prevalence) + ranked prevalence with 95% Wilson CI + selected states vs national trend |
| T4 prevalence vs detection discrepancy | State surveillance | Log scatter coloured red/blue/grey by discrepancy threshold, flagged table, map colouring |
| T5 top-k clusters above a discovery-rate threshold | SNP clusters | Ranked bars stacked by source, top-k stepper, draggable threshold |
| T6 clusters with similar discovery curves | SNP clusters | Correlation network + detail panel + small multiples (peak marker) + correlation matrix |
| T7 source share of a gene's carriers over time | Isolate sources | One line per chosen source (share among chosen / of all / count / carriage %) + sub-source treemap |
| T8 compare source shares between states | Isolate sources | Map to pick states + one sub-source treemap per state, side by side |
| T9 share with usable date and state | Header widget + Data coverage drawer | Summary for the current page's filters; drawer breaks it down by source, year, state provenance and date precision |

The **State surveillance** page has one map shared by T1, T3 and T4. A "Colour map by" dropdown picks the measure, and the year range and "Combine years by" dropdown sit under the map. States selected on the map, bars or scatter appear in a summary table (rate, years above threshold, prevalence with CI, discrepancy) and drive every section below. Plain click selects one item; Ctrl/⌘-click adds or removes. This applies everywhere, including clusters.

Each page keeps **its own filters**, grouped as Isolates / AMR / Time / Measure, so changing one page never changes another:

- **Normalize by**: economic output (receipts of a chosen commodity), species (each host species divided by its own commodity), or none.
- **Pathogen species**, **Host species** and **Food product**: checkbox dropdowns. Check several to combine them; nothing checked means all.
- **AMR gene(s)**: searchable checkboxes. Several genes means isolates carrying any of them; none means any AMR gene.
- **Isolate sources**: Food and Environment on the state page (clinical isolates rarely report a state); all sources on Sources and SNP clusters.

## Credits

Data comes from NCBI Pathogen Detection (please acknowledge NCBI and the submitting agencies) and USDA ERS Farm Income and Wealth Statistics (public domain).

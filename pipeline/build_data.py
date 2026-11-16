"""
Build the processed data used by the Pathogen Atlas app.

Inputs (downloaded by pipeline/download.sh into data/raw/):
  - <Organism>.amr.metadata.tsv   NCBI Pathogen Detection isolate metadata + AMRFinderPlus results
  - <Organism>.clusters.tsv       NCBI SNP cluster membership (PDS_acc -> target_acc)
  - usda/FarmIncome_WealthStatisticsData_*.csv   USDA ERS Farm Income and Wealth Statistics

Outputs (data/processed/):
  - isolates.parquet   one row per US isolate with derived state / year / source fields
  - genes.parquet      one row per (isolate, AMR gene) for US isolates
  - receipts.parquet   state x year x commodity group cash receipts ($1,000)

Run:  python pipeline/build_data.py
"""
from __future__ import annotations

import glob
import os
import sys

import duckdb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "processed")

ORGANISMS = {
    "Salmonella": "Salmonella",
    "Campylobacter": "Campylobacter",
    "Listeria": "Listeria",
    "Escherichia_coli_Shigella": "E. coli / Shigella",
}

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

# USDA commodity groups exposed in the app: key -> (label, VariableDescriptionPart1, Part2)
COMMODITIES = {
    "all": ("All commodities", "All Commodities", "All"),
    "animals": ("Animals and products", "Animals and products", "All"),
    "cattle": ("Cattle and calves", "Cattle and calves", "All"),
    "hogs": ("Hogs", "Hogs", "All"),
    "poultry": ("Poultry and eggs", "Poultry/Eggs", "All"),
    "broilers": ("Broilers", "Broilers", "All"),
    "eggs": ("Chicken eggs", "Chicken eggs", "All"),
    "dairy": ("Dairy products", "Dairy products", "All"),
    "turkeys": ("Turkeys", "Turkeys", "All"),
    "aquaculture": ("Aquaculture", "Aquaculture", "All"),
    "vegetables": ("Vegetables and melons", "Vegetables and melons", "All"),
    "fruits": ("Fruits and nuts", "Fruits/Nuts", "All"),
    "crops": ("All crops", "Crops", "All"),
}


def build_isolates(con: duckdb.DuckDBPyConnection) -> None:
    con.execute("CREATE TABLE states(abbr VARCHAR, name VARCHAR)")
    con.executemany("INSERT INTO states VALUES (?, ?)", list(STATES.items()))

    parts = []
    for key, label in ORGANISMS.items():
        meta = os.path.join(RAW, f"{key}.amr.metadata.tsv")
        clus = os.path.join(RAW, f"{key}.clusters.tsv")
        if not os.path.exists(meta):
            print(f"  ! missing {meta}, skipping {label}")
            continue
        print(f"  reading {label} ...", flush=True)
        con.execute(f"""
            CREATE OR REPLACE TEMP TABLE raw AS
            SELECT target_acc, biosample_acc, scientific_name, serovar, strain, epi_type,
                   source_type, IFSAC_category, isolation_source, host, collection_date,
                   target_creation_date, geo_loc_name, food_origin, AMR_genotypes,
                   number_amr_genes, minsame, mindiff
            FROM read_csv('{meta}', delim='\t', all_varchar=true, quote='', header=true,
                          ignore_errors=true, parallel=true)
            WHERE geo_loc_name LIKE 'USA%' OR food_origin LIKE 'USA%'
        """)
        if os.path.exists(clus):
            con.execute(f"""
                CREATE OR REPLACE TEMP TABLE clus AS
                SELECT DISTINCT target_acc, PDS_acc FROM read_csv('{clus}', delim='\t',
                    all_varchar=true, header=true)
            """)
        else:
            con.execute("CREATE OR REPLACE TEMP TABLE clus(target_acc VARCHAR, PDS_acc VARCHAR)")
        con.execute(f"""
            CREATE OR REPLACE TEMP TABLE part_{key} AS
            SELECT '{label}' AS organism, r.*, c.PDS_acc FROM raw r
            LEFT JOIN clus c USING (target_acc)
        """)
        parts.append(f"part_{key}")

    if not parts:
        sys.exit("No NCBI metadata found in data/raw. Run pipeline/download.sh first.")

    con.execute("CREATE TABLE raw_all AS " + " UNION ALL ".join(f"SELECT * FROM {p}" for p in parts))

    # --- derive fields -----------------------------------------------------------------
    # state: prefer food origin (where the food came from), else sampling location
    con.execute(r"""
        CREATE TABLE iso AS
        WITH s AS (
            SELECT *,
              nullif(trim(split_part(regexp_replace(food_origin, '^USA\s*:?', ''), ',', 1)), '') AS fo_tok,
              nullif(trim(split_part(regexp_replace(geo_loc_name, '^USA\s*:?', ''), ',', 1)), '') AS geo_tok,
              lower(coalesce(IFSAC_category, '')) AS ifsac,
              lower(coalesce(source_type, '')) AS stype,
              lower(coalesce(isolation_source, '')) AS isrc,
              lower(coalesce(host, '')) AS lhost
            FROM raw_all
        ), st AS (
            SELECT s.*,
              (SELECT abbr FROM states WHERE upper(fo_tok) = abbr OR lower(fo_tok) = lower(name) LIMIT 1) AS fo_state,
              (SELECT abbr FROM states WHERE upper(geo_tok) = abbr OR lower(geo_tok) = lower(name) LIMIT 1) AS geo_state
            FROM s
        )
        SELECT
          organism,
          target_acc,
          biosample_acc,
          scientific_name,
          nullif(nullif(nullif((SELECT upper(substr(v, 1, 1)) || lower(substr(v, 2)) FROM (SELECT trim(regexp_replace(serovar,
                 '^(Salmonella enterica subsp\. enterica serovar|Salmonella enterica serovar|Salmonella)\s+', '', 'i')) AS v)),
                 'Null'), 'Not provided'), '') AS serovar,
          nullif(PDS_acc, 'NULL') AS cluster,
          coalesce(fo_state, geo_state) AS state,
          CASE WHEN fo_state IS NOT NULL THEN 'food_origin'
               WHEN geo_state IS NOT NULL THEN 'geo_loc_name' END AS state_from,
          TRY_CAST(substr(collection_date, 1, 4) AS INTEGER) AS year,
          CASE WHEN regexp_matches(collection_date, '^\d{4}-\d{2}')
               THEN TRY_CAST(substr(collection_date, 1, 7) || '-01' AS DATE) END AS month,
          TRY_CAST(substr(target_creation_date, 1, 4) AS INTEGER) AS create_year,
          CASE
            WHEN epi_type = 'clinical' AND (stype IN ('human','', 'null', 'not provided') ) THEN 'Human clinical'
            WHEN stype = 'food' OR (ifsac <> '' AND ifsac <> 'null'
                   AND NOT regexp_matches(ifsac, '^(environmental|clinical|veterinary|animal feed)')) THEN 'Food'
            WHEN stype = 'animal' OR ifsac LIKE 'veterinary%' OR ifsac = 'animal feed'
                 OR stype = 'animal feed' THEN 'Animal'
            WHEN stype = 'environmental' OR ifsac LIKE 'environmental%' THEN 'Environment'
            WHEN epi_type = 'clinical' THEN 'Human clinical'
            -- free-text standardization for records with no source_type / IFSAC category
            WHEN regexp_matches(isrc, '^animal|cecal|caecal|cloaca|rectal|bovine feces|boot sock|drag swab|litter')
                 THEN 'Animal'
            WHEN regexp_matches(isrc, 'water|sewage|soil|sediment|compost|environment|drain|floor|surface|sponge|swab')
                 THEN 'Environment'
            WHEN regexp_matches(isrc, 'chicken|beef|pork|turkey|product|comminuted|ground|carcass|meat|breast|wing|thigh|leg|egg|milk|cheese|dairy|lettuce|spinach|sprout|produce|fish|shrimp|seafood|food|sausage|ham|veal|lamb|cucumber|tomato|pepper|cilantro|nut|flour|spice|duck|liver|giblet|rinse|brisket|trim')
                 THEN 'Food'
            WHEN regexp_matches(isrc, 'feces|faeces|fecal|stool|manure') AND lhost NOT IN ('', 'null', 'homo sapiens', 'human')
                 THEN 'Animal'
            WHEN lhost NOT IN ('', 'null', 'not provided', 'missing', 'homo sapiens', 'human', 'not applicable')
                 THEN 'Animal'
            ELSE 'Unknown'
          END AS source,
          ifsac, stype, isrc, lhost,
          nullif(AMR_genotypes, 'NULL') AS amr,
          TRY_CAST(number_amr_genes AS INTEGER) AS n_amr,
          TRY_CAST(minsame AS INTEGER) AS minsame,
          TRY_CAST(mindiff AS INTEGER) AS mindiff
        FROM st
    """)

    # sub-source: finer grained label inside each source
    con.execute(r"""
        CREATE TABLE isolates AS
        SELECT * EXCLUDE (ifsac, stype, isrc, lhost),
          CASE
            WHEN source = 'Food' AND ifsac NOT IN ('', 'null') THEN
                 trim(regexp_replace(split_part(ifsac, '|', 1), '\s*\(.*\)$', ''))
            WHEN source = 'Food' AND regexp_matches(isrc, 'chicken|poultry|duck|giblet') THEN 'chicken'
            WHEN source = 'Food' AND regexp_matches(isrc, 'turkey') THEN 'turkey'
            WHEN source = 'Food' AND regexp_matches(isrc, 'beef|veal|brisket|bovine') THEN 'beef'
            WHEN source = 'Food' AND regexp_matches(isrc, 'pork|ham|sausage|swine') THEN 'pork'
            WHEN source = 'Food' AND regexp_matches(isrc, 'egg') THEN 'eggs'
            WHEN source = 'Food' AND regexp_matches(isrc, 'milk|cheese|dairy') THEN 'dairy'
            WHEN source = 'Food' AND regexp_matches(isrc, 'fish|shrimp|seafood|salmon|tuna') THEN 'fish'
            WHEN source = 'Food' AND regexp_matches(isrc, 'lettuce|spinach|sprout|produce|cucumber|tomato|pepper|cilantro')
                 THEN 'vegetable row crops'
            WHEN source = 'Food' THEN 'unspecified food'
            WHEN source = 'Animal' AND ifsac LIKE 'veterinary%' AND position('|' IN ifsac) > 0
                 AND trim(split_part(ifsac, '|', 2)) NOT IN ('other animal', '')
                 THEN replace(replace(trim(split_part(ifsac, '|', 2)), 'cow', 'cattle'), 'pig', 'swine')
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'chicken|gallus|poultry|broiler|layer|hen') THEN 'chicken'
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'turkey|meleagris') THEN 'turkey'
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'cattle|bovine|bos |bos$|cow|steer|heifer|calf|calves') THEN 'cattle'
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'swine|sus scrofa|pig|porcine|sow|hog') THEN 'swine'
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'canis|dog|canine|felis|cat |feline|equus|horse|equine')
                 THEN 'companion animal'
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'ovis|sheep|ovine|goat|capra') THEN 'sheep / goat'
            WHEN source = 'Animal' AND regexp_matches(isrc || ' ' || lhost, 'bird|avian|wild') THEN 'wild bird / wildlife'
            WHEN source = 'Animal' THEN 'other animal'
            WHEN source = 'Environment' AND ifsac LIKE 'environmental-%'
                 THEN replace(split_part(ifsac, '|', 1), 'environmental-', '')
            WHEN source = 'Environment' AND regexp_matches(isrc, 'water|river|creek|irrigation|pond|lake')
                 THEN 'water'
            WHEN source = 'Environment' AND regexp_matches(isrc, 'soil|sediment|compost|manure')
                 THEN 'soil / manure'
            WHEN source = 'Environment' AND regexp_matches(isrc, 'swab|sponge|drain|floor|facility|plant|surface|equipment')
                 THEN 'facility surface'
            WHEN source = 'Environment' THEN 'other environment'
            WHEN source = 'Human clinical' AND regexp_matches(isrc, 'stool|feces|faeces|fecal')
                 THEN 'stool'
            WHEN source = 'Human clinical' AND regexp_matches(isrc, 'blood') THEN 'blood'
            WHEN source = 'Human clinical' AND regexp_matches(isrc, 'urine') THEN 'urine'
            WHEN source = 'Human clinical' THEN 'other / unspecified'
            ELSE 'unknown'
          END AS subsource
        FROM iso
    """)

    # canonicalize messy sub-source labels and fold the long tail into "other"
    con.execute(r"""
        UPDATE isolates SET subsource = CASE
            WHEN regexp_matches(subsource, '^mu.?ti.?ingr|^multi') THEN 'multi-ingredient'
            WHEN subsource IN ('cow', 'meat') THEN 'beef'
            WHEN subsource = 'pig' THEN 'pork'
            WHEN subsource IN ('poultry', 'avian', 'other poultry') AND source = 'Food' THEN 'chicken'
            WHEN subsource IN ('poultry', 'avian', 'other poultry') THEN 'chicken'
            WHEN subsource LIKE 'factory/production facility%' THEN 'factory/production facility'
            WHEN subsource IN ('diary') THEN 'dairy'
            WHEN subsource LIKE 'dietary sup%' THEN 'dietary supplement'
            WHEN subsource IN ('vegetable', 'vegetables', 'herbs', 'sprouts') THEN 'vegetable row crops'
            WHEN subsource IN ('wild animal') THEN 'wild bird / wildlife'
            ELSE subsource END
    """)
    con.execute("""
        UPDATE isolates SET subsource = 'other ' || lower(source)
        WHERE source IN ('Food', 'Animal', 'Environment') AND (source, subsource) IN (
            SELECT (source, subsource) FROM isolates GROUP BY source, subsource HAVING count(*) < 150)
    """)


def build_receipts(con: duckdb.DuckDBPyConnection) -> None:
    print("Building USDA cash receipts ...")
    usda = sorted(glob.glob(os.path.join(RAW, "usda", "FarmIncome_WealthStatisticsData_*.csv")))
    if not usda:
        sys.exit("USDA file not found in data/raw/usda")
    con.execute(f"""
        CREATE TABLE usda AS SELECT * FROM read_csv('{usda[-1]}', all_varchar=true, header=true,
             encoding='latin-1')
    """)
    con.execute("CREATE TABLE cmap(key VARCHAR, label VARCHAR, p1 VARCHAR, p2 VARCHAR)")
    con.executemany("INSERT INTO cmap VALUES (?,?,?,?)", [(k, *v) for k, v in COMMODITIES.items()])
    con.execute(f"""
        COPY (
          SELECT c.key AS commodity, c.label, u.State AS state, CAST(u.Year AS INTEGER) AS year,
                 max(TRY_CAST(u.Amount AS DOUBLE)) AS receipts_k
          FROM usda u JOIN cmap c ON u.VariableDescriptionPart1 = c.p1 AND u.VariableDescriptionPart2 = c.p2
          WHERE u.VariableDescriptionTotal LIKE 'Cash receipts value%' AND u.State <> 'US'
            AND CAST(u.Year AS INTEGER) >= 1990
          GROUP BY ALL
        ) TO '{OUT}/receipts.parquet' (FORMAT parquet)
    """)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    con = duckdb.connect()
    print("Building isolates ...")
    build_isolates(con)
    con.execute(f"COPY (SELECT * EXCLUDE (amr) FROM isolates) TO '{OUT}/isolates.parquet' (FORMAT parquet, COMPRESSION zstd)")

    print("Building AMR gene table ...")
    # AMR_genotypes looks like: "blaTEM-1,tet(A)=PARTIAL,aac(6')-Iaa"  -> strip quotes and =SUFFIX
    con.execute(rf"""
        COPY (
          SELECT DISTINCT target_acc,
                 regexp_replace(trim(g), '=.*$', '') AS gene
          FROM (SELECT target_acc, unnest(string_split(replace(amr, '"', ''), ',')) AS g
                FROM isolates WHERE amr IS NOT NULL)
          WHERE trim(g) <> ''
        ) TO '{OUT}/genes.parquet' (FORMAT parquet, COMPRESSION zstd)
    """)

    build_receipts(con)

    # summary
    print(con.sql("SELECT organism, count(*) n, count(state) with_state, count(year) with_year, "
                  "count(cluster) in_cluster FROM isolates GROUP BY 1 ORDER BY 2 DESC"))
    print(con.sql("SELECT source, count(*) FROM isolates GROUP BY 1 ORDER BY 2 DESC"))
    print("Done ->", OUT)


if __name__ == "__main__":
    if "--receipts-only" in sys.argv:
        build_receipts(duckdb.connect())
    else:
        main()

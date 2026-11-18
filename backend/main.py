"""Pathogen Atlas API: FastAPI + DuckDB over the processed parquet files."""
from __future__ import annotations

import os
import threading
from functools import lru_cache
from typing import Optional

import duckdb
import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("ATLAS_DATA", os.path.join(ROOT, "data", "processed"))
STATIC = os.environ.get("ATLAS_STATIC", os.path.join(ROOT, "frontend", "dist"))

NONCLINICAL = ("Food", "Animal", "Environment")
ALL_SOURCES = ("Human clinical", "Food", "Animal", "Environment", "Unknown")

# host animal species for Food / Animal sub-sources, and the USDA commodity that matches each one
SUB_HOST = {
    "chicken": "chicken", "eggs": "chicken", "cattle": "cattle", "beef": "cattle", "dairy": "cattle",
    "swine": "swine", "pork": "swine", "turkey": "turkey", "fish": "fish", "crustaceans": "fish",
    "mollusks": "fish", "sheep / goat": "sheep / goat", "companion animal": "companion animal",
    "wild bird / wildlife": "wildlife",
}
SUB_COMM = {
    "chicken": "broilers", "eggs": "eggs", "cattle": "cattle", "beef": "cattle", "dairy": "dairy",
    "swine": "hogs", "pork": "hogs", "turkey": "turkeys", "fish": "aquaculture",
    "crustaceans": "aquaculture", "mollusks": "aquaculture",
}
HOSTS = ["chicken", "cattle", "swine", "turkey", "fish", "sheep / goat", "companion animal", "wildlife"]
HOST_LABEL = {"chicken": "Chicken", "cattle": "Cattle", "swine": "Swine", "turkey": "Turkey",
              "fish": "Fish & shellfish", "sheep / goat": "Sheep / goat",
              "companion animal": "Companion animal", "wildlife": "Wild bird / wildlife"}

app = FastAPI(title="Pathogen Atlas API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_base = duckdb.connect()
for name in ("isolates", "genes", "receipts"):
    path = os.path.join(DATA, f"{name}.parquet")
    if not os.path.exists(path):
        raise SystemExit(f"Missing {path}. Run `python pipeline/build_data.py` first.")
    _base.execute(f"CREATE TABLE {name} AS SELECT * FROM read_parquet('{path}')")
_host_case = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in SUB_HOST.items())
_base.execute(f"""ALTER TABLE isolates ADD COLUMN host VARCHAR""")
_base.execute(f"""UPDATE isolates SET host = CASE subsource {_host_case} END
                  WHERE source IN ('Food', 'Animal')""")
_base.execute("CREATE INDEX IF NOT EXISTS g_idx ON genes(gene)")
_lock = threading.Lock()


def q(sql: str, params: list | None = None) -> list[dict]:
    cur = _base.cursor()
    try:
        res = cur.execute(sql, params or [])
        cols = [d[0] for d in res.description]
        return [dict(zip(cols, row)) for row in res.fetchall()]
    finally:
        cur.close()


def split(v: Optional[str]) -> list[str]:
    """Comma-separated query value -> list (gene names never contain commas)."""
    return [x for x in (v or "").split(",") if x]


def qs(xs: list) -> str:
    return ",".join("?" * len(xs))


class F:
    """Shared isolate filters, read from the query string."""

    def __init__(self, organism: str = "", y0: int = 2012, y1: int = 2025,
                 sources: Optional[str] = None, host: str = "", product: str = "", gene: str = "",
                 states: str = ""):
        self.y0, self.y1, self.sources = y0, y1, sources
        self.organisms = [o for o in split(organism) if o != "All"]
        self.hosts, self.products, self.genes = split(host), split(product), split(gene)
        self.states = [s for s in split(states) if len(s) == 2][:12]

    def subs(self) -> Optional[list[str]]:
        """Sub-sources allowed by the host / product checkboxes (None = no restriction).
        Hosts are combined with OR; products narrow the result to those food products."""
        if not self.hosts and not self.products:
            return None
        subs = {s for s, h in SUB_HOST.items() if h in self.hosts} if self.hosts else None
        if self.products:
            subs = set(self.products) if subs is None else subs & set(self.products)
        return sorted(subs)

    def commodities(self) -> list[str]:
        """USDA commodities matching the host / product filter (for species normalisation)."""
        subs = self.subs()
        keys = SUB_COMM if subs is None else {s: SUB_COMM[s] for s in subs if s in SUB_COMM}
        return sorted(set(keys.values()))

    def sql(self, alias: str = "i", require_year: bool = True, species_only: bool = False,
            default_sources: tuple = NONCLINICAL) -> tuple[str, list]:
        a = f"{alias}." if alias else ""
        clauses, params = [], []
        if self.organisms:
            clauses.append(f"{a}organism IN ({qs(self.organisms)})")
            params += self.organisms
        if require_year:
            clauses.append(f"{a}year BETWEEN ? AND ?")
            params += [self.y0, self.y1]
        src = parse_sources(self.sources, default_sources)
        clauses.append(f"{a}source IN ({','.join('?' * len(src))})")
        params += src
        subs = self.subs()
        if species_only:
            subs = [s for s in (subs if subs is not None else list(SUB_COMM)) if s in SUB_COMM]
        if subs is not None:
            if not subs:
                clauses.append("FALSE")
            else:
                clauses.append(f"{a}source IN ('Food', 'Animal') AND {a}subsource IN ({','.join('?' * len(subs))})")
                params += subs
        if self.products:
            clauses.append(f"{a}source = 'Food'")
        if self.genes:
            clauses.append(f"{a}target_acc IN (SELECT target_acc FROM genes WHERE gene IN ({qs(self.genes)}))")
            params += self.genes
        if self.states:
            clauses.append(f"{a}state IN ({','.join('?' * len(self.states))})")
            params += self.states
        return " AND ".join(clauses), params

    def key(self) -> tuple:
        """Hashable key; F.from_key(key) rebuilds the filter (used by the lru caches)."""
        j = ",".join
        return (j(self.organisms), self.y0, self.y1, self.sources, j(self.hosts),
                j(self.products), j(self.genes), j(self.states))

    @staticmethod
    def from_key(k: tuple) -> "F":
        return F(*k[:7], states=k[7])


def receipts_cte(norm: str, commodity: str, f: F) -> tuple[str, list]:
    """SQL for r(state, year, receipts_k) under the chosen normalisation."""
    if norm == "species":
        comms = f.commodities() or ["__none__"]
        return (f"""SELECT state, year, sum(receipts_k) AS receipts_k FROM receipts
                    WHERE commodity IN ({','.join('?' * len(comms))}) AND year BETWEEN ? AND ?
                    GROUP BY 1, 2""", comms + [f.y0, f.y1])
    if norm == "none":
        return ("""SELECT state, year, NULL::DOUBLE AS receipts_k FROM receipts
                   WHERE commodity = 'all' AND year BETWEEN ? AND ?""", [f.y0, f.y1])
    return ("""SELECT state, year, receipts_k FROM receipts
               WHERE commodity = ? AND year BETWEEN ? AND ?""", [commodity, f.y0, f.y1])


def hit_cte(genes: list[str]) -> tuple[str, list]:
    """SQL for the isolates carrying any of `genes`; no genes = any AMR gene."""
    if not genes:
        return "SELECT DISTINCT target_acc FROM genes", []
    return f"SELECT DISTINCT target_acc FROM genes WHERE gene IN ({qs(genes)})", genes


def parse_sources(sources: Optional[str], default: tuple = NONCLINICAL) -> list[str]:
    if not sources:
        return list(default)
    src = [s for s in sources.split(",") if s in ALL_SOURCES]
    return src or list(default)


# --------------------------------------------------------------------------- meta
@app.get("/api/meta")
def meta():
    orgs = q("SELECT organism, count(*) n FROM isolates GROUP BY 1 ORDER BY 2 DESC")
    comms = q("SELECT DISTINCT commodity AS key, label FROM receipts ORDER BY label")
    order = ["all", "animals", "cattle", "hogs", "poultry", "broilers", "eggs", "dairy",
             "crops", "vegetables", "fruits"]
    comms.sort(key=lambda c: order.index(c["key"]) if c["key"] in order else 99)
    yr = q("SELECT max(year) AS ymax FROM receipts")[0]
    hosts = q("SELECT host, count(*) AS n FROM isolates WHERE host IS NOT NULL GROUP BY 1")
    hn = {h["host"]: h["n"] for h in hosts}
    products = q("""SELECT subsource AS product, count(*) AS n FROM isolates
                    WHERE source = 'Food' AND subsource IS NOT NULL AND state IS NOT NULL
                    GROUP BY 1 HAVING count(*) >= 100 ORDER BY 2 DESC""")
    for p in products:
        p["host"] = SUB_HOST.get(p["product"])
    return {
        "organisms": orgs,
        "hosts": [{"key": h, "label": HOST_LABEL[h], "n": hn.get(h, 0),
                   "commodities": sorted({SUB_COMM[s] for s, hh in SUB_HOST.items() if hh == h and s in SUB_COMM})}
                  for h in HOSTS],
        "products": products,
        "commodities": comms,
        "sources": list(ALL_SOURCES),
        "year_min": 2000,
        "year_max": int(yr["ymax"]),
        "default_years": [2012, min(2025, int(yr["ymax"]))],
    }


@app.get("/api/genes")
def genes(f: F = Depends(), limit: int = 400):
    f.genes = []
    w, p = f.sql()
    return q(f"""
        SELECT g.gene, count(*) AS n FROM genes g JOIN isolates i USING (target_acc)
        WHERE {w} GROUP BY 1 ORDER BY 2 DESC LIMIT {int(limit)}
    """, p)


# ------------------------------------------------------------------ T9 completeness
@app.get("/api/completeness")
def completeness(f: F = Depends()):
    """Share of isolates (ignoring the year filter) with a usable collection year and state."""
    f.states = []
    w, p = f.sql(require_year=False)
    r = q(f"""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE year IS NOT NULL AND state IS NOT NULL) AS both,
               count(*) FILTER (WHERE year IS NOT NULL AND state IS NULL) AS date_only,
               count(*) FILTER (WHERE year IS NULL AND state IS NOT NULL) AS state_only,
               count(*) FILTER (WHERE year IS NULL AND state IS NULL) AS neither,
               count(*) FILTER (WHERE state_from = 'food_origin') AS from_food_origin,
               count(*) FILTER (WHERE state_from = 'geo_loc_name') AS from_geo,
               count(*) FILTER (WHERE month IS NOT NULL) AS with_month
        FROM isolates i WHERE {w}
    """, p)[0]
    by_source = q(f"""
        SELECT source, count(*) AS total,
               count(*) FILTER (WHERE year IS NOT NULL AND state IS NOT NULL) AS both,
               count(*) FILTER (WHERE year IS NOT NULL AND state IS NULL) AS date_only,
               count(*) FILTER (WHERE year IS NULL AND state IS NOT NULL) AS state_only,
               count(*) FILTER (WHERE year IS NULL AND state IS NULL) AS neither
        FROM isolates i WHERE {w} GROUP BY 1
    """, p)
    by_year = q(f"""
        SELECT year, count(*) AS n, count(state) AS with_state FROM isolates i
        WHERE {w} AND year BETWEEN 2000 AND 2026 GROUP BY 1 ORDER BY 1
    """, p)
    return {**r, "by_year": by_year, "by_source": by_source}


# ---------------------------------------------------- T1 / T2 adjusted isolate rate
@app.get("/api/state_rates")
def state_rates(f: F = Depends(), commodity: str = "all", norm: str = "economic"):
    """Per state x year: isolate count, denominator and the normalised rate.
    norm = economic (isolates per $1B of `commodity` receipts), species (isolates of each host
    species per $1B of that species' own commodity) or none (raw count)."""
    f.states = []
    w, p = f.sql(species_only=(norm == "species"))
    rc, rp = receipts_cte(norm, commodity, f)
    rate = ("coalesce(c.n, 0)" if norm == "none" else
            "CASE WHEN r.receipts_k > 0 THEN coalesce(c.n, 0) / (r.receipts_k / 1e6) END")
    rows = q(f"""
        WITH c AS (
            SELECT state, year, count(*) AS n FROM isolates i
            WHERE {w} AND state IS NOT NULL GROUP BY 1, 2
        ), r AS ({rc})
        SELECT r.state, r.year, coalesce(c.n, 0) AS n, r.receipts_k, {rate} AS rate
        FROM r LEFT JOIN c USING (state, year)
        ORDER BY r.state, r.year
    """, p + rp)
    if norm == "none":
        missing = []
    else:
        missing = [m["year"] for m in q(f"""
            SELECT DISTINCT year FROM isolates i WHERE {w} AND year NOT IN
                (SELECT DISTINCT year FROM ({rc})) ORDER BY 1
        """, p + rp)]
    return {"rows": rows, "years_without_receipts": missing,
            "commodities": f.commodities() if norm == "species" else [commodity]}


# ------------------------------------------------------- T3 / T4 AMR gene prevalence
@app.get("/api/gene_prevalence")
def gene_prevalence(gene: str = "", f: F = Depends(), commodity: str = "all", norm: str = "economic"):
    """Per state x year: isolates, isolates carrying `gene`, denominator and detection rate."""
    f.genes, f.states = [], []
    hc, hp = hit_cte(split(gene))
    w, p = f.sql(species_only=(norm == "species"))
    rc, rp = receipts_cte(norm, commodity, f)
    rate = ("coalesce(s.n, 0)" if norm == "none" else
            "CASE WHEN r.receipts_k > 0 THEN coalesce(s.n, 0) / (r.receipts_k / 1e6) END")
    rows = q(f"""
        WITH hit AS ({hc}),
        s AS (
            SELECT i.state, i.year, count(*) AS n, count(h.target_acc) AS n_gene
            FROM isolates i LEFT JOIN hit h USING (target_acc)
            WHERE {w} AND i.state IS NOT NULL GROUP BY 1, 2
        ), r AS ({rc})
        SELECT r.state, r.year, coalesce(s.n, 0) AS n, coalesce(s.n_gene, 0) AS n_gene,
               r.receipts_k, {rate} AS rate
        FROM r LEFT JOIN s USING (state, year) ORDER BY r.state, r.year
    """, hp + p + rp)
    trend = q(f"""
        WITH hit AS ({hc})
        SELECT i.year, count(*) AS n, count(h.target_acc) AS n_gene
        FROM isolates i LEFT JOIN hit h USING (target_acc) WHERE {w} GROUP BY 1 ORDER BY 1
    """, hp + p)
    return {"gene": gene, "rows": rows, "trend": trend}


# ------------------------------------------------------------- T5 / T6 SNP clusters
AGGS = ("sum", "mean", "median", "min", "max")


def _agg(m: np.ndarray, how: str) -> np.ndarray:
    if how == "mean":
        return m.mean(axis=1)
    if how == "median":
        return np.median(m, axis=1)
    if how == "min":
        return m.min(axis=1)
    if how == "max":
        return m.max(axis=1)
    return m.sum(axis=1)


@lru_cache(maxsize=64)
def _top_clusters(fkey: tuple, k: int, agg: str, min_n: int):
    f = F.from_key(fkey)
    w, p = f.sql(alias="", default_sources=ALL_SOURCES)
    cand = q(f"""
        SELECT cluster, any_value(organism) AS organism,
               mode(serovar) AS serovar,
               count(*) AS n,
               min(year) AS first_year, max(year) AS last_year,
               count(DISTINCT state) AS n_states,
               count(*) FILTER (WHERE source = 'Human clinical') AS n_clinical,
               count(*) FILTER (WHERE source = 'Food') AS n_food,
               count(*) FILTER (WHERE source = 'Animal') AS n_animal,
               count(*) FILTER (WHERE source = 'Environment') AS n_env,
               median(minsame) AS med_minsame
        FROM isolates WHERE {w} AND cluster IS NOT NULL
        GROUP BY 1 HAVING count(*) >= ? ORDER BY n DESC LIMIT {max(int(k) * 4, 200)}
    """, p + [max(min_n, 1)])
    if not cand:
        return []
    ids = [c["cluster"] for c in cand]
    _, mat = _series(ids, f, "year")
    vals = _agg(np.vstack([mat[c] for c in ids]), agg)
    for c, v in zip(cand, vals):
        c["rate"] = float(v)
    cand.sort(key=lambda c: (-c["rate"], -c["n"]))
    return cand[:k]


@app.get("/api/clusters/top")
def clusters_top(f: F = Depends(), k: int = 25, agg: str = "mean", min_n: int = 1):
    return _top_clusters(f.key(), min(max(k, 1), 300), agg if agg in AGGS else "mean", min_n)


def _series(ids: list[str], f: F, granularity: str):
    if not ids:
        return [], {}
    w, p = f.sql(alias="", default_sources=ALL_SOURCES)
    ph = ",".join("?" * len(ids))
    y0, y1 = f.y0, f.y1
    if granularity == "month":
        rows = q(f"""
            SELECT cluster, month AS t, count(*) AS n FROM isolates
            WHERE cluster IN ({ph}) AND month IS NOT NULL AND {w}
            GROUP BY 1, 2 ORDER BY 2
        """, ids + p)
        periods = [f"{y}-{m:02d}-01" for y in range(y0, y1 + 1) for m in range(1, 13)]
        for r in rows:
            r["t"] = r["t"].isoformat()
    else:
        rows = q(f"""
            SELECT cluster, year AS t, count(*) AS n FROM isolates
            WHERE cluster IN ({ph}) AND {w}
            GROUP BY 1, 2 ORDER BY 2
        """, ids + p)
        periods = list(range(y0, y1 + 1))
    idx = {t: j for j, t in enumerate(periods)}
    mat = {c: np.zeros(len(periods)) for c in ids}
    for r in rows:
        if r["t"] in idx:
            mat[r["cluster"]][idx[r["t"]]] = r["n"]
    return periods, mat


@app.get("/api/clusters/series")
def clusters_series(ids: str, f: F = Depends(), granularity: str = "year"):
    id_list = [i for i in ids.split(",") if i][:40]
    periods, mat = _series(id_list, f, granularity)
    corr = _corr(mat, id_list)
    return {
        "periods": periods,
        "series": [{"cluster": c, "values": mat[c].astype(int).tolist()} for c in id_list],
        "corr": corr,
    }


def _corr(mat: dict, ids: list[str]) -> list[list[Optional[float]]]:
    if not ids:
        return []
    m = np.vstack([mat[c] for c in ids])
    with np.errstate(invalid="ignore", divide="ignore"):
        c = np.corrcoef(m)
    c = np.atleast_2d(c)
    return [[None if np.isnan(v) else round(float(v), 3) for v in row] for row in c]


@app.get("/api/clusters/network")
def clusters_network(f: F = Depends(), k: int = 60, min_corr: float = 0.6,
                     granularity: str = "month", agg: str = "mean", min_n: int = 1):
    """Top-k clusters as nodes; edges join clusters whose discovery time-series correlate."""
    top = _top_clusters(f.key(), min(max(k, 2), 200), agg if agg in AGGS else "mean", min_n)
    ids = [t["cluster"] for t in top]
    _, mat = _series(ids, f, granularity)
    corr = _corr(mat, ids)
    edges = []
    for a in range(len(ids)):
        for b in range(a + 1, len(ids)):
            v = corr[a][b]
            if v is not None and v >= min_corr:
                edges.append({"source": ids[a], "target": ids[b], "corr": v})
    return {"nodes": top, "edges": edges}


@app.get("/api/clusters/{cluster}")
def cluster_detail(cluster: str):
    rows = q("""
        SELECT state, source, subsource, year, count(*) AS n FROM isolates WHERE cluster = ?
        GROUP BY ALL ORDER BY n DESC
    """, [cluster])
    if not rows:
        raise HTTPException(404, "cluster not found")
    return rows


# --------------------------------------------------------------- T7 gene by source
@app.get("/api/gene_sources")
def gene_sources(gene: str = "", f: F = Depends()):
    f.genes, f.sources = [], ",".join(ALL_SOURCES)
    hc, hp = hit_cte(split(gene))
    w, p = f.sql()
    by_year = q(f"""
        WITH hit AS ({hc})
        SELECT i.year, i.source, count(*) AS n FROM isolates i JOIN hit USING (target_acc)
        WHERE {w} GROUP BY 1, 2 ORDER BY 1
    """, hp + p)
    sub = q(f"""
        WITH hit AS ({hc})
        SELECT i.source, i.subsource, i.year, count(*) AS n
        FROM isolates i JOIN hit USING (target_acc)
        WHERE {w} GROUP BY ALL ORDER BY 4 DESC
    """, hp + p)
    denom = q(f"""
        SELECT i.year, i.source, count(*) AS n FROM isolates i WHERE {w} GROUP BY 1, 2
    """, p)
    return {"gene": gene, "by_year": by_year, "subsources": sub, "denominator": denom}


# ------------------------------------------------------------- T8 states x sources
@app.get("/api/state_sources")
def state_sources(f: F = Depends()):
    if not f.states:
        return {"by_year": [], "subsources": []}
    if not f.sources:
        f.sources = ",".join(ALL_SOURCES)
    w, p = f.sql()
    by_year = q(f"""
        SELECT state, year, source, count(*) AS n FROM isolates i
        WHERE {w} GROUP BY ALL ORDER BY state, year
    """, p)
    sub = q(f"""
        SELECT state, source, subsource, year, count(*) AS n FROM isolates i
        WHERE {w} GROUP BY ALL ORDER BY n DESC
    """, p)
    return {"by_year": by_year, "subsources": sub}


# ------------------------------------------------------------------- static frontend
if os.path.isdir(STATIC):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC, "assets")), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = os.path.join(STATIC, path)
        if path and os.path.isfile(f):
            return FileResponse(f)
        return FileResponse(os.path.join(STATIC, "index.html"))

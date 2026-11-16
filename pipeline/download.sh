#!/usr/bin/env bash
# Download raw inputs: NCBI Pathogen Detection metadata (+AMR) and SNP cluster lists for
# four foodborne organism groups, plus the USDA ERS Farm Income and Wealth Statistics file.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw/usda
FTP=https://ftp.ncbi.nlm.nih.gov/pathogen/Results
ORGS="${ATLAS_ORGANISMS:-Salmonella Campylobacter Listeria Escherichia_coli_Shigella}"

for org in $ORGS; do
  # resolve the current PDG accession (e.g. PDG000000002.4298) from the directory listing
  pdg=$(curl -fsSL "$FTP/$org/latest_snps/Metadata/" | grep -oE 'PDG[0-9]+\.[0-9]+' | head -1)
  echo "==> $org ($pdg)"
  curl -fL --retry 3 -o "data/raw/$org.amr.metadata.tsv" "$FTP/$org/latest_snps/AMR/$pdg.amr.metadata.tsv"
  curl -fL --retry 3 -o "data/raw/$org.clusters.tsv" "$FTP/$org/latest_snps/Clusters/$pdg.reference_target.cluster_list.tsv"
done

echo "==> USDA ERS Farm Income and Wealth Statistics"
page=https://www.ers.usda.gov/data-products/farm-income-and-wealth-statistics/data-files-u-s-and-state-level-farm-income-and-wealth-statistics
zip=$(curl -fsSL -A "Mozilla/5.0" "$page" | grep -oE '/media/[0-9]+/[a-z0-9-]+-release\.zip' | head -1)
curl -fL -A "Mozilla/5.0" -o data/raw/usda.zip "https://www.ers.usda.gov$zip"
unzip -o -q data/raw/usda.zip -d data/raw/usda
echo "Done. Now run: python pipeline/build_data.py"

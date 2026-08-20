set -e
P=venv/Scripts/python.exe
J='C:\Users\fnels\LORA_review\gap_urls.json'
get() { $P -c "import json;print(json.load(open(r'$J'))['$1']['$2'])"; }
for tag in as_gable ts_gable as_ue screen; do
  url=$(get $tag url); ws=$(get $tag wall_system); rs=$(get $tag roof_style); wc=$(get $tag wall_color)
  echo "=== $tag ($ws / $rs / $wc) ==="
  $P ab_models.py --control "$url" --models kontext-dev --runs 1 \
     --wall-system "$ws" --roof-style "$rs" --wall-color "$wc"
  if [ -f _ab_models_out/kontext-dev_r0.jpg ]; then
    cp _ab_models_out/kontext-dev_r0.jpg "_ab_models_out/gap_${tag}.jpg"
    rm -f _ab_models_out/kontext-dev_r0.jpg
    echo "SAVED gap_${tag}.jpg"
  else
    echo "NO OUTPUT for $tag"
  fi
done

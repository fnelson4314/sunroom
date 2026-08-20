set -u
P=venv/Scripts/python.exe
get() { $P -c "import json;print(json.load(open(r'C:\Users\fnels\LORA_review\xcfg_urls.json'))['$1']['$2'])"; }
for tag in "$@"; do
  url=$(get $tag url); ws=$(get $tag wall_system); rs=$(get $tag roof_style); wc=$(get $tag wall_color)
  [ "$wc" = "None" ] && wc=white
  echo "=== $tag ($ws / $rs / $wc) ==="
  rm -f _ab_models_out/kontext-dev_r0.jpg          # so a stale file can't masquerade as a result
  $P ab_models.py --control "$url" --models kontext-dev --runs 1 \
     --wall-system "$ws" --roof-style "$rs" --wall-color "$wc" || echo "RUN FAILED: $tag"
  if [ -f _ab_models_out/kontext-dev_r0.jpg ]; then
    cp _ab_models_out/kontext-dev_r0.jpg "_ab_models_out/xcfg_${tag}.jpg"
    echo "SAVED xcfg_${tag}.jpg"
  else
    echo "NO OUTPUT for $tag"
  fi
done

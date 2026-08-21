set -e
P=venv/Scripts/python.exe
SID=9f8f730c-92a1-4f97-8b9e-221f2373f875
export SEEDS=1111,4444
echo "=== kontext-max ==="
$P _seed_sweep.py $SID j35max black-forest-labs/flux-kontext-max || true
echo "=== kontext-pro ==="
$P _seed_sweep.py $SID j35pro black-forest-labs/flux-kontext-pro || true
echo "=== v2 LoRA ==="
$P _seed_sweep.py $SID j35lora black-forest-labs/flux-kontext-dev-lora || true

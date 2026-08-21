set -e
P=venv/Scripts/python.exe
SID=9f8f730c-92a1-4f97-8b9e-221f2373f875
HF=https://huggingface.co/fnelson4314/sunroom-kontext-lora/resolve/main
export SEEDS=1111,2222,3333,4444,5555
export FLUX_KONTEXT_LORA_STRENGTH=1.0
for pair in "v3a:$HF/sunroom_kontext_lora_v3_000002000.safetensors" \
            "v3c:$HF/sunroom_kontext_lora_v3.safetensors" \
            "v2b:$HF/sunroom_kontext_lora_v2_000002500.safetensors"; do
  tag="${pair%%:*}"; url="${pair#*:}"
  echo "=== $tag ==="
  FLUX_KONTEXT_LORA_WEIGHTS="$url" $P _seed_sweep.py $SID $tag black-forest-labs/flux-kontext-dev-lora || true
done

"""
SUNRM LoRA Training Script v2
Fetches the current trainer version automatically, then starts training.

Usage:
  python start_lora_training_v2.py

Requirements:
  pip install httpx
  Set REPLICATE_API_TOKEN environment variable
  Have lora_training_package.zip in the same folder
  Create destination model at replicate.com first (see instructions below)
"""

import httpx
import time
import os
import sys

REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "")
if not REPLICATE_API_TOKEN:
    print("ERROR: Set REPLICATE_API_TOKEN environment variable first")
    print("  Windows: set REPLICATE_API_TOKEN=r8_your_token_here")
    print("  Mac/Linux: export REPLICATE_API_TOKEN=r8_your_token_here")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Token {REPLICATE_API_TOKEN}",
    "Content-Type": "application/json",
}

# ── CONFIG — UPDATE YOUR USERNAME HERE ──────────────────────────────────────
# Replace "your-username" with your Replicate username
# Find it at: replicate.com/account
# Then go to replicate.com/create and make a new private model
# called "sunroom-lora-gable-4inch" before running this script
REPLICATE_USERNAME  = "fnelson4314"
DESTINATION_MODEL   = f"{REPLICATE_USERNAME}/sunroom-3season_gable"
TRAINING_ZIP_PATH   = "lora_training_package.zip"

TRAINING_CONFIG = {
    "trigger_word":         "SUNRM",
    "steps":                1500,
    "lora_rank":            16,
    "learning_rate":        0.0004,
    "batch_size":           1,
    "resolution":           "512,768,1024",
    "autocaption":          False,
    "caption_dropout_rate": 0.05,
}
# ────────────────────────────────────────────────────────────────────────────


def get_latest_trainer_version() -> str:
    """Fetch the current version ID of ostris/flux-dev-lora-trainer."""
    print("Fetching latest trainer version...")
    r = httpx.get(
        "https://api.replicate.com/v1/models/ostris/flux-dev-lora-trainer/versions",
        headers=HEADERS,
        timeout=30,
    )
    r.raise_for_status()
    versions = r.json().get("results", [])
    if not versions:
        raise Exception("No versions found for ostris/flux-dev-lora-trainer")
    version_id = versions[0]["id"]
    print(f"  Trainer version: {version_id[:16]}...")
    return version_id


def upload_zip(zip_path: str) -> str:
    """Upload zip to Replicate file storage, return the file URL."""
    size_mb = os.path.getsize(zip_path) / 1024 / 1024
    print(f"Uploading {zip_path} ({size_mb:.1f} MB)...")
    with open(zip_path, "rb") as f:
        r = httpx.post(
            "https://api.replicate.com/v1/files",
            headers={"Authorization": f"Token {REPLICATE_API_TOKEN}"},
            files={"content": (os.path.basename(zip_path), f, "application/zip")},
            timeout=120,
        )
    r.raise_for_status()
    url = r.json()["urls"]["get"]
    print(f"  Uploaded → {url[:60]}...")
    return url


def start_training(zip_url: str, version_id: str) -> str:
    """Start LoRA training, return training ID."""
    print(f"Starting training → destination: {DESTINATION_MODEL}")
    payload = {
        "destination": DESTINATION_MODEL,
        "input": {
            "input_images": zip_url,
            **TRAINING_CONFIG,
        },
    }
    r = httpx.post(
        f"https://api.replicate.com/v1/models/ostris/flux-dev-lora-trainer/versions/{version_id}/trainings",
        headers=HEADERS,
        json=payload,
        timeout=60,
    )
    if r.status_code != 201:
        print(f"  Error {r.status_code}: {r.text}")
        r.raise_for_status()
    training_id = r.json()["id"]
    print(f"  Training ID: {training_id}")
    print(f"  Watch at: https://replicate.com/p/{training_id}")
    return training_id


def poll_training(training_id: str) -> str:
    """Poll every 30s until done, return weights URL."""
    print("Polling for completion (20-40 minutes)...")
    dots = 0
    while True:
        time.sleep(30)
        r = httpx.get(
            f"https://api.replicate.com/v1/trainings/{training_id}",
            headers=HEADERS,
            timeout=30,
        )
        r.raise_for_status()
        data   = r.json()
        status = data.get("status")
        dots  += 1
        print(f"  [{dots * 30}s] Status: {status}")

        if status == "succeeded":
            weights_url = data["output"]["weights"]
            print(f"\n✓ Training complete!")
            print(f"\nWeights URL:\n  {weights_url}")
            print(f"\nPaste into lora_config.py:")
            print(f'  ("4_inch", "gable"): "{weights_url}",')
            return weights_url

        elif status == "failed":
            err = data.get("error", "unknown error")
            print(f"\n✗ Training failed: {err}")
            raise Exception(f"Training failed: {err}")


if __name__ == "__main__":
    print("=" * 60)
    print("SUNRM LoRA Retraining Script v2")
    print("=" * 60)

    if REPLICATE_USERNAME == "your-username":
        print("\nERROR: Update REPLICATE_USERNAME in this script first.")
        print("  Find your username at: replicate.com/account")
        sys.exit(1)

    if not os.path.exists(TRAINING_ZIP_PATH):
        print(f"\nERROR: {TRAINING_ZIP_PATH} not found.")
        print("  Make sure lora_training_package.zip is in the same folder.")
        sys.exit(1)

    print(f"\nDestination model : {DESTINATION_MODEL}")
    print(f"Training zip      : {TRAINING_ZIP_PATH}")
    print(f"Trigger word      : SUNRM")
    print(f"Steps             : {TRAINING_CONFIG['steps']}")
    print(f"LoRA rank         : {TRAINING_CONFIG['lora_rank']}")
    print()
    print("BEFORE CONTINUING:")
    print(f"  1. Go to replicate.com/create")
    print(f"  2. Create a new PRIVATE model called: sunroom-lora-gable-4inch")
    print(f"  3. Come back and press Enter")
    print()

    confirm = input("Ready? (yes/no): ").strip().lower()
    if confirm != "yes":
        print("Aborted.")
        sys.exit(0)

    version_id  = get_latest_trainer_version()
    zip_url     = upload_zip(TRAINING_ZIP_PATH)
    training_id = start_training(zip_url, version_id)
    weights_url = poll_training(training_id)

    print()
    print("=" * 60)
    print("DONE. Next steps:")
    print("  1. Update lora_config.py with the weights URL above")
    print("  2. Restart your Celery worker")
    print("  3. Set LORA_SCALE back to 0.85 in replicate_service.py")
    print("=" * 60)
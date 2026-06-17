# app/lora_config.py
# Fill in weights URLs as each training run completes.
# URL format: https://replicate.delivery/pbxt/.../weights.tar
# Leave empty string for untrained combos — falls back to base FLUX.

LORA_URLS: dict[tuple[str, str], str] = {
    # Screen room (2_inch)
    ("2_inch", "studio"):        "",  # fill after training screen_studio
    ("2_inch", "gable"):         "",  # fill after training screen_gable
    ("2_inch", "under_existing"): "", # fill after training screen_under

    # Three season (4_inch)
    ("4_inch", "studio"):        "",  # fill after training 3season_studio
    ("4_inch", "gable"):         "https://replicate.delivery/xezq/a9PZ7kOJhdICEtby0VuNI4gOh3ih3n1zGdK7WpLvabABsnrF/trained_model.tar",  # fill after training 3season_gable
    ("4_inch", "under_existing"): "", # NO training data — falls back to base model

    # All season (6_inch)
    ("6_inch", "studio"):        "",  # fill after training allseason_studio
    ("6_inch", "gable"):         "",  # fill after training allseason_gable
    ("6_inch", "under_existing"): "", # NO training data — falls back to base model
}

def get_lora_url(wall_system: str, roof_style: str) -> str:
    """Returns weights URL or empty string if no LoRA trained for this combo."""
    return LORA_URLS.get((wall_system, roof_style), "")
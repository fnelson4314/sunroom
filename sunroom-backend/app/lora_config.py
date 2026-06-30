# app/lora_config.py
# Fill in weights URLs as each training run completes.
# URL format: https://replicate.delivery/pbxt/.../weights.tar
# Leave empty string for untrained combos — falls back to base FLUX.

LORA_URLS: dict[tuple[str, str], str] = {
    # Screen room (2_inch)
    ("2_inch", "studio"):        "https://replicate.delivery/xezq/L7awP8cN7c7RHJ6TXOhTC0TZtl2ITXpehZhJnmxO7AWmeL0WA/trained_model.tar",  # fill after training screen_studio
    ("2_inch", "gable"):         "https://replicate.delivery/xezq/Qzx9ez15ARxFBar1rr3L5c705XRMb9Hwv39KzVPUJM2tfL0WA/trained_model.tar",  # fill after training screen_gable
    ("2_inch", "under_existing"): "https://replicate.delivery/xezq/eesVLE1O8htiLUyJNDefzcEjOBCvIZhydcMy6Xy1WLCUDwQbB/trained_model.tar", # fill after training screen_under

    # Three season (4_inch)
    ("4_inch", "studio"):        "https://replicate.delivery/xezq/SYSZm8VidbrhIFX8BtuK0q0v7aerLK5fFyh4gXGrFUCkBM0WA/trained_model.tar",  # fill after training 3season_studio
    ("4_inch", "gable"):         "https://replicate.delivery/xezq/a9PZ7kOJhdICEtby0VuNI4gOh3ih3n1zGdK7WpLvabABsnrF/trained_model.tar",  # fill after training 3season_gable
    ("4_inch", "under_existing"): "https://replicate.delivery/xezq/p2Cw1vQXZyrME1EZyxzM6Gez7NxWMlLXhmenOZMl2Fb6CM0WA/trained_model.tar", # NO training data — falls back to base model

    # All season (6_inch)
    ("6_inch", "studio"):        "https://replicate.delivery/xezq/OpbG1leq5enl509HwpWPZZgsGYhwyucIFdGzxYPI11feQwQbB/trained_model.tar",  # fill after training allseason_studio
    ("6_inch", "gable"):         "https://replicate.delivery/xezq/Kxmq340oGJqRL57VDYep3cFaiVIfkEAckM1z6rs5SOBRDM0WA/trained_model.tar",  # fill after training allseason_gable
    ("6_inch", "under_existing"): "https://replicate.delivery/xezq/WpsScneXLkUEYyekgIdFgYeZvGbHF0nDUDfDWpagCuFxRwQbB/trained_model.tar", # NO training data — falls back to base model
}

def get_lora_url(wall_system: str, roof_style: str) -> str:
    """Returns weights URL or empty string if no LoRA trained for this combo."""
    return LORA_URLS.get((wall_system, roof_style), "")
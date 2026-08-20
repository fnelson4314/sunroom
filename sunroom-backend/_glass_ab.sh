set -e
P=venv/Scripts/python.exe
URL=$($P -c "import json;print(json.load(open(r'C:\Users\fnels\LORA_review\gap_urls.json'))['as_gable']['url'])")

# Glass clause rewritten to describe the ACTUAL Champion product seen in the real
# installed photo: clear glass with the interior visible, chunky white sash frames
# with meeting stiles and handles, kneewall siding matching the house.
INSTR="Turn the 3D-rendered sunroom overlay in this photo into a photorealistic white aluminum-framed sunroom, as if actually built and professionally photographed. Keep its exact geometry: every frame, mullion, panel, kneewall, transom, and door stays exactly where and how it is drawn - do not add, remove, move, or resize anything. Panels drawn as glass become CLEAR low-tint insulated glass you can see straight through: the room's interior is plainly visible behind every pane - furniture, the floor, the house wall behind - with only a light sheen of sky reflection near the top of each pane, never a dark mirrored surface. Each window unit keeps its own white aluminum sash frame around the glass with a visible vertical meeting stile and a small dark handle where drawn; windows drawn with an offset sliding half-pane KEEP that visible two-pane sliding sash split. Panels drawn as solid or white stay solid, and a solid kneewall reads as horizontal lap siding in the same colour family as the existing house siding. Any glass door keeps full-height glass running all the way to the floor exactly as drawn, with a slim vertical pull handle. The drawn roof becomes dark asphalt shingles with fine horizontal courses matching the existing house roof, with a white fascia and gutter along the eave. Keep the house, yard, and everything outside the structure completely unchanged."

$P ab_models.py --control "$URL" --models kontext-dev --runs 1 --instruction "$INSTR"
cp _ab_models_out/kontext-dev_r0.jpg _ab_models_out/glass_clear_as_gable.jpg
rm -f _ab_models_out/kontext-dev_r0.jpg
echo "SAVED glass_clear_as_gable.jpg"

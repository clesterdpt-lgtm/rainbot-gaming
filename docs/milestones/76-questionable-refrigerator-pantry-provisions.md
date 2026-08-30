# Milestone 76: Questionable Refrigerator and Pantry Provisions

## Goal

Make the Kitchen refrigerator and basement Pantry reward close visual inspection with expensive-looking provisions that become disturbing only after the player reads their coded labels.

## Authored set

- Refrigerator: one marbled vacuum-packed tasting cut labelled `PATRON RESERVE · LOT 07`, one veined eyeball and optic nerve plated as `OCULAR SAMPLE · LEFT · LOT 08`, one stitched `CHOIR CUT · MUSCLE NO. 2`, plus one clouded brine jar labelled `HOUSE SAMPLE · SOFT STOCK 04`.
- Preserves cabinet: three individually labelled `HOUSE RESERVE` jars for winter lots 04, 09, and 12, escalating from Course II to Final Course and using visibly different squat, tall, and faceted vessel profiles, plus one articulated pale shape in dark brine labelled `JOINT STOCK · FLEXIBLE CUT 03`.
- Pantry cupboard: one tied butcher-paper parcel stamped `FINAL TABLE · SHOULDER CUT · LOT 04`.
- Tinned-goods cabinet: one pull-ring tin labelled `MARROW STOCK · PATRON GRADE`.
- Baking cabinet: one amber bottle labelled `TENDERIZING SALTS · SERVICE PANTRY`, plus one deceptively cream-like jar labelled `RENDERED RESERVE · GUEST FAT`.
- Dry-goods cabinet: five individually modelled teeth sealed beneath vacuum plastic as `TABLE GARNISH · DENTAL PEARLS`, plus a clouded jar of coiled dark filaments labelled `FINE STRANDS · GUEST BATCH 06`.

## Visual contract

- Use layered physical silhouettes rather than recoloured boxes: marbled cuts and fat seams, black enamel trays, transparent vacuum wrap, glass and internal brine, suspended pale contents, paper folds, twine, wax seals, tin lids, pull rings, a separate sclera/iris/pupil/cornea, surface veins, optic nerve, and individually crowned teeth.
- Generate every label and marbling texture locally at runtime; add no remote asset dependency.
- Keep ordinary food around the hero props so the first read remains a lavish working kitchen rather than an exposed gore room.
- Reserve the complete middle shelf in every hero storage before generic stock is instanced. No questionable root may penetrate either another authored provision or surrounding generic stock by more than two millimetres in the browser bounds audit.
- Curate all six affected storage interiors so separate supporting assemblies never repeat the same silhouette within one cabinet. Give every remaining ordinary instance deterministic unique proportions and pose, treat attached lids/caps and the single egg plus tray as one logical assembly, and reject more than two millimetres of penetration between any separate assemblies.
- Props remain hidden with their owning refrigerator/cabinet doors and add no colliders, interactions, inventory, dossier entries, objectives, or shader lights.
- Keep the complete authored set below the named 124-part visual budget.

## Acceptance

- Static checks pin all fourteen ids, the twelve coded label families, local procedural textures, storage lifecycle ownership, explicit multi-shelf reservation authority, supporting-stock silhouette/signature auditing, page/runtime cache identity, and the no-light/no-collider boundary.
- Real Chromium opens the refrigerator and each relevant Pantry cabinet, proves all fourteen entries become visible only with their storage, rejects generic-stock, authored-provision, or separate supporting-assembly bounds overlap, reports zero repeated supporting silhouettes within a cabinet and zero duplicate appearance signatures, checks material/label diagnostics and the 113-part budget, preserves shader-light topology, captures eleven close desktop views, and reports zero console errors.
- Adjacent refrigerator tamper/open-close and Pantry storage regressions remain unchanged.

## Manual playtest

Open the refrigerator naturally and judge whether the vacuum wrap, marbling, clouded glass, plated eyeball, stitched Choir Cut, single-egg tray, and four small labels are legible without looking like oversized UI cards. In the Pantry, inspect the visibly distinct preserve trio, Joint Stock, tied parcel, marrow tin, amber salts bottle, Rendered Reserve, dental-garnish tray, and Fine Strands under ordinary basement lighting. Confirm the supporting stock does not form repeated shelf patterns, the cleared hero zones look deliberately staged rather than bare, every separate silhouette has visible air around it, and the ambiguous preparations become disturbing only after reading their labels without turning the room into an exposed gore display before the Archive lore is discovered.

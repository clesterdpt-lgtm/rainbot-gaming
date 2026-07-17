#!/usr/bin/env python3
"""Pack one Blender Super Slop frame set into a browser WebP atlas.

The input must be the 13 x 8 set written by
``scripts/blender/prepare-super-slop-fighter.py``.  Pillow performs the actual
RGBA packing and WebP encoding.  The resulting report carries the row/source
mapping forward so the Canvas2D manifest never has to infer clip positions.

Example:

    python3 scripts/build-super-slop-animation-atlas.py \
      --fighter rainbot \
      --frames-dir output/blender/super-slop-brothers/rainbot \
      --source-report assets/models/super-slop-brothers/processed/rainbot-blender-report.json \
      --output assets/img/super-slop-brothers/animated/rainbot.webp \
      --report assets/models/super-slop-brothers/processed/rainbot-atlas-report.json \
      --force
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image, features
except ImportError as error:  # pragma: no cover - exercised only on an unprepared machine
    raise SystemExit("Pillow is required: install it with `python3 -m pip install Pillow`") from error


FRAME_SIZE = 192
FRAMES_PER_CLIP = 8
MAX_ATLAS_BYTES = 3 * 1024 * 1024
CLIP_NAMES = (
    "idle",
    "run",
    "jump",
    "fall",
    "hit",
    "shield",
    "dodge",
    "grab",
    "attack",
    "special-neutral",
    "special-side",
    "special-up",
    "special-down",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fighter", required=True)
    parser.add_argument("--frames-dir", required=True, type=Path)
    parser.add_argument("--source-report", required=True, type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        help="Defaults to assets/img/super-slop-brothers/animated/<fighter>.webp",
    )
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--runtime-path", help="Optional repo-relative URL path recorded for the runtime")
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument("--min-quality", type=int, default=62)
    parser.add_argument("--method", type=int, default=6)
    parser.add_argument("--max-bytes", type=int, default=MAX_ATLAS_BYTES)
    parser.add_argument(
        "--min-alpha-margin",
        type=int,
        default=6,
        help="Minimum transparent-pixel margin required around every source pose",
    )
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def display_path(path: Path) -> str:
    resolved = path.expanduser().resolve()
    try:
        return resolved.relative_to(repo_root()).as_posix()
    except ValueError:
        return str(resolved)


def load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid JSON in {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def validate_source_report(report: dict[str, object], fighter_id: str) -> dict[str, dict[str, object]]:
    if report.get("fighterId") != fighter_id:
        raise ValueError(
            f"Source report fighterId is {report.get('fighterId')!r}, expected {fighter_id!r}"
        )
    render = report.get("render")
    if not isinstance(render, dict):
        raise ValueError("Source report is missing render metadata")
    expected_render = {
        "frameSize": FRAME_SIZE,
        "framesPerClip": FRAMES_PER_CLIP,
        "columns": FRAMES_PER_CLIP,
        "rows": len(CLIP_NAMES),
        "transparent": True,
    }
    for key, expected in expected_render.items():
        if render.get(key) != expected:
            raise ValueError(f"Source report render.{key} is {render.get(key)!r}, expected {expected!r}")

    source_clips = report.get("clips")
    if not isinstance(source_clips, list):
        raise ValueError("Source report clips must be an array")
    clips_by_name: dict[str, dict[str, object]] = {}
    for clip in source_clips:
        if not isinstance(clip, dict) or not isinstance(clip.get("name"), str):
            raise ValueError("Source report contains an invalid clip entry")
        clips_by_name[str(clip["name"])] = clip
    if set(clips_by_name) != set(CLIP_NAMES):
        missing = sorted(set(CLIP_NAMES) - set(clips_by_name))
        extra = sorted(set(clips_by_name) - set(CLIP_NAMES))
        raise ValueError(f"Source report clip mismatch; missing={missing}, extra={extra}")
    for row, name in enumerate(CLIP_NAMES):
        clip = clips_by_name[name]
        if clip.get("row") != row or clip.get("frames") != FRAMES_PER_CLIP:
            raise ValueError(f"Source report has an invalid row/frame count for {name}: {clip}")
        if not isinstance(clip.get("sourceMotion"), str) or not clip.get("sourceMotion"):
            raise ValueError(f"Source report is missing sourceMotion for {name}")
    return clips_by_name


def load_frame(path: Path) -> Image.Image:
    if not path.is_file():
        raise FileNotFoundError(f"Missing Blender frame: {path}")
    with Image.open(path) as source:
        source.load()
        if source.size != (FRAME_SIZE, FRAME_SIZE):
            raise ValueError(f"{path} is {source.size}, expected {(FRAME_SIZE, FRAME_SIZE)}")
        if source.mode != "RGBA":
            raise ValueError(f"{path} is {source.mode}, expected Blender RGBA output")
        frame = source.copy()
    alpha = frame.getchannel("A")
    alpha_extrema = alpha.getextrema()
    if alpha_extrema[1] == 0 or alpha.getbbox() is None:
        raise ValueError(f"{path} contains no visible fighter pixels")
    if alpha_extrema[0] != 0:
        raise ValueError(f"{path} has no transparent background pixels")
    return frame


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def quality_attempts(requested: int, minimum: int) -> list[int]:
    attempts = [requested]
    quality = requested - 4
    while quality >= minimum:
        attempts.append(quality)
        quality -= 4
    if attempts[-1] != minimum:
        attempts.append(minimum)
    return attempts


def save_webp_with_budget(
    atlas: Image.Image,
    output: Path,
    quality: int,
    min_quality: int,
    method: int,
    max_bytes: int,
) -> tuple[int, int, list[dict[str, int]]]:
    temporary = output.with_name(f".{output.stem}.packing{output.suffix}")
    attempts: list[dict[str, int]] = []
    try:
        for candidate in quality_attempts(quality, min_quality):
            atlas.save(
                temporary,
                format="WEBP",
                lossless=False,
                quality=candidate,
                method=method,
                exact=True,
            )
            file_bytes = temporary.stat().st_size
            attempts.append({"quality": candidate, "fileBytes": file_bytes})
            if file_bytes <= max_bytes:
                temporary.replace(output)
                return candidate, file_bytes, attempts
    finally:
        if temporary.exists():
            temporary.unlink()
    raise RuntimeError(
        f"Atlas is {attempts[-1]['fileBytes'] / 1024 / 1024:.2f} MiB at quality "
        f"{attempts[-1]['quality']}; budget is {max_bytes / 1024 / 1024:.2f} MiB"
    )


def validate_args(args: argparse.Namespace) -> tuple[str, Path, Path, Path, Path]:
    fighter_id = args.fighter.strip().lower()
    if not fighter_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for character in fighter_id):
        raise ValueError("--fighter must be a lowercase filesystem-safe id")
    if not 1 <= args.quality <= 100:
        raise ValueError("--quality must be between 1 and 100")
    if not 1 <= args.min_quality <= args.quality:
        raise ValueError("--min-quality must be between 1 and --quality")
    if not 0 <= args.method <= 6:
        raise ValueError("--method must be between 0 and 6")
    if args.max_bytes < 100_000:
        raise ValueError("--max-bytes must be at least 100000")
    if not 0 <= args.min_alpha_margin <= FRAME_SIZE // 4:
        raise ValueError(f"--min-alpha-margin must be between 0 and {FRAME_SIZE // 4}")
    if not features.check("webp"):
        raise RuntimeError("This Pillow build does not include WebP support")

    frames_dir = args.frames_dir.expanduser().resolve()
    source_report = args.source_report.expanduser().resolve()
    output = (
        args.output
        or repo_root() / "assets" / "img" / "super-slop-brothers" / "animated" / f"{fighter_id}.webp"
    ).expanduser().resolve()
    report_path = args.report.expanduser().resolve()
    if not frames_dir.is_dir():
        raise FileNotFoundError(f"Frames directory not found: {frames_dir}")
    if not source_report.is_file():
        raise FileNotFoundError(f"Blender report not found: {source_report}")
    if output == report_path:
        raise ValueError("--output and --report must be different files")
    existing = [path for path in (output, report_path) if path.exists()]
    if existing and not args.force:
        raise FileExistsError("Refusing to replace outputs without --force:\n  " + "\n  ".join(str(path) for path in existing))
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    return fighter_id, frames_dir, source_report, output, report_path


def main() -> None:
    args = parse_args()
    fighter_id, frames_dir, source_report_path, output, report_path = validate_args(args)
    source_report = load_json(source_report_path)
    clips_by_name = validate_source_report(source_report, fighter_id)

    atlas_width = FRAME_SIZE * FRAMES_PER_CLIP
    atlas_height = FRAME_SIZE * len(CLIP_NAMES)
    atlas = Image.new("RGBA", (atlas_width, atlas_height), (0, 0, 0, 0))
    source_frames: list[dict[str, object]] = []
    minimum_alpha_margin = FRAME_SIZE
    tightest_frames: list[dict[str, object]] = []
    for row, clip_name in enumerate(CLIP_NAMES):
        for column in range(FRAMES_PER_CLIP):
            frame_path = frames_dir / clip_name / f"frame-{column:02d}.png"
            frame = load_frame(frame_path)
            alpha_bounds = frame.getchannel("A").getbbox()
            if alpha_bounds is None:
                raise ValueError(f"{frame_path} contains no alpha bounds")
            margins = {
                "left": alpha_bounds[0],
                "top": alpha_bounds[1],
                "right": FRAME_SIZE - alpha_bounds[2],
                "bottom": FRAME_SIZE - alpha_bounds[3],
            }
            frame_margin = min(margins.values())
            if frame_margin < minimum_alpha_margin:
                minimum_alpha_margin = frame_margin
                tightest_frames = []
            if frame_margin == minimum_alpha_margin:
                tightest_frames.append(
                    {
                        "clip": clip_name,
                        "column": column,
                        "file": display_path(frame_path),
                        "margins": margins,
                    }
                )
            atlas.alpha_composite(frame, (column * FRAME_SIZE, row * FRAME_SIZE))
            source_frames.append(
                {
                    "clip": clip_name,
                    "row": row,
                    "column": column,
                    "file": display_path(frame_path),
                    "fileBytes": frame_path.stat().st_size,
                    "alphaBounds": list(alpha_bounds),
                    "alphaMargins": margins,
                    "minimumAlphaMargin": frame_margin,
                }
            )
            frame.close()

    if minimum_alpha_margin < args.min_alpha_margin:
        atlas.close()
        offender = tightest_frames[0]
        raise ValueError(
            f"Source pose touches the sprite safety margin: {offender['file']} has "
            f"{minimum_alpha_margin}px minimum, requires {args.min_alpha_margin}px; "
            f"margins={offender['margins']}"
        )

    actual_quality, file_bytes, encoding_attempts = save_webp_with_budget(
        atlas,
        output,
        args.quality,
        args.min_quality,
        args.method,
        args.max_bytes,
    )
    atlas.close()

    with Image.open(output) as verification:
        verification.load()
        if verification.size != (atlas_width, atlas_height):
            raise RuntimeError(f"Encoded WebP dimensions changed unexpectedly: {verification.size}")
        if verification.mode != "RGBA" or verification.getchannel("A").getextrema()[0] != 0:
            raise RuntimeError("Encoded WebP did not preserve the transparent alpha channel")

    runtime_path = args.runtime_path or display_path(output)
    if runtime_path.startswith("/") or "\\" in runtime_path:
        raise ValueError("--runtime-path must be a relative URL-style path")
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "fighterId": fighter_id,
        "pipeline": "Blender RGBA clip frames -> Pillow WebP Canvas2D atlas",
        "sourceReport": display_path(source_report_path),
        "sourceFramesDir": display_path(frames_dir),
        "output": display_path(output),
        "runtimePath": runtime_path,
        "fileBytes": file_bytes,
        "sha256": sha256(output),
        "format": "webp",
        "width": atlas_width,
        "height": atlas_height,
        "cellSize": FRAME_SIZE,
        "columns": FRAMES_PER_CLIP,
        "rows": len(CLIP_NAMES),
        "alpha": True,
        "visualQA": {
            "requiredAlphaMarginPixels": args.min_alpha_margin,
            "minimumAlphaMarginPixels": minimum_alpha_margin,
            "tightestFrames": tightest_frames,
            "clippedFrames": 0,
        },
        "encoding": {
            "library": f"Pillow {Image.__version__}",
            "lossless": False,
            "requestedQuality": args.quality,
            "actualQuality": actual_quality,
            "method": args.method,
            "maxBytes": args.max_bytes,
            "attempts": encoding_attempts,
        },
        "clips": {
            name: {
                "row": row,
                "frames": FRAMES_PER_CLIP,
                "loop": bool(clips_by_name[name].get("loop")),
                "sourceMotion": clips_by_name[name]["sourceMotion"],
                "derived": bool(clips_by_name[name].get("derived")),
                "derivation": clips_by_name[name].get("derivation", ""),
            }
            for row, name in enumerate(CLIP_NAMES)
        },
        "sourceFrames": source_frames,
    }
    temporary_report = report_path.with_name(f".{report_path.name}.packing")
    temporary_report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    temporary_report.replace(report_path)
    print(
        f"[Super Slop atlas] {fighter_id}: {atlas_width}x{atlas_height}, "
        f"quality {actual_quality}, {file_bytes / 1024 / 1024:.2f} MiB"
    )
    print(json.dumps({"atlas": display_path(output), "report": display_path(report_path)}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise

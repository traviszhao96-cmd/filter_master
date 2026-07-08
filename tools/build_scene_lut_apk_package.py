#!/usr/bin/env python3
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import zipfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
APK_PATH = ROOT / "apk" / "NTCamera-arm64-v8a-userRelease.apk"
RULES_PATH = ROOT / "scene_lut_recommend" / "rules.json"
LUT_SOURCES_PATH = ROOT / "rating_tool" / "lut_sources.json"
BUILD_DATE = "2026-07-02"
BUILD_STAMP = "20260702_v2"
OUT_ROOT = ROOT / "exports" / f"scene_lut_apk_integration_{BUILD_STAMP}"
PACKAGE_DIR = OUT_ROOT / "external_config" / "scene_lut_recommend"
ASSET_DIR = OUT_ROOT / "apk_assets" / "scene_lut_recommend"
BUILD_DIR = OUT_ROOT / "build"

FALLBACK_IDS = [
    "ai_portrait_soft",
    "ai_forest_fresh",
    "lut_店主推荐_709日系奶油低饱和_e882a24171",
    "lut_filter-lut_自然11_1918e5af72",
    "lut_filter-lut_质感11_d4e9593069",
]


def slugify(value):
    value = str(value or "").strip().lower()
    value = re.sub(r"\.[^.]+$", "", value)
    value = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "-", value, flags=re.UNICODE)
    value = re.sub(r"^-+|-+$", "", value)
    return value or "lut"


def short_hash(value):
    return hashlib.sha1(str(value).encode("utf-8")).hexdigest()[:10]


def collect_external_luts():
    config = json.loads(LUT_SOURCES_PATH.read_text("utf-8"))
    result = {}
    for source in config.get("sources", []):
        name = source["name"]
        base = Path(source["path"])
        if not base.is_absolute():
            base = (ROOT / base).resolve()
        for path in sorted(base.rglob("*")):
            if path.suffix.lower() not in {".cube", ".png"}:
                continue
            filter_id = f"lut_{slugify(name)}_{slugify(path.stem)}_{short_hash(path)}"
            result[filter_id] = {
                "id": filter_id,
                "sourceName": name,
                "displayName": path.stem,
                "path": path,
            }
    return result


def parse_cube(path):
    size = None
    domain_min = [0.0, 0.0, 0.0]
    domain_max = [1.0, 1.0, 1.0]
    values = []
    for raw_line in path.read_text("utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        upper = line.upper()
        parts = line.split()
        if upper.startswith("TITLE"):
            continue
        if upper.startswith("LUT_3D_SIZE"):
            size = int(parts[-1])
            continue
        if upper.startswith("DOMAIN_MIN"):
            domain_min = [float(v) for v in parts[1:4]]
            continue
        if upper.startswith("DOMAIN_MAX"):
            domain_max = [float(v) for v in parts[1:4]]
            continue
        if len(parts) >= 3:
            try:
                values.append(tuple(max(0.0, min(1.0, float(v))) for v in parts[:3]))
            except ValueError:
                continue
    if not size:
        raise ValueError(f"missing LUT_3D_SIZE in {path}")
    expected = size * size * size
    if len(values) < expected:
        raise ValueError(f"{path} has {len(values)} cube entries, expected {expected}")
    return size, domain_min, domain_max, values[:expected]


def cube_at(values, size, r, g, b):
    def idx(rr, gg, bb):
        return (bb * size * size) + (gg * size) + rr

    r = max(0.0, min(1.0, r)) * (size - 1)
    g = max(0.0, min(1.0, g)) * (size - 1)
    b = max(0.0, min(1.0, b)) * (size - 1)
    r0, g0, b0 = int(math.floor(r)), int(math.floor(g)), int(math.floor(b))
    r1, g1, b1 = min(r0 + 1, size - 1), min(g0 + 1, size - 1), min(b0 + 1, size - 1)
    tr, tg, tb = r - r0, g - g0, b - b0

    def lerp(a, c, t):
        return a + (c - a) * t

    out = []
    for channel in range(3):
        c000 = values[idx(r0, g0, b0)][channel]
        c100 = values[idx(r1, g0, b0)][channel]
        c010 = values[idx(r0, g1, b0)][channel]
        c110 = values[idx(r1, g1, b0)][channel]
        c001 = values[idx(r0, g0, b1)][channel]
        c101 = values[idx(r1, g0, b1)][channel]
        c011 = values[idx(r0, g1, b1)][channel]
        c111 = values[idx(r1, g1, b1)][channel]
        c00 = lerp(c000, c100, tr)
        c10 = lerp(c010, c110, tr)
        c01 = lerp(c001, c101, tr)
        c11 = lerp(c011, c111, tr)
        c0 = lerp(c00, c10, tg)
        c1 = lerp(c01, c11, tg)
        out.append(lerp(c0, c1, tb))
    return tuple(int(round(max(0.0, min(1.0, c)) * 255)) for c in out)


def cube_to_hald_png(cube_path, out_path, target_size=64):
    size, _domain_min, _domain_max, values = parse_cube(cube_path)
    image = Image.new("RGBA", (target_size * 8, target_size * 8))
    pixels = image.load()
    denom = target_size - 1
    for b in range(target_size):
        tile_x = b % 8
        tile_y = b // 8
        bn = b / denom
        for g in range(target_size):
            gn = g / denom
            y = tile_y * target_size + g
            for r in range(target_size):
                rn = r / denom
                rgb = cube_at(values, size, rn, gn, bn)
                pixels[tile_x * target_size + r, y] = (*rgb, 255)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(out_path)


def build_rules_and_luts():
    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    (PACKAGE_DIR / "luts").mkdir(parents=True, exist_ok=True)
    (ASSET_DIR / "luts").mkdir(parents=True, exist_ok=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    rules = json.loads(RULES_PATH.read_text("utf-8"))
    external = collect_external_luts()
    local_by_id = {item["id"]: item for item in rules.get("filters", [])}
    recommended_ids = []
    for scene in rules.get("scenes", []):
        for filter_id in scene.get("recommendations", []):
            if filter_id not in recommended_ids:
                recommended_ids.append(filter_id)
    for filter_id in FALLBACK_IDS:
        if filter_id not in recommended_ids:
            recommended_ids.append(filter_id)

    filters = []
    effect_no = 9201
    generated_files = {}
    for filter_id in recommended_ids:
        out_name = f"{filter_id}.png" if filter_id.startswith("ai_") else f"lut_{effect_no}.png"
        package_lut = PACKAGE_DIR / "luts" / out_name
        asset_lut = ASSET_DIR / "luts" / out_name

        if filter_id in local_by_id:
            item = dict(local_by_id[filter_id])
            source_lut = ROOT / "scene_lut_recommend" / item["lutFile"]
            shutil.copy2(source_lut, package_lut)
            shutil.copy2(source_lut, asset_lut)
            item["lutFile"] = f"luts/{out_name}"
            item["defaultStrength"] = int(item.get("defaultStrength", 100))
        else:
            src = external.get(filter_id)
            if not src:
                raise KeyError(f"cannot resolve external LUT id: {filter_id}")
            if src["path"].suffix.lower() == ".cube":
                cube_to_hald_png(src["path"], package_lut)
                shutil.copy2(package_lut, asset_lut)
            else:
                shutil.copy2(src["path"], package_lut)
                shutil.copy2(src["path"], asset_lut)
            item = {
                "id": filter_id,
                "effectName": str(effect_no),
                "displayName": src["displayName"],
                "lutFile": f"luts/{out_name}",
                "defaultStrength": 100,
                "iqaStatus": "approved",
            }
            effect_no += 1

        generated_files[filter_id] = item["lutFile"]
        filters.append(item)

    available = {item["id"] for item in filters}
    scenes = []
    for scene in rules.get("scenes", []):
        item = dict(scene)
        recs = [filter_id for filter_id in item.get("recommendations", []) if filter_id in available]
        if not recs:
            recs = [filter_id for filter_id in FALLBACK_IDS if filter_id in available]
        item["recommendations"] = recs[:5]
        if item.get("labels") and item["recommendations"]:
            scenes.append(item)

    apk_rules = {
        "schemaVersion": rules.get("schemaVersion", 1),
        "labelThreshold": rules.get("labelThreshold", 0.55),
        "detectIntervalMs": rules.get("detectIntervalMs", 2500),
        "maxRecommendations": 5,
        "filters": filters,
        "scenes": scenes,
    }

    for out_dir in [PACKAGE_DIR, ASSET_DIR]:
        (out_dir / "rules.json").write_text(json.dumps(apk_rules, ensure_ascii=False, indent=2) + "\n", "utf-8")

    manifest = {
        "generatedAt": BUILD_DATE,
        "sourceRules": str(RULES_PATH.relative_to(ROOT)),
        "filters": [{"id": f["id"], "effectName": f["effectName"], "displayName": f["displayName"], "lutFile": f["lutFile"]} for f in filters],
        "sceneCount": len(scenes),
        "maxRecommendations": 5,
        "notes": [
            "Current APK recommendation engine caps maxRecommendations to 3; developers should update the engine to keep 5 candidates and randomly promote 3 of them.",
            "External CUBE LUTs were converted to 512x512 PNG LUTs for App custom filter loading.",
            "Scenes with empty web recommendations were filled with the current universal fallback set.",
        ],
    }
    (OUT_ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return apk_rules


def write_patched_apk():
    unsigned = BUILD_DIR / "NTCamera-scene-lut-current-unsigned.apk"
    aligned = BUILD_DIR / "NTCamera-scene-lut-current-aligned.apk"
    signed = OUT_ROOT / "NTCamera-scene-lut-current-testSigned.apk"
    unsigned_release = OUT_ROOT / "NTCamera-scene-lut-current-unsigned-for-release-signing.apk"

    replacement_files = {}
    for path in ASSET_DIR.rglob("*"):
        if path.is_file():
            rel = path.relative_to(ASSET_DIR).as_posix()
            replacement_files[f"assets/scene_lut_recommend/{rel}"] = path

    with zipfile.ZipFile(APK_PATH, "r") as src, zipfile.ZipFile(unsigned, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as dst:
        existing = set()
        for info in src.infolist():
            name = info.filename
            if name.startswith("META-INF/"):
                continue
            if name.startswith("assets/scene_lut_recommend/"):
                continue
            data = src.read(name)
            dst.writestr(name, data, compress_type=info.compress_type)
            existing.add(name)
        for name, path in sorted(replacement_files.items()):
            dst.write(path, name)
            existing.add(name)

    shutil.copy2(unsigned, unsigned_release)

    zipalign = Path("/Users/travis.zhao/Library/Android/sdk/build-tools/36.0.0/zipalign")
    apksigner = Path("/Users/travis.zhao/Library/Android/sdk/build-tools/36.0.0/apksigner")
    keystore = OUT_ROOT / "scene_lut_debug.keystore"
    if not keystore.exists():
        subprocess.run([
            "keytool", "-genkeypair", "-v",
            "-keystore", str(keystore),
            "-storepass", "android",
            "-keypass", "android",
            "-alias", "androiddebugkey",
            "-keyalg", "RSA",
            "-keysize", "2048",
            "-validity", "10000",
            "-dname", "CN=Android Debug,O=Scene LUT,C=US",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    subprocess.run([str(zipalign), "-f", "-p", "4", str(unsigned), str(aligned)], check=True)
    subprocess.run([
        str(apksigner), "sign",
        "--ks", str(keystore),
        "--ks-key-alias", "androiddebugkey",
        "--ks-pass", "pass:android",
        "--key-pass", "pass:android",
        "--out", str(signed),
        str(aligned),
    ], check=True)
    subprocess.run([str(apksigner), "verify", "--verbose", str(signed)], check=True)
    return unsigned_release, signed


def main():
    apk_rules = build_rules_and_luts()
    unsigned_release, signed = write_patched_apk()
    print(f"scene_count={len(apk_rules['scenes'])}")
    print(f"filter_count={len(apk_rules['filters'])}")
    print(f"external_config={PACKAGE_DIR}")
    print(f"unsigned_for_release_signing={unsigned_release}")
    print(f"test_signed_apk={signed}")


if __name__ == "__main__":
    main()

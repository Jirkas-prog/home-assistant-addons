"""One-shot add-on installer. Never edits HA YAML or Scheduler runtime data."""
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path


def install(source: Path, config: Path, data: Path, replace_existing=False):
    config = config.resolve(strict=True)
    payloads = (Path("custom_components/scheduler"), Path("www/workflow-timers"))
    manifest = config / payloads[0] / "manifest.json"
    if manifest.exists():
        version = json.loads(manifest.read_text(encoding="utf-8")).get("version", "")
        if "+workflow." not in version and not replace_existing:
            raise RuntimeError("An existing Scheduler installation was found. Back up Home Assistant, disable Scheduler updates in HACS, then set replace_existing_scheduler: true to replace its code. Timer data will be kept.")
    # Reject symlinks before touching any destination, including parent directories.
    writes = []
    for folder in payloads:
        for src in (source / folder).rglob("*"):
            if src.is_symlink():
                raise RuntimeError("Symlinks are not supported in the payload.")
            if not src.is_file() or "__pycache__" in src.parts or src.suffix == ".pyc":
                continue
            relative = src.relative_to(source)
            dst = config / relative
            if any(p.is_symlink() for p in [dst, *dst.parents] if p != config.parent):
                raise RuntimeError("A destination contains a symlink; installation was stopped.")
            if not dst.resolve().is_relative_to(config):
                raise RuntimeError("Destination escapes the Home Assistant configuration folder.")
            if not dst.exists() or src.read_bytes() != dst.read_bytes():
                writes.append((src, dst, relative))
    if not writes:
        return None
    backup = data / "backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(parents=True)
    journal = []
    for _, dst, relative in writes:
        journal.append({"path": relative.as_posix(), "existed": dst.exists()})
        if dst.exists():
            saved = backup / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, saved)
    (backup / "files.json").write_text(json.dumps(journal, indent=2), encoding="utf-8")
    # Replace each file atomically. An exception rolls completed writes back.
    completed = []
    try:
        for src, dst, relative in writes:
            dst.parent.mkdir(parents=True, exist_ok=True)
            temporary = dst.with_name(dst.name + ".workflow-new")
            try:
                shutil.copyfile(src, temporary)
                os.replace(temporary, dst)
            finally:
                temporary.unlink(missing_ok=True)
            completed.append((dst, relative))
    except Exception:
        for dst, relative in reversed(completed):
            saved = backup / relative
            if saved.exists():
                shutil.copyfile(saved, dst)
            else:
                dst.unlink(missing_ok=True)
        raise
    return backup


if __name__ == "__main__":
    options = json.loads(Path("/data/options.json").read_text(encoding="utf-8"))
    backup = install(Path("/app"), Path("/homeassistant"), Path("/data"), options.get("replace_existing_scheduler", False))
    print(f"WorkFlow Timers installed. Previous code saved in {backup}." if backup else "WorkFlow Timers is already up to date.")
    print("Next: restart Home Assistant Core, then add the 'Scheduler' integration in Settings > Devices & services if it is not configured yet.")
    print("Open 'Casovace' (Timers) in the sidebar. For dashboards, add /local/workflow-timers/workflow-timers.js?v=1.0.1 as a JavaScript module resource, then add custom:workflow-timers-card in a Panel view.")
    print("This installer now stops normally. The timers run inside Home Assistant Core. No HACS or Node-RED setup is required.")

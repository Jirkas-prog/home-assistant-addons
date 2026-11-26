"""Small, timezone-aware publishing calendar with durable occurrence keys."""
from __future__ import annotations

from datetime import datetime, timedelta, time, timezone
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_CLOCK = re.compile(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
_NO_STORY = re.compile(r"(?<!\S)/nostory(?!\S)", re.I)


def story_requested(description):
    """Only a complete /nostory command in the event description opts out.

    A command is separated by whitespace or the start/end of the description.
    Titles, URLs and longer commands are deliberately not interpreted.
    """
    return not (isinstance(description, str) and _NO_STORY.search(description))


def _local_time(day, clock: str, zone: ZoneInfo) -> datetime | None:
    """Skip a spring gap; choose the first occurrence of an autumn overlap."""
    naive = datetime.combine(day, time.fromisoformat(clock))
    candidate = naive.replace(tzinfo=zone, fold=0)
    round_trip = candidate.astimezone(UTC).astimezone(zone)
    return candidate if round_trip.replace(tzinfo=None) == naive else None


def validate_schedule(schedule: dict) -> dict:
    if not isinstance(schedule, dict):
        raise ValueError("The calendar must be an object.")
    name = schedule.get("timezone", "Europe/Prague")
    if not isinstance(name, str):
        raise ValueError("Invalid timezone.")
    try:
        zone = ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Unknown IANA timezone.") from None
    result = {"timezone": name, "weekly": [], "once": []}
    seen = set()
    for kind in ("weekly", "once"):
        rules = schedule.get(kind, [])
        if not isinstance(rules, list) or len(rules) > 1000:
            raise ValueError("The calendar supports at most 1000 rules of each type.")
        for rule in rules:
            if not isinstance(rule, dict):
                raise ValueError("A calendar rule must be an object.")
            key = rule.get("id")
            if not isinstance(key, str) or not _ID.fullmatch(key) or key in seen:
                raise ValueError("Each rule needs a unique ID (letters, numbers, - or _).")
            seen.add(key)
            enabled = rule.get("enabled", True)
            if not isinstance(enabled, bool):
                raise ValueError("enabled must be true or false.")
            if kind == "weekly":
                days, clock = rule.get("days"), rule.get("time")
                if (not isinstance(days, list) or not days or len(days) > 7
                        or any(type(day) is not int or not 0 <= day <= 6 for day in days)
                        or len(set(days)) != len(days)):
                    raise ValueError("Days must be unique numbers from 0 to 6 (Monday to Sunday).")
                if not isinstance(clock, str) or not _CLOCK.fullmatch(clock):
                    raise ValueError("Time must use the HH:MM format.")
                result[kind].append({"id": key, "days": sorted(days), "time": clock, "enabled": enabled})
            else:
                at = rule.get("at")
                if not isinstance(at, str):
                    raise ValueError("A one-time slot requires an ISO date and time.")
                try:
                    parsed = datetime.fromisoformat(at.replace("Z", "+00:00"))
                except ValueError:
                    raise ValueError("Invalid ISO date and time.") from None
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=zone, fold=0)
                    if parsed.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != parsed.replace(tzinfo=None):
                        raise ValueError("This local time does not exist during the daylight-saving change.")
                parsed = parsed.astimezone(zone)
                result[kind].append({"id": key, "at": parsed.isoformat(), "enabled": enabled})
    return result


def _now(now: datetime) -> datetime:
    if not isinstance(now, datetime) or now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("now must include a timezone.")
    return now.astimezone(UTC)


def _slots(schedule: dict, start: datetime, end: datetime) -> list[dict]:
    schedule = validate_schedule(schedule)
    zone = ZoneInfo(schedule["timezone"])
    day = start.astimezone(zone).date() - timedelta(days=1)
    last = end.astimezone(zone).date() + timedelta(days=1)
    result = []
    while day <= last:
        for rule in schedule["weekly"]:
            if not rule["enabled"] or day.weekday() not in rule["days"]:
                continue
            at = _local_time(day, rule["time"], zone)
            if at is not None and start <= at.astimezone(UTC) <= end:
                result.append({"key": f"weekly:{rule['id']}:{day.isoformat()}:{rule['time']}",
                               "at": at.isoformat(), "label": "Scheduled post"})
        day += timedelta(days=1)
    for rule in schedule["once"]:
        at = datetime.fromisoformat(rule["at"])
        if rule["enabled"] and start <= at.astimezone(UTC) <= end:
            result.append({"key": f"once:{rule['id']}:{at.astimezone(UTC).isoformat()}",
                           "at": at.isoformat(), "label": "Scheduled post"})
    return sorted(result, key=lambda slot: (datetime.fromisoformat(slot["at"]).astimezone(UTC), slot["key"]))


def due_slots(schedule: dict, now: datetime, window_seconds: int = 90) -> list[dict]:
    now = _now(now)
    if type(window_seconds) is not int or not 0 <= window_seconds <= 3600:
        raise ValueError("The checking window must be between 0 and 3600 seconds.")
    return _slots(schedule, now - timedelta(seconds=window_seconds), now)


def next_slots(schedule: dict, now: datetime, limit: int = 14) -> list[dict]:
    now = _now(now)
    if type(limit) is not int or not 1 <= limit <= 1000:
        raise ValueError("The number of upcoming slots must be between 1 and 1000.")
    canonical = validate_schedule(schedule)
    # At most 1000 weekly occurrences need 7000 days. Extend only if necessary.
    horizon = max(14, min(7000, limit * 7 + 7))
    candidates = _slots(canonical, now, now + timedelta(days=horizon))
    # A solitary, explicitly dated event may be further away than the weekly horizon.
    known = {slot["key"] for slot in candidates}
    for rule in canonical["once"]:
        at = datetime.fromisoformat(rule["at"])
        key = f"once:{rule['id']}:{at.astimezone(UTC).isoformat()}"
        if rule["enabled"] and at.astimezone(UTC) >= now and key not in known:
            candidates.append({"key": key, "at": at.isoformat(), "label": "Scheduled post"})
    return sorted(candidates, key=lambda slot: (datetime.fromisoformat(slot["at"]).astimezone(UTC), slot["key"]))[:limit]

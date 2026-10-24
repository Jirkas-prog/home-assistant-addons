"""Small, dependency-free WorkFlow extension to Scheduler (GPL-3.0)."""

MANAGED_TAG = "workflow-timers:v1"
SKIP_PREFIX = "workflow-skip:"


def skip_action(tags, local_date, service):
    """Skip activation today; never suppress the scheduled off/close action."""
    return (
        MANAGED_TAG in tags
        and SKIP_PREFIX + local_date.isoformat() in tags
        and service not in {
            "switch.turn_off", "light.turn_off", "fan.turn_off",
            "input_boolean.turn_off", "cover.close_cover",
        }
    )

"""Return one validated iPhone simulator UUID from simctl JSON."""
import json
import sys
from uuid import UUID


def select_simulator(payload):
    for group in payload.get("devices", {}).values():
        for device in group:
            if str(device.get("name", "")).startswith("iPhone"):
                raw = device.get("udid", "")
                value = str(UUID(raw))
                if raw.lower() != value:
                    raise ValueError("Simulator UDID must be a canonical UUID")
                return value
    raise ValueError("No available iPhone simulator found")


if __name__ == "__main__":
    print(select_simulator(json.load(sys.stdin)))

"""Select an Xcode 16-compatible iPhone simulator from simctl JSON."""
import json
import sys
from uuid import UUID


def select_simulator(payload):
    devices = payload.get("devices", {})
    # The runner has newer iOS 26 runtimes, but Xcode 16.4 can only test
    # against its supported iOS 18.x simulator SDK/runtime.
    candidates = []
    for runtime, group in devices.items():
        if "iOS-18-" not in runtime:
            continue
        for device in group:
            if not str(device.get("name", "")).startswith("iPhone"):
                continue
            if device.get("isAvailable") is False:
                continue
            raw = device.get("udid", "")
            value = str(UUID(raw))
            candidates.append((runtime, value))
    if candidates:
        # Choose newest available supported runtime.
        return sorted(candidates, reverse=True)[0][1]
    raise ValueError("No Xcode 16-compatible iOS 18 iPhone simulator available")


if __name__ == "__main__":
    print(select_simulator(json.load(sys.stdin)))

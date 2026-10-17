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
        if "iOS-18-5" not in runtime:
            continue
        for device in group:
            if not str(device.get("name", "")).startswith("iPhone"):
                continue
            if device.get("isAvailable") is False:
                continue
            raw = device.get("udid", "")
            # Validate the UUID but keep simctl's uppercase form: xcodebuild matches destination ids case-sensitively.
            value = str(UUID(raw)).upper()
            if value != str(raw).upper():
                raise ValueError("Unexpected simulator id format: " + str(raw)[:60])
            candidates.append((runtime, value))
    if candidates:
        # Choose a device on the iOS 18.5 runtime bundled with Xcode 16.4.
        return sorted(candidates, reverse=True)[0][1]
    raise ValueError("No iOS 18.5 iPhone simulator available for Xcode 16.4")


if __name__ == "__main__":
    print(select_simulator(json.load(sys.stdin)))

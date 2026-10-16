import json

def validate_json(data, schema):
    """Validates a dictionary against a simple schema."""
    for key, expected_type in schema.items():
        if key not in data:
            raise ValueError(f"Missing key: {key}")
        if not isinstance(data[key], expected_type):
            raise TypeError(f"Key {key} expected {expected_type.__name__}, got {type(data[key]).__name__}")
    return True

if __name__ == "__main__":
    sample_schema = {"name": str, "age": int}
    sample_data = {"name": "Kappa", "age": 1}
    try:
        validate_json(sample_data, sample_schema)
        print("Validation successful")
    except Exception as e:
        print(f"Validation failed: {e}")
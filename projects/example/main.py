import json

class FeatureManager:
    def __init__(self):
        self.features = {}

    def implement_feature(self, name, logic):
        self.features[name] = logic
        return f"Feature '{name}' implemented."

    def run_feature(self, name, *args):
        if name in self.features:
            return self.features[name](*args)
        return None

def main():
    fm = FeatureManager()
    # Step 1: Implement first feature
    fm.implement_feature("data_processor", lambda x: x.upper())
    # Step 2: Implement second feature
    fm.implement_feature("math_adder", lambda a, b: a + b)
    
    print(fm.run_feature("data_processor", "hello"))
    print(fm.run_feature("math_adder", 5, 10))

if __name__ == "__main__":
    main()
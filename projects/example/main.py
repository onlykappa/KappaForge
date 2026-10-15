import sys

def calculate(expression):
    try:
        return eval(expression, {"__builtins__": {}})
    except Exception:
        return None

def main():
    if len(sys.argv) > 1:
        result = calculate(sys.argv[1])
        if result is not None:
            print(result)
        else:
            print("Error: Invalid expression")

if __name__ == "__main__":
    main()
import time

class SkipTimer:
    def __init__(self, duration):
        self.duration = duration
        self.start_time = None
        self.skipped = False

    def start(self):
        self.start_time = time.time()

    def skip(self):
        self.skipped = True

    def is_active(self):
        if self.skipped:
            return False
        if self.start_time is None:
            return False
        return (time.time() - self.start_time) < self.duration

if __name__ == '__main__':
    timer = SkipTimer(5)
    timer.start()
    print(f'Timer active: {timer.is_active()}')
    timer.skip()
    print(f'Timer active after skip: {timer.is_active()}')
from datetime import datetime


def log(tag: str, msg: str, data: object = None):
    ts = datetime.utcnow().isoformat()
    if data is not None:
        print(f"[{ts}] [{tag}] {msg} | {data}", flush=True)
    else:
        print(f"[{ts}] [{tag}] {msg}", flush=True)

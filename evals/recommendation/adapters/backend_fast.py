"""Runs jd-fit-api's deterministic fast scorer over the evaluation cases.

Usage (invoked by run.ts): python backend_fast.py <path-to-jd-fit-api>  < payload.json
Payload: {"repeats": N, "cases": [...]}  Output: JSON on stdout.
No network or model calls: score_jd_fast is pure.
"""
import json
import sys
import time

sys.path.insert(0, sys.argv[1])
from models import ScreenRequest  # noqa: E402
from scorer import score_jd_fast  # noqa: E402


def request_for(case: dict) -> ScreenRequest:
    return ScreenRequest(
        jd_text=case["job"]["jd_text"],
        job_title=case["job"]["title"],
        company=case["job"]["company"],
        resume_text=case["candidate"]["resume_text"],
        hard_reject_filters=case["candidate"]["filters"],
        api_key="not-used-by-fast-scorer",
        api_provider="groq",
        analysis_mode="fast",
    )


def main() -> None:
    payload = json.load(sys.stdin)
    cases = payload["cases"]
    requests = [request_for(case) for case in cases]
    for request in requests:  # untimed warm-up pass
        score_jd_fast(request)
    runs = []
    for _ in range(payload["repeats"]):
        started = time.perf_counter()
        items = []
        for case, request in zip(cases, requests):
            t0 = time.perf_counter()
            result = score_jd_fast(request)
            items.append({"id": case["id"], "ms": (time.perf_counter() - t0) * 1000, "output": result.model_dump(mode="json")})
        runs.append({"batch_ms": (time.perf_counter() - started) * 1000, "items": items})
    json.dump({"runs": runs}, sys.stdout)


if __name__ == "__main__":
    main()

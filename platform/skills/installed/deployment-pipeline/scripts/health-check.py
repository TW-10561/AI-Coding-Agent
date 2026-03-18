#!/usr/bin/env python3
"""
health-check.py -- Validate health endpoints of deployed services.

Checks liveness and readiness endpoints, validates response format,
and writes structured results to a JSON file.

Usage:
    python health-check.py --url https://staging.example.com --output-dir ./results/
    python health-check.py --url https://api.example.com --retries 5 --timeout 30 --output-dir ./results/
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate health check endpoints for deployed services"
    )
    parser.add_argument(
        "--url",
        required=True,
        help="Base URL of the service (e.g., https://staging.example.com)",
    )
    parser.add_argument(
        "--output-dir",
        default="./health-check-results",
        help="Directory for health check result files (default: ./health-check-results)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Number of retries for each health check (default: 3)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="HTTP request timeout in seconds (default: 30)",
    )
    parser.add_argument(
        "--retry-delay",
        type=int,
        default=5,
        help="Delay between retries in seconds (default: 5)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )
    return parser.parse_args()


def log(message: str, verbose: bool = True) -> None:
    if verbose:
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"[{timestamp}] {message}")


def check_endpoint(
    base_url: str,
    path: str,
    timeout: int,
    retries: int,
    retry_delay: int,
    verbose: bool = False,
) -> dict:
    """Check a single health endpoint with retries."""
    url = f"{base_url.rstrip('/')}{path}"
    result = {
        "endpoint": path,
        "url": url,
        "status": "unknown",
        "http_code": None,
        "response_time_ms": None,
        "response_body": None,
        "error": None,
        "attempts": 0,
    }

    for attempt in range(1, retries + 1):
        result["attempts"] = attempt
        log(f"  Checking {url} (attempt {attempt}/{retries})", verbose)

        start_time = time.monotonic()
        try:
            req = Request(url, method="GET")
            req.add_header("Accept", "application/json")
            req.add_header("User-Agent", "health-check-script/1.0")

            with urlopen(req, timeout=timeout) as response:
                elapsed_ms = (time.monotonic() - start_time) * 1000
                body = response.read().decode("utf-8")
                http_code = response.status

                result["http_code"] = http_code
                result["response_time_ms"] = round(elapsed_ms, 2)

                try:
                    result["response_body"] = json.loads(body)
                except json.JSONDecodeError:
                    result["response_body"] = body[:500]

                if http_code == 200:
                    result["status"] = "healthy"
                    log(f"  OK: {path} returned {http_code} in {elapsed_ms:.0f}ms", verbose)
                    return result
                elif http_code == 503:
                    result["status"] = "degraded"
                    log(f"  DEGRADED: {path} returned 503", verbose)
                else:
                    result["status"] = "unhealthy"
                    log(f"  WARN: {path} returned {http_code}", verbose)

        except URLError as e:
            elapsed_ms = (time.monotonic() - start_time) * 1000
            result["response_time_ms"] = round(elapsed_ms, 2)
            result["error"] = str(e.reason)
            result["status"] = "unreachable"
            log(f"  ERROR: {path} - {e.reason}", verbose)

        except Exception as e:
            elapsed_ms = (time.monotonic() - start_time) * 1000
            result["response_time_ms"] = round(elapsed_ms, 2)
            result["error"] = str(e)
            result["status"] = "error"
            log(f"  ERROR: {path} - {e}", verbose)

        if attempt < retries:
            log(f"  Retrying in {retry_delay}s...", verbose)
            time.sleep(retry_delay)

    return result


def validate_readiness_response(response_body: dict) -> list[str]:
    """Validate the structure of a readiness response."""
    issues = []
    if not isinstance(response_body, dict):
        issues.append("Response is not a JSON object")
        return issues

    if "status" not in response_body:
        issues.append("Missing 'status' field")

    if "checks" in response_body:
        checks = response_body["checks"]
        if isinstance(checks, dict):
            for service, status in checks.items():
                if status != "ok":
                    issues.append(f"Dependency '{service}' is not ok: {status}")
        else:
            issues.append("'checks' field is not a dictionary")

    return issues


def main() -> int:
    args = parse_args()

    # Setup output directory
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    result_file = output_dir / f"health-check-{timestamp}.json"
    log_file = output_dir / f"health-check-{timestamp}.log"

    log(f"Health check starting for {args.url}", True)
    log(f"Retries: {args.retries}, Timeout: {args.timeout}s", args.verbose)

    # Define endpoints to check
    endpoints = [
        {"path": "/health", "name": "Liveness", "required": True},
        {"path": "/health/ready", "name": "Readiness", "required": True},
    ]

    results = []
    overall_healthy = True

    for endpoint in endpoints:
        log(f"\nChecking {endpoint['name']} ({endpoint['path']})...", True)

        result = check_endpoint(
            base_url=args.url,
            path=endpoint["path"],
            timeout=args.timeout,
            retries=args.retries,
            retry_delay=args.retry_delay,
            verbose=args.verbose,
        )
        result["name"] = endpoint["name"]
        result["required"] = endpoint["required"]

        # Validate readiness response structure
        if endpoint["path"] == "/health/ready" and result["response_body"]:
            if isinstance(result["response_body"], dict):
                issues = validate_readiness_response(result["response_body"])
                result["validation_issues"] = issues
                if issues:
                    log(f"  Validation issues: {issues}", True)

        if result["status"] != "healthy" and endpoint["required"]:
            overall_healthy = False

        results.append(result)

    # Summary
    healthy_count = sum(1 for r in results if r["status"] == "healthy")
    total_count = len(results)

    summary = {
        "base_url": args.url,
        "timestamp": timestamp,
        "overall_status": "healthy" if overall_healthy else "unhealthy",
        "total_checks": total_count,
        "healthy_checks": healthy_count,
        "unhealthy_checks": total_count - healthy_count,
        "results": results,
    }

    # Write results
    with open(result_file, "w") as f:
        json.dump(summary, f, indent=2, default=str)

    # Write log
    with open(log_file, "w") as f:
        f.write(f"Health check results for {args.url}\n")
        f.write(f"Timestamp: {timestamp}\n")
        f.write(f"Overall: {summary['overall_status']}\n\n")
        for r in results:
            f.write(f"{r['name']} ({r['endpoint']}): {r['status']}\n")
            if r.get("response_time_ms"):
                f.write(f"  Response time: {r['response_time_ms']}ms\n")
            if r.get("error"):
                f.write(f"  Error: {r['error']}\n")

    log(f"\nOverall: {summary['overall_status'].upper()}", True)
    log(f"Results written to {result_file}", True)

    return 0 if overall_healthy else 1


if __name__ == "__main__":
    sys.exit(main())

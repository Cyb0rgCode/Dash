"""
predictor.py — time-logging forecast for ICE.

Public API (called by app.py):
    forecast(historical, horizon=7) -> list[float]

Arguments
---------
historical : list[float]
    60 daily totals, oldest first. 0.0 means no time was logged that day.
horizon : int
    Number of future days to predict (default 7).

Returns
-------
list[float]
    `horizon` non-negative predicted minute values.

Algorithm
---------
Uses Holt's linear (double exponential) smoothing — level + trend —
which handles both users who are ramping up and users who are consistent.

Sparse-data path: if fewer than 5 days have any logging, there is not
enough signal for trend estimation, so the predictor falls back to a flat
forecast at the recent weekly average.

Weekly-seasonality path: if 4+ full weeks of data exist (≥ 20 logged days),
multiplicative day-of-week indices are computed and applied on top of Holt,
so a user who always logs more on weekdays gets a more accurate forecast.
"""

from __future__ import annotations


# ── helpers ──────────────────────────────────────────────────────────────────

def _clamp(values: list[float]) -> list[float]:
    return [max(0.0, v) for v in values]


def _weekly_indices(series: list[float], period: int = 7) -> list[float]:
    """
    Compute multiplicative seasonal indices for each position within `period`.
    Returns a list of length `period`. Index 1.0 means average; >1 means
    above-average day, <1 means below-average day.
    """
    n = len(series)
    n_full = (n // period) * period
    if n_full == 0:
        return [1.0] * period

    trimmed = series[-n_full:]
    buckets = [[] for _ in range(period)]
    for i, v in enumerate(trimmed):
        buckets[i % period].append(v)

    means = [sum(b) / len(b) if b else 0.0 for b in buckets]
    grand  = sum(means) / period if period else 1.0
    if grand == 0:
        return [1.0] * period

    return [m / grand for m in means]


# ── core ─────────────────────────────────────────────────────────────────────

def _holt(series: list[float],
          alpha: float = 0.35,
          beta:  float = 0.05) -> tuple[float, float]:
    """
    Fit Holt's linear (double-exponential) smoothing to `series`.
    Returns (level, trend) after consuming all observations.
    """
    if not series:
        return 0.0, 0.0

    level = series[0]
    trend = 0.0
    if len(series) > 1:
        trend = series[1] - series[0]

    for i in range(1, len(series)):
        prev_level = level
        level = alpha * series[i] + (1 - alpha) * (level + trend)
        trend = beta  * (level - prev_level) + (1 - beta) * trend

    return level, trend


# ── public API ────────────────────────────────────────────────────────────────

def forecast(historical: list[float], horizon: int = 7) -> list[float]:
    """
    Predict the next `horizon` daily minutes from `historical`.
    """
    if not historical:
        return [0.0] * horizon

    nonzero_days = [v for v in historical if v > 0]
    n_nonzero    = len(nonzero_days)

    # ── 1. Completely cold start ─────────────────────────────────────────────
    if n_nonzero == 0:
        return [0.0] * horizon

    # ── 2. Too sparse for trend estimation (< 5 logged days) ────────────────
    if n_nonzero < 5:
        recent_mean = sum(historical[-14:]) / 14
        return _clamp([recent_mean] * horizon)

    # ── 3. Enough data for trend (Holt) + optional seasonality ───────────────
    level, trend = _holt(historical)

    # Weekly seasonality: only apply when ≥ 4 full weeks AND ≥ 20 logged days.
    use_seasonality = (len(historical) >= 28) and (n_nonzero >= 20)
    if use_seasonality:
        indices = _weekly_indices(historical, period=7)
        # The next day's position in the week cycle:
        start_pos = len(historical) % 7
        preds = [
            (level + (i + 1) * trend) * indices[(start_pos + i) % 7]
            for i in range(horizon)
        ]
    else:
        preds = [level + (i + 1) * trend for i in range(horizon)]

    return _clamp(preds)

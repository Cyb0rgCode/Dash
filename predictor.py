import threading
import numpy as np

_model = None
_model_lock = threading.Lock()
_model_err = None


def _load():
    global _model, _model_err
    try:
        import torch
        import timesfm

        torch.set_float32_matmul_precision("high")
        m = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
            "google/timesfm-2.5-200m-pytorch"
        )
        m.compile(
            timesfm.ForecastConfig(
                max_context=1024,
                max_horizon=64,
                normalize_inputs=True,
                use_continuous_quantile_head=True,
                force_flip_invariance=True,
                infer_is_positive=True,
                fix_quantile_crossing=True,
            )
        )
        _model = m
    except Exception as exc:
        _model_err = str(exc)
        raise


def get_model():
    if _model_err:
        raise RuntimeError(_model_err)
    if _model is None:
        with _model_lock:
            if _model is None:
                _load()
    return _model


def forecast(values: list, horizon: int = 7) -> list:
    """Return `horizon` predicted daily values given historical `values` (oldest first)."""
    arr = np.array(values, dtype=np.float32)
    point_forecast, _ = get_model().forecast(horizon=horizon, inputs=[arr])
    return [max(0.0, float(v)) for v in point_forecast[0]]

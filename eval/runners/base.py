from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class EvalResult:
    name: str
    headline_metric: str  # e.g. "Span F1"
    headline_value: float
    detail: dict[str, Any]
    n: int
    run_at: datetime
    notes: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "headline_metric": self.headline_metric,
            "headline_value": self.headline_value,
            "detail": self.detail,
            "n": self.n,
            "run_at": self.run_at.isoformat(),
            "notes": self.notes,
        }

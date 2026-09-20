from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class EvalResult:
    """The one envelope every runner returns, so report.py never special-cases."""

    name: str
    headline_metric: str  # the number the pitch quotes, e.g. "Span F1"
    headline_value: float
    detail: dict[str, Any]  # per-class tables, counts, failures: everything worth keeping
    n: int  # how many items were actually scored, not how many were asked for
    run_at: datetime
    notes: str  # caveats and disclosed splits, for a reader who was not here

    def to_dict(self) -> dict[str, Any]:
        """
        Plain JSON-serializable form, with run_at as an ISO 8601 string.
        """

        return {
            "name": self.name,
            "headline_metric": self.headline_metric,
            "headline_value": self.headline_value,
            "detail": self.detail,
            "n": self.n,
            "run_at": self.run_at.isoformat(),
            "notes": self.notes,
        }

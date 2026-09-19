import asyncio
import logging
import random
import re
import time
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from backend.app.config import get_settings, require_setting

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

MODEL_LARGE = get_settings().nvidia_model_large
MODEL_SMALL = get_settings().nvidia_model_small

_RETRY_STATUS = {429, 500, 502, 503, 504}
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)
_JSON_FENCE = re.compile(r"```(?:json)?(.*?)```", re.DOTALL)
_REPROMPT = (
    "Your previous reply could not be parsed: {error}\n"
    "Reply again with only the JSON object, no prose and no code fences."
)


class NemotronError(Exception):
    """Call failed after retries, or output was unparseable after the reprompt."""


def _load_api_key() -> str:
    return require_setting(get_settings().nvidia_api_key, "NVIDIA_API_KEY")


class NemotronClient:
    """The single choke point for model calls. Nothing else calls the model API directly."""

    def __init__(
        self, http: httpx.AsyncClient, *, api_key: str | None = None, timeout_s: float = 30.0
    ) -> None:
        self._http = http
        # Pass api_key explicitly to override, e.g. when read from a mounted secret file.
        self._api_key = (api_key or _load_api_key()).strip()
        self._base_url = get_settings().nvidia_base_url.rstrip("/")
        self._timeout_s = timeout_s

    async def complete_json(
        self,
        prompt: str,
        model: str,
        schema: type[T],
        *,
        retries: int = 2,
        thinking: bool = False,
    ) -> T:
        """Send the prompt, return a parsed `schema` instance.

        Transport errors, 429 and 5xx retry with jittered backoff. If the reply doesn't
        parse, the model is reprompted once before raising NemotronError. `thinking` turns
        the model's reasoning mode on; it is slower, so it is off unless a stage needs it.
        """
        messages = [{"role": "user", "content": prompt}]
        error: Exception | None = None

        for attempt in range(2):  # first try, then one reprompt
            content = await self._chat(messages, model, retries=retries, thinking=thinking)
            try:
                return schema.model_validate_json(_extract_json(content))
            except (ValidationError, ValueError) as exc:
                error = exc
                logger.warning("nemotron_parse_failed model=%s attempt=%d", model, attempt)
                if content:
                    messages.append({"role": "assistant", "content": content})
                messages.append({"role": "user", "content": _REPROMPT.format(error=str(exc)[:500])})

        raise NemotronError(f"unparseable output from {model} after reprompt: {error}")

    async def _chat(
        self, messages: list[dict[str, str]], model: str, *, retries: int, thinking: bool
    ) -> str:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": 0.0,
            "max_tokens": 16384 if thinking else 4096,
            # sent at the top level of the body; the OpenAI SDK's `extra_body` merges to here
            "chat_template_kwargs": {"enable_thinking": thinking},
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "application/json"}

        for attempt in range(retries + 1):
            started = time.perf_counter()
            try:
                resp = await self._http.post(
                    f"{self._base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=self._timeout_s,
                )
            except httpx.TransportError as exc:  # includes timeouts
                failure = f"{type(exc).__name__}: {exc}"
            else:
                if resp.status_code == 200:
                    return self._read_reply(resp, model, started)
                if resp.status_code not in _RETRY_STATUS:
                    raise NemotronError(f"{model} returned {resp.status_code}: {resp.text[:300]}")
                failure = f"status {resp.status_code}"

            if attempt == retries:
                raise NemotronError(f"{model} failed after {retries + 1} attempts: {failure}")
            await asyncio.sleep(min(8.0, 2.0**attempt) * (0.5 + random.random()))

        raise AssertionError("unreachable")

    def _read_reply(self, resp: httpx.Response, model: str, started: float) -> str:
        try:
            body = resp.json()
            content = body["choices"][0]["message"].get("content") or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise NemotronError(f"malformed response from {model}: {exc}") from exc

        usage = body.get("usage") or {}
        logger.info(
            "nemotron_call model=%s prompt_tokens=%s completion_tokens=%s latency_ms=%d",
            model,
            usage.get("prompt_tokens"),
            usage.get("completion_tokens"),
            (time.perf_counter() - started) * 1000,
        )
        return content


def _extract_json(text: str) -> str:
    """Pull the JSON object out of a reply: drop <think> blocks and fences, trim to {...}."""
    text = _THINK_BLOCK.sub("", text)
    text = text.rsplit("</think>", 1)[-1]  # opener may have been consumed by the chat template
    fenced = _JSON_FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if 0 <= start < end else text.strip()

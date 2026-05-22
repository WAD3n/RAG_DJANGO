import logging
from types import TracebackType

import httpx

from core.config import Settings

logger = logging.getLogger(__name__)


class VLLMClient:
    """Async client for a vLLM / Ollama OpenAI-compatible inference server."""

    def __init__(self, settings: Settings) -> None:
        self._model = settings.vllm_model
        self._max_tokens = settings.vllm_max_tokens
        self._temperature = settings.vllm_temperature
        self._http = httpx.AsyncClient(
            base_url=settings.vllm_base_url,
            headers={"Authorization": f"Bearer {settings.vllm_api_key}"},
            timeout=settings.vllm_timeout,
        )
        logger.info(
            "VLLMClient initialised — base_url=%s model=%s",
            settings.vllm_base_url,
            self._model,
        )

    async def complete(self, prompt: str, system: str = "", model: str | None = None) -> str:
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        logger.debug("VLLMClient.complete — prompt_len=%d", len(prompt))
        try:
            response = await self._http.post(
                "/chat/completions",
                json={
                    "model": model or self._model,
                    "messages": messages,
                    "max_tokens": self._max_tokens,
                    "temperature": self._temperature,
                },
            )
            response.raise_for_status()
            answer = response.json()["choices"][0]["message"]["content"]
            logger.debug("VLLMClient.complete — answer_len=%d", len(answer))
            return answer
        except httpx.HTTPStatusError as exc:
            logger.error(
                "VLLMClient HTTP error — status=%d body=%s",
                exc.response.status_code,
                exc.response.text[:200],
            )
            raise
        except Exception:
            logger.exception("VLLMClient.complete failed")
            raise

    async def aclose(self) -> None:
        await self._http.aclose()
        logger.debug("VLLMClient HTTP client closed")

    async def __aenter__(self) -> "VLLMClient":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.aclose()

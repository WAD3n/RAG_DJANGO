"""Azure OpenAI LLM client — drop-in for VLLMClient / LocalLLMClient."""

import logging

from openai import AzureOpenAI

from core.config import Settings

logger = logging.getLogger(__name__)


class AzureOpenAIClient:
    def __init__(self, settings: Settings) -> None:
        self._client = AzureOpenAI(
            azure_endpoint=settings.azure_endpoint,
            api_key=settings.azure_api_key,
            api_version=settings.azure_api_version,
        )
        self._default_deployment = settings.azure_deployment
        self._max_tokens = settings.vllm_max_tokens
        self._temperature = settings.vllm_temperature
        logger.info(
            "AzureOpenAIClient ready — endpoint=%s default_deployment=%s",
            settings.azure_endpoint,
            self._default_deployment,
        )

    async def complete(self, prompt: str, system: str = "", model: str | None = None) -> str:
        deployment = model or self._default_deployment
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        logger.debug("AzureOpenAIClient.complete — deployment=%s prompt_len=%d", deployment, len(prompt))
        try:
            response = self._client.chat.completions.create(
                model=deployment,
                messages=messages,
                max_completion_tokens=self._max_tokens,
                temperature=self._temperature,
            )
            answer = response.choices[0].message.content or ""
            logger.debug("AzureOpenAIClient.complete — answer_len=%d", len(answer))
            return answer
        except Exception:
            logger.exception("AzureOpenAIClient.complete failed — deployment=%s", deployment)
            raise

    async def __aenter__(self) -> "AzureOpenAIClient":
        return self

    async def __aexit__(self, *_) -> None:
        pass

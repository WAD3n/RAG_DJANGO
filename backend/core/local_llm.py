"""
Local LLM inference via HuggingFace transformers.
Drop-in replacement for VLLMClient when no external server is available.
"""

from __future__ import annotations

import logging

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, GenerationConfig, pipeline

from core.config import Settings

logger = logging.getLogger(__name__)


def _device(settings: Settings) -> str:
    if settings.device in ("cuda", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    return "cpu"


class LocalLLMClient:
    """
    Synchronous local inference using transformers.AutoModelForCausalLM.
    Provides the same complete() interface as VLLMClient.
    """

    def __init__(self, settings: Settings) -> None:
        device = _device(settings)
        dtype = torch.bfloat16 if device == "cuda" else torch.float32
        logger.info(
            "Loading LocalLLM — model=%s device=%s dtype=%s",
            settings.local_llm_model,
            device,
            dtype,
        )
        try:
            tokenizer = AutoTokenizer.from_pretrained(
                settings.local_llm_model,
                clean_up_tokenization_spaces=False,
            )
            model = AutoModelForCausalLM.from_pretrained(
                settings.local_llm_model,
                dtype=dtype,
                device_map="auto" if device == "cuda" else "cpu",
            )
        except Exception:
            logger.exception("Failed to load model %s", settings.local_llm_model)
            raise

        device_map = getattr(model, "hf_device_map", device)
        logger.info("LocalLLM loaded — device_map=%s", device_map)

        self._gen_cfg = GenerationConfig(
            max_new_tokens=settings.vllm_max_tokens,
            temperature=settings.vllm_temperature if settings.vllm_temperature > 0 else None,
            do_sample=settings.vllm_temperature > 0,
        )
        self._pipe = pipeline("text-generation", model=model, tokenizer=tokenizer)

    async def complete(self, prompt: str, system: str = "") -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        logger.debug("LocalLLMClient.complete — prompt_len=%d", len(prompt))
        try:
            output = self._pipe(
                messages,
                generation_config=self._gen_cfg,
                return_full_text=False,
            )
            answer = output[0]["generated_text"].strip()
            logger.debug("LocalLLMClient.complete — answer_len=%d", len(answer))
            return answer
        except Exception:
            logger.exception("LocalLLMClient.complete failed")
            raise

    async def __aenter__(self) -> LocalLLMClient:
        return self

    async def __aexit__(self, *_) -> None:
        pass

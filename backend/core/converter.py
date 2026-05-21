import logging

import torch
from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, VlmPipelineOptions
from docling.datamodel.pipeline_options_vlm_model import (
    InferenceFramework,
    InlineVlmOptions,
    ResponseFormat,
    TransformersModelType,
)
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.pipeline.vlm_pipeline import VlmPipeline

from core.config import Settings
from core.ocr import build_ocr_options

logger = logging.getLogger(__name__)

_QWEN25_VL_3B = InlineVlmOptions(
    repo_id="Qwen/Qwen2.5-VL-3B-Instruct",
    prompt="Convert this page to markdown. Do not miss any text and only output the bare markdown!",
    response_format=ResponseFormat.MARKDOWN,
    inference_framework=InferenceFramework.TRANSFORMERS,
    transformers_model_type=TransformersModelType.AUTOMODEL_IMAGETEXTTOTEXT,
    supported_devices=[AcceleratorDevice.CPU, AcceleratorDevice.CUDA],
    torch_dtype="bfloat16",
    load_in_8bit=False,
    scale=2.0,
    temperature=0.0,
    max_new_tokens=4096,
)


def _resolve_device(device: str) -> AcceleratorDevice:
    if device == "cuda":
        if not torch.cuda.is_available():
            logger.error("CUDA requested but no GPU detected — set DEVICE=cpu in .env")
            raise RuntimeError(
                "CUDA requested but no GPU detected. "
                "Set DEVICE=cpu in .env or install a CUDA-enabled PyTorch build."
            )
        logger.info("Accelerator: CUDA")
        return AcceleratorDevice.CUDA
    if device == "cpu":
        logger.info("Accelerator: CPU")
        return AcceleratorDevice.CPU
    # auto
    resolved = AcceleratorDevice.CUDA if torch.cuda.is_available() else AcceleratorDevice.CPU
    logger.info("Accelerator: auto → %s", resolved.value)
    return resolved


def _build_ocr_converter(settings: Settings) -> DocumentConverter:
    logger.info("Building OCR document converter (engine=%s)", settings.ocr_engine.value)
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True
    pipeline_options.ocr_options = build_ocr_options(settings)
    pipeline_options.accelerator_options = AcceleratorOptions(
        device=_resolve_device(settings.device)
    )
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=pipeline_options,
                backend=PyPdfiumDocumentBackend,
            ),
        }
    )


def _build_vlm_converter(settings: Settings) -> DocumentConverter:
    logger.info(
        "Building VLM document converter (model=%s 8bit=%s flash_attn2=%s)",
        _QWEN25_VL_3B.repo_id,
        settings.vlm_load_in_8bit,
        settings.vlm_flash_attention2,
    )
    vlm_opts = _QWEN25_VL_3B.model_copy(deep=True)
    vlm_opts.load_in_8bit = settings.vlm_load_in_8bit
    pipeline_options = VlmPipelineOptions(vlm_options=vlm_opts)
    pipeline_options.accelerator_options = AcceleratorOptions(
        device=_resolve_device(settings.device),
        cuda_use_flash_attention2=settings.vlm_flash_attention2,
    )
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=VlmPipeline,
                pipeline_options=pipeline_options,
                backend=PyPdfiumDocumentBackend,
            ),
        }
    )


def build_document_converter(settings: Settings) -> DocumentConverter:
    logger.info("Initialising document converter — use_vlm=%s", settings.use_vlm)
    if settings.use_vlm:
        return _build_vlm_converter(settings)
    return _build_ocr_converter(settings)

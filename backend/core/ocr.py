import logging

from docling.datamodel.pipeline_options import (
    EasyOcrOptions,
    RapidOcrOptions,
    TesseractCliOcrOptions,
    TesseractOcrOptions,
)

from core.config import OcrEngine, Settings

logger = logging.getLogger(__name__)

# ISO 639-1 → Tesseract language code
_TESSERACT_LANG = {"en": "eng", "pl": "pol", "de": "deu", "fr": "fra", "es": "spa"}


def _tesseract_langs(langs: list[str]) -> str:
    return "+".join(_TESSERACT_LANG.get(lang, lang) for lang in langs)


def build_ocr_options(settings: Settings):
    engine = settings.ocr_engine
    langs = settings.ocr_languages
    logger.info("Building OCR options — engine=%s langs=%s", engine.value, langs)

    match engine:
        case OcrEngine.EASYOCR:
            return EasyOcrOptions(lang=langs)
        case OcrEngine.TESSERACT:
            return TesseractOcrOptions(lang=_tesseract_langs(langs))
        case OcrEngine.TESSERACT_CLI:
            return TesseractCliOcrOptions(lang=_tesseract_langs(langs))
        case OcrEngine.RAPIDOCR:
            return RapidOcrOptions()
        case _:
            raise ValueError(f"Unsupported OCR engine: {engine}")

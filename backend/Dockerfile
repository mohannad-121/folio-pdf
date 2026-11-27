FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FOLIO_DATA_DIR=/data \
    DEBIAN_FRONTEND=noninteractive

# LibreOffice (Office <-> PDF), Tesseract (OCR), Ghostscript/qpdf (ocrmypdf),
# fonts, and WeasyPrint's native deps (HTML -> PDF).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-writer libreoffice-calc libreoffice-impress \
        tesseract-ocr tesseract-ocr-eng tesseract-ocr-ara tesseract-ocr-deu \
        tesseract-ocr-fra tesseract-ocr-spa tesseract-ocr-ita tesseract-ocr-por \
        tesseract-ocr-rus tesseract-ocr-chi-sim tesseract-ocr-jpn \
        ghostscript qpdf unpaper pngquant \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 libffi8 \
        fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk \
        libmagic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

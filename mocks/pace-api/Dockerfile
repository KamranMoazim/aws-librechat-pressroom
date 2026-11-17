FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.9.9 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY pace_api ./pace_api
USER nobody
EXPOSE 8200
CMD ["/app/.venv/bin/uvicorn", "pace_api.main:app", "--host", "0.0.0.0", "--port", "8200"]

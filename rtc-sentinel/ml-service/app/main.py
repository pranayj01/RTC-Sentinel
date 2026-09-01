from fastapi import FastAPI

app = FastAPI(title="RTC Sentinel ML Service", version="0.6.5")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}

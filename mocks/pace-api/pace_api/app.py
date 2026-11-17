import hmac
import os
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from pace_api.seed import STATUSES, build_data

SUMMARY_FIELDS = ("jobNumber", "customerName", "title", "status", "dueDate", "quantity", "restricted")


class JobUpdate(BaseModel):
    status: str | None = None
    dueDate: date | None = None
    note: str | None = Field(default=None, max_length=2000)
    author: str = Field(min_length=1, max_length=200)


def create_app(api_key: str | None = None, data: dict | None = None) -> FastAPI:
    key = api_key or os.environ.get("PACE_API_KEY", "")
    if not key:
        raise RuntimeError("PACE_API_KEY is not set")
    store = data or build_data()
    app = FastAPI(title="Pace mock", docs_url=None, redoc_url=None, openapi_url=None)

    def authorized(x_api_key: Annotated[str | None, Header()] = None) -> None:
        if not x_api_key or not hmac.compare_digest(x_api_key, key):
            raise HTTPException(status_code=401, detail="invalid api key")

    def job_or_404(number: str) -> dict:
        job = store["jobs"].get(number)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return job

    @app.get("/healthz")
    def health() -> dict:
        return {"ok": True, "jobs": len(store["jobs"])}

    @app.get("/jobs", dependencies=[Depends(authorized)])
    def search_jobs(
        q: str = "",
        status: str | None = None,
        customer: str | None = None,
        limit: Annotated[int, Query(ge=1, le=50)] = 20,
    ) -> dict:
        needle = q.lower()
        matches = [
            {field: job[field] for field in SUMMARY_FIELDS}
            for job in store["jobs"].values()
            if (not needle or needle in job["title"].lower() or needle in job["jobNumber"].lower())
            and (status is None or job["status"] == status)
            and (customer is None or customer.lower() in job["customerName"].lower())
        ]
        return {"count": len(matches), "jobs": matches[:limit]}

    @app.get("/jobs/{number}", dependencies=[Depends(authorized)])
    def get_job(number: str) -> dict:
        return job_or_404(number)

    @app.patch("/jobs/{number}", dependencies=[Depends(authorized)])
    def update_job(number: str, update: JobUpdate, if_match: Annotated[str | None, Header()] = None) -> dict:
        job = job_or_404(number)
        if if_match is None:
            raise HTTPException(status_code=428, detail="If-Match with the job version is required")
        if if_match != str(job["version"]):
            raise HTTPException(status_code=412, detail="job changed since it was read")
        if update.status is not None and update.status not in STATUSES:
            raise HTTPException(status_code=422, detail=f"unknown status {update.status}")
        if update.status is not None:
            job["status"] = update.status
        if update.dueDate is not None:
            job["dueDate"] = update.dueDate.isoformat()
        if update.note:
            job["notes"].append(
                {"at": datetime.now(timezone.utc).isoformat(), "author": update.author, "text": update.note}
            )
        job["version"] += 1
        return job

    @app.get("/estimates/{estimate_id}", dependencies=[Depends(authorized)])
    def get_estimate(estimate_id: str) -> dict:
        estimate = store["estimates"].get(estimate_id)
        if estimate is None:
            raise HTTPException(status_code=404, detail="estimate not found")
        return estimate

    @app.get("/customers/{customer_id}", dependencies=[Depends(authorized)])
    def get_customer(customer_id: str) -> dict:
        customer = store["customers"].get(customer_id)
        if customer is None:
            raise HTTPException(status_code=404, detail="customer not found")
        return customer

    @app.get("/statuses", dependencies=[Depends(authorized)])
    def statuses() -> dict:
        return {"statuses": STATUSES}

    return app

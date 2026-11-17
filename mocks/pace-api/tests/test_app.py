import pytest
from fastapi.testclient import TestClient

from pace_api.app import create_app
from pace_api.seed import build_data

KEY = {"X-Api-Key": "test-key"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(api_key="test-key", data=build_data()))


def test_seed_is_deterministic_with_200_jobs_and_some_restricted():
    first, second = build_data(), build_data()
    assert first == second
    assert len(first["jobs"]) == 200
    assert any(job["restricted"] for job in first["jobs"].values())
    assert all(job["quotedPrice"] > job["estimatedCost"] for job in first["jobs"].values())


def test_requires_api_key(client: TestClient):
    assert client.get("/jobs").status_code == 401
    assert client.get("/jobs", headers={"X-Api-Key": "wrong"}).status_code == 401
    assert client.get("/healthz").status_code == 200


def test_search_returns_summaries_without_cost_fields(client: TestClient):
    body = client.get("/jobs", params={"q": "banner", "limit": 5}, headers=KEY).json()
    assert 0 < len(body["jobs"]) <= 5
    assert all("estimatedCost" not in job and "marginPct" not in job for job in body["jobs"])


def test_get_job_and_estimate(client: TestClient):
    job = client.get("/jobs/J24000", headers=KEY).json()
    assert job["jobNumber"] == "J24000" and "estimatedCost" in job
    estimate = client.get(f"/estimates/{job['estimateId']}", headers=KEY).json()
    assert estimate["jobNumber"] == "J24000"
    assert client.get("/jobs/J99999", headers=KEY).status_code == 404


def test_update_needs_matching_version(client: TestClient):
    body = {"status": "printing", "author": "alice@example.com"}
    assert client.patch("/jobs/J24001", json=body, headers=KEY).status_code == 428
    assert client.patch("/jobs/J24001", json=body, headers={**KEY, "If-Match": "7"}).status_code == 412
    updated = client.patch("/jobs/J24001", json={**body, "note": "Proof approved"}, headers={**KEY, "If-Match": "1"})
    assert updated.status_code == 200
    job = updated.json()
    assert job["status"] == "printing" and job["version"] == 2
    assert job["notes"][-1]["author"] == "alice@example.com"
    stale = client.patch("/jobs/J24001", json=body, headers={**KEY, "If-Match": "1"})
    assert stale.status_code == 412


def test_update_rejects_unknown_status(client: TestClient):
    response = client.patch(
        "/jobs/J24002", json={"status": "teleported", "author": "a"}, headers={**KEY, "If-Match": "1"}
    )
    assert response.status_code == 422

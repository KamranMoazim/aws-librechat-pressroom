#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]
then
  echo "usage: $0 IMAGE:TAG...   prints IMAGE:TAG@sha256:... (multi-arch index digest)"
  exit 1
fi

for image in "$@"
do
  python3 -I - "$image" <<'PY'
import json, re, sys, urllib.error, urllib.parse, urllib.request

ACCEPT = ", ".join([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
])
image = sys.argv[1]
name, _, tag = image.rpartition(":")
if not name or "/" in tag:
    sys.exit(f"{image}: give an explicit tag")
first = name.split("/")[0]
if "." in first or ":" in first:
    registry, repository = first, name[len(first) + 1:]
else:
    registry, repository = "registry-1.docker.io", name if "/" in name else f"library/{name}"
url = f"https://{registry}/v2/{repository}/manifests/{tag}"

def head(headers):
    request = urllib.request.Request(url, method="HEAD", headers={"Accept": ACCEPT, **headers})
    return urllib.request.urlopen(request, timeout=20)

def fetch_digest():
    try:
        response = head({})
    except urllib.error.HTTPError as error:
        if error.code != 401:
            sys.exit(f"{image}: registry answered {error.code}")
        challenge = error.headers.get("WWW-Authenticate", "")
        fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
        query = urllib.parse.urlencode({key: fields[key] for key in ("service", "scope") if key in fields})
        with urllib.request.urlopen(f"{fields['realm']}?{query}", timeout=20) as token_response:
            body = json.load(token_response)
        response = head({"Authorization": f"Bearer {body.get('token') or body.get('access_token')}"})
    return response.headers.get("Docker-Content-Digest")

try:
    digest = fetch_digest()
except urllib.error.URLError as error:
    sys.exit(f"{image}: cannot reach {registry} ({error.reason})")
if not digest:
    sys.exit(f"{image}: no digest in the registry answer")
print(f"{image}@{digest}")
PY
done

#!/usr/bin/env python3

import requests
import os
import sys
import time
import json

APP_HOST = os.environ.get("STGY_APP_HOST", "localhost")
APP_PORT = int(os.environ.get("STGY_APP_PORT", 3200))
BASE_URL = f"http://{APP_HOST}:{APP_PORT}"

def test_root():
  res = requests.get(f"{BASE_URL}/health")
  assert res.status_code == 200
  assert res.json() == {"result": "ok"}
  res = requests.get(f"{BASE_URL}/metrics")
  assert res.status_code == 200
  assert "# HELP" in res.text

def test_maintenance():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  res = requests.get(f"{base_url}/maintenance")
  assert res.status_code == 200
  requests.post(f"{base_url}/maintenance")
  assert requests.get(f"{base_url}/maintenance").json()["enabled"] is True
  requests.delete(f"{base_url}/maintenance")
  assert requests.get(f"{base_url}/maintenance").json()["enabled"] is False

def test_posts():
  resource = "posts"
  doc_id = f"test-{int(time.time())}"
  base_url = f"{BASE_URL}/{resource}"
  target_ts = int(time.time())
  attrs_data = json.dumps({"tag": "python-test", "version": 1})
  put_payload = {
    "text": f"the quick brown fox jumps over the lazy dog {doc_id}",
    "timestamp": target_ts,
    "locale": "en",
    "attrs": attrs_data,
    "wait": 5
  }
  res = requests.put(f"{base_url}/{doc_id}", json=put_payload)
  assert res.status_code == 202
  requests.post(f"{base_url}/flush", json={"wait": 5})
  t_res = requests.get(f"{base_url}/tokenize", params={"text": put_payload["text"], "locale": "en"})
  assert t_res.status_code == 200
  expected_tokens = sorted(list(set(t_res.json())))
  res = requests.get(f"{base_url}/search", params={"query": doc_id, "locale": "en"})
  assert res.status_code == 200
  assert doc_id in res.json()
  res = requests.get(f"{base_url}/{doc_id}")
  assert res.status_code == 200
  doc = res.json()
  assert doc["id"] == doc_id
  actual_tokens = sorted(list(set(doc["bodyText"].split())))
  assert actual_tokens == expected_tokens
  assert doc["attrs"] == attrs_data
  res = requests.get(f"{base_url}/search-fetch", params={"query": doc_id, "locale": "en"})
  assert len(res.json()) > 0
  assert res.json()[0]["id"] == doc_id
  res = requests.get(f"{base_url}/{doc_id}", params={"omitBodyText": "true"})
  assert res.json()["bodyText"] is None
  res = requests.get(f"{base_url}/{doc_id}", params={"omitAttrs": "true"})
  assert res.json()["attrs"] is None
  res = requests.delete(f"{base_url}/{doc_id}", json={"timestamp": target_ts, "wait": 5})
  assert res.status_code == 202
  requests.post(f"{base_url}/flush", json={"wait": 5})
  res = requests.get(f"{base_url}/search", params={"query": doc_id, "locale": "en"})
  assert doc_id not in res.json()

def test_tokenize():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  text = "Hello Search World"
  res = requests.get(f"{base_url}/tokenize", params={"text": text, "locale": "en"})
  assert res.status_code == 200
  tokens = res.json()
  assert "hello" in tokens

def test_reservation():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  requests.post(f"{base_url}/maintenance")

  target_ts = int(time.time())
  reserve_payload = {
    "documents": [
        {"id": "res-1", "timestamp": target_ts},
        {"id": "res-2", "timestamp": target_ts}
    ],
    "wait": 5
  }
  res = requests.post(f"{base_url}/reserve", json=reserve_payload)
  assert res.status_code == 200
  result = res.json()
  assert result["result"] == "enqueued"
  assert result["count"] == 2

  requests.delete(f"{base_url}/maintenance")

def test_reconstruction():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  ts = int(time.time())
  requests.put(f"{base_url}/rec-1", json={"text": "rebuild test", "timestamp": ts, "wait": 5})
  requests.post(f"{base_url}/flush", json={"wait": 5})
  rec_payload = {
    "timestamp": ts,
    "newInitialId": 10000000,
    "wait": 10
  }
  res = requests.post(f"{base_url}/reconstruct", json=rec_payload)
  assert res.status_code == 200

def test_shards():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  past_ts = 1700000000
  requests.put(f"{base_url}/shard-doc", json={"text": "shard test", "timestamp": past_ts, "wait": 5})
  requests.post(f"{base_url}/flush", json={"wait": 5})
  res = requests.get(f"{base_url}/shards", params={"detailed": "true"})
  shards = res.json()
  assert len(shards) > 0
  target_shard = next((s for s in shards if s["startTimestamp"] <= past_ts < s["endTimestamp"]), None)
  assert target_shard is not None
  bucket_ts = target_shard["startTimestamp"]
  res = requests.delete(f"{base_url}/shards/{bucket_ts}", params={"wait": 5})
  assert res.status_code == 200

def test_optimize():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  ts = int(time.time())
  res = requests.post(f"{base_url}/optimize", json={"timestamp": ts, "wait": 5})
  assert res.status_code == 200

def main():
  test_funcs = {name: fn for name, fn in globals().items() if name.startswith("test_") and callable(fn)}
  if len(sys.argv) < 2:
    for name in sorted(test_funcs.keys()):
      print(f"[run] {name}")
      test_funcs[name]()
  else:
    for scenario in sys.argv[1:]:
      func_name = scenario if scenario.startswith("test_") else f"test_{scenario}"
      if func_name in test_funcs:
        print(f"[run] {func_name}")
        test_funcs[func_name]()
      else:
        print(f"Unknown scenario: {scenario}")
        sys.exit(1)

if __name__ == "__main__":
  main()

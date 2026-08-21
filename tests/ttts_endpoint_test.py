#!/usr/bin/env python3

import requests
import os
import sys
import time
import json

BASE_URL = os.environ.get("STGY_SEARCH_API_BASE_URL", "http://localhost:3200");

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
    "labels": ["Owner:ABC", "project:foo bar"],
    "numericValue": target_ts * 1000,
    "wait": 5
  }
  incomplete_id = f"{doc_id}-incomplete"
  res = requests.put(
    f"{base_url}/{incomplete_id}",
    json={"text": "incomplete snapshot", "timestamp": target_ts},
  )
  assert res.status_code == 400

  res = requests.put(f"{base_url}/{doc_id}", json=put_payload)
  assert res.status_code in (200, 408)
  res = requests.post(f"{base_url}/flush", json={"wait": 5})
  assert res.status_code == 200
  t_res = requests.get(f"{base_url}/tokenize", params={"text": put_payload["text"], "locale": "en"})
  assert t_res.status_code == 200
  expected_tokens = sorted(list(set(t_res.json())))
  res = requests.get(f"{base_url}/search", params={"query": doc_id, "locale": "en"})
  assert res.status_code == 200
  search_result = res.json()
  assert set(search_result.keys()) == {"tokens", "result"}, search_result
  assert search_result["tokens"] == requests.get(
    f"{base_url}/tokenize", params={"text": doc_id, "locale": "en"}
  ).json()
  assert doc_id in search_result["result"]
  res = requests.get(
    f"{base_url}/search",
    params=[
      ("query", doc_id),
      ("locale", "en"),
      ("label", "Owner:ABC"),
      ("label", "project:foo bar"),
      ("numericOp", "lte"),
      ("numericValue", str(target_ts * 1000)),
    ],
  )
  assert res.status_code == 200
  assert doc_id in res.json()["result"]
  res = requests.get(
    f"{base_url}/search",
    params={"query": doc_id, "locale": "en", "label": "Owner:abc"},
  )
  assert res.status_code == 200
  assert doc_id in res.json()["result"]
  res = requests.get(f"{base_url}/{doc_id}")
  assert res.status_code == 200
  doc = res.json()
  assert doc["id"] == doc_id
  assert "\n" not in doc["bodyText"]
  actual_tokens = sorted(list(set(doc["bodyText"].split())))
  assert actual_tokens == expected_tokens
  assert doc["attrs"] == attrs_data
  assert doc["labels"] == ["Owner:ABC", "project:foo bar"]
  assert doc["numericValue"] == target_ts * 1000
  res = requests.get(f"{base_url}/search-fetch", params={"query": doc_id, "locale": "en"})
  assert res.status_code == 200, res.text
  search_fetch_result = res.json()
  assert set(search_fetch_result.keys()) == {"tokens", "result"}, search_fetch_result
  assert search_fetch_result["tokens"] == search_result["tokens"]
  assert len(search_fetch_result["result"]) > 0
  assert search_fetch_result["result"][0]["id"] == doc_id
  res = requests.get(f"{base_url}/{doc_id}", params={"omitBodyText": "true"})
  assert res.json()["bodyText"] is None
  res = requests.get(f"{base_url}/{doc_id}", params={"omitAttrs": "true"})
  assert res.json()["attrs"] is None
  res = requests.delete(
    f"{base_url}/{doc_id}",
    json={"timestamp": target_ts, "wait": 5}
  )
  assert res.status_code in (200, 408)
  res = requests.post(f"{base_url}/flush", json={"wait": 5})
  assert res.status_code == 200
  res = requests.get(f"{base_url}/search", params={"query": doc_id, "locale": "en"})
  deleted_search_result = res.json()
  assert deleted_search_result["tokens"] == search_result["tokens"]
  assert doc_id not in deleted_search_result["result"]
  res = requests.get(f"{base_url}/search-fetch", params={"query": doc_id, "locale": "en"})
  assert res.status_code == 200, res.text
  deleted_search_fetch_result = res.json()
  assert deleted_search_fetch_result == {"tokens": search_result["tokens"], "result": []}

def test_tokenize():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  text = "Hello Search World"
  res = requests.get(f"{base_url}/tokenize", params={"text": text, "locale": "en"})
  assert res.status_code == 200
  tokens = res.json()
  assert "hello" in tokens

  text = "ポール・ド・ヴィヴィ"
  res = requests.get(f"{base_url}/tokenize", params={"text": text, "locale": "ja"})
  assert res.status_code == 200
  assert res.json() == ["ポール", "ド", "ヴィヴィ"]

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
  assert result["result"] == "completed"
  assert result["count"] == 2

  requests.delete(f"{base_url}/maintenance")

def test_reconstruction():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  ts = int(time.time())
  requests.put(f"{base_url}/rec-1", json={"text": "rebuild test", "timestamp": ts, "attrs": None, "labels": [], "numericValue": None, "wait": 5})
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
  requests.put(f"{base_url}/shard-doc", json={"text": "shard test", "timestamp": past_ts, "attrs": None, "labels": [], "numericValue": None, "wait": 5})
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

def test_queue_clear():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  requests.post(f"{base_url}/maintenance")
  ts = int(time.time())
  requests.put(f"{base_url}/q-clear-1", json={"text": "queue clear test", "timestamp": ts, "attrs": None, "labels": [], "numericValue": None})
  res = requests.delete(f"{base_url}/queue")
  assert res.status_code == 200
  assert res.json()["result"] == "queue cleared"
  requests.delete(f"{base_url}/maintenance")

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

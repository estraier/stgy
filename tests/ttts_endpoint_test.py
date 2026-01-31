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
  url = f"{BASE_URL}/health"
  res = requests.get(url)
  assert res.status_code == 200, res.text
  assert res.json() == {"result": "ok"}
  print(f"[root] health OK")
  res = requests.get(f"{BASE_URL}/metrics")
  assert res.status_code == 200, res.text
  assert "# HELP" in res.text
  print("[root] get metrics OK")
  print("[test_root] OK")

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
    "attrs": attrs_data
  }

  res = requests.put(f"{base_url}/{doc_id}", json=put_payload)
  assert res.status_code == 202, res.text
  print(f"[posts] put doc accepted: {doc_id}")

  t_res = requests.get(f"{base_url}/tokenize", params={"text": put_payload["text"], "locale": "en"})
  assert t_res.status_code == 200
  expected_tokens = sorted(list(set(t_res.json())))

  found = False
  for i in range(20):
    time.sleep(1)
    requests.post(f"{base_url}/flush")

    res = requests.get(f"{base_url}/search", params={"query": doc_id, "locale": "en"})
    assert res.status_code == 200, res.text
    results = res.json()

    if i % 5 == 0:
      print(f"[posts] wait={i+1} results_count={len(results)}")

    if doc_id in results:
      found = True
      break

  assert found, f"doc {doc_id} not found within 20s. Check UpdateWorker logs."
  print("[posts] search doc OK")

  res = requests.get(f"{base_url}/{doc_id}")
  assert res.status_code == 200, f"Failed to fetch doc: {res.text}"
  doc = res.json()
  assert doc["id"] == doc_id

  actual_tokens = sorted(doc["bodyText"].split())
  assert actual_tokens == expected_tokens

  assert doc["attrs"] == attrs_data
  print(f"[posts] fetch single doc OK (attrs verified)")

  res = requests.get(f"{base_url}/search-fetch", params={"query": doc_id, "locale": "en"})
  assert res.status_code == 200, res.text
  docs = res.json()
  assert len(docs) > 0
  assert docs[0]["id"] == doc_id
  assert docs[0]["attrs"] == attrs_data
  print(f"[posts] search-fetch OK")

  res = requests.get(f"{base_url}/{doc_id}", params={"omitBodyText": "true"})
  doc_omit = res.json()
  assert doc_omit["bodyText"] is None
  assert doc_omit["attrs"] == attrs_data
  print(f"[posts] fetch with omitBodyText OK")

  res = requests.get(f"{base_url}/{doc_id}", params={"omitAttrs": "true"})
  doc_omit = res.json()

  actual_tokens_omit = sorted(doc_omit["bodyText"].split())
  assert actual_tokens_omit == expected_tokens

  assert doc_omit["attrs"] is None
  print(f"[posts] fetch with omitAttrs OK")

  del_payload = {"timestamp": target_ts}
  res = requests.delete(f"{base_url}/{doc_id}", json=del_payload)
  assert res.status_code == 202, res.text
  print(f"[posts] delete doc accepted")
  print("[test_posts] OK")

def test_tokenize():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  text = "Hello Search World"
  res = requests.get(f"{base_url}/tokenize", params={"text": text, "locale": "en"})
  assert res.status_code == 200, res.text
  tokens = res.json()
  assert isinstance(tokens, list)
  assert "hello" in tokens
  assert "world" in tokens
  print(f"[tokenize] tokens: {tokens}")
  print("[test_tokenize] OK")

def test_reservation():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  res = requests.get(f"{base_url}/reservation-mode")
  assert res.status_code == 200
  assert res.json()["enabled"] is False
  res = requests.put(f"{base_url}/reservation-mode")
  assert res.status_code == 200
  assert res.json()["enabled"] is True
  print("[reservation] enabled mode")
  reserve_payload = [{"id": "res-1", "timestamp": int(time.time())}]
  res = requests.post(f"{base_url}/reserve", json=reserve_payload)
  assert res.status_code == 200
  assert res.json()["result"] == "reserved"
  print("[reservation] IDs reserved")
  res = requests.delete(f"{base_url}/reservation-mode")
  assert res.status_code == 200
  assert res.json()["enabled"] is False
  print("[reservation] disabled mode")
  print("[test_reservation] OK")

def test_shards():
  resource = "posts"
  base_url = f"{BASE_URL}/{resource}"
  past_ts = 100
  shard_test_id = "shard-test-doc"
  requests.put(f"{base_url}/{shard_test_id}", json={"text": "test", "timestamp": past_ts})
  found_shard = None
  for i in range(20):
    time.sleep(1)
    requests.post(f"{base_url}/flush")
    res = requests.get(f"{base_url}/shards", params={"detailed": "true"})
    assert res.status_code == 200
    shards = res.json()
    target = next((s for s in shards if s["startTimestamp"] == 0), None)
    if target:
      found_shard = target
      break
  assert found_shard is not None, "Shard for timestamp 0 not found within 20s"
  print(f"[shards] found target shard: {found_shard['filename']}")
  res = requests.delete(f"{base_url}/shards/{past_ts}")
  assert res.status_code == 200
  print(f"[shards] deleted shard for timestamp {past_ts}")
  res = requests.get(f"{base_url}/shards")
  shards = res.json()
  target = next((s for s in shards if s["startTimestamp"] == 0), None)
  assert target is None, "Shard should be deleted"
  print("[test_shards] OK")

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
        test_funcs[func_name]()
      else:
        print(f"Unknown scenario: {scenario}")
        sys.exit(1)

if __name__ == "__main__":
  main()

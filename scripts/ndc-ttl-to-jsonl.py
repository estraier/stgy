#! /usr/bin/python3
# Get "ndc9.ttl" from https://www.jla.or.jp/committees/bunrui/ndc-data/ .
# Then, run this script to make "ndc.jsonl" .

import json
from rdflib import Graph, Namespace

def convert_ndc_ttl_to_clean_jsonl(input_file, output_file):
  g = Graph()
  print(f"Loading {input_file}...")
  g.parse(input_file, format="turtle")
  SKOS = Namespace("http://www.w3.org/2004/02/skos/core#")
  RDFS = Namespace("http://www.w3.org/2000/01/rdf-schema#")
  NDCV = Namespace("http://jla.or.jp/vocab/ndcvocab#")
  XL = Namespace("http://www.w3.org/2008/05/skos-xl#")
  concept_list = []
  for subject, _, notation in g.triples((None, SKOS.notation, None)):
    obj = {"id": str(notation)}
    label = g.value(subject, RDFS.label)
    if label and str(label).strip():
      obj["label"] = str(label)
    locales = {}
    for pref_label in g.objects(subject, SKOS.prefLabel):
      val = str(pref_label).strip()
      if val:
        if pref_label.language == 'ja':
          locales["ja"] = val
        elif pref_label.language == 'en':
          locales["en"] = val
    if locales:
      obj["locales"] = locales
    terms = []
    for prop in [NDCV.indexedTerm, NDCV.structuredLabel]:
      for bnode in g.objects(subject, prop):
        for literal in g.objects(bnode, XL.literalForm):
          val = str(literal).strip()
          if val:
            terms.append(val)
    if terms:
      unique_terms = list(dict.fromkeys(terms))
      obj["terms"] = unique_terms
    concept_list.append(obj)
  concept_list.sort(key=lambda x: x["id"])
  with open(output_file, "w", encoding="utf-8") as f:
    for item in concept_list:
      f.write(json.dumps(item, ensure_ascii=False) + "\n")
  print(f"Conversion complete: {output_file}")

convert_ndc_ttl_to_clean_jsonl("ndc9.ttl", "ndc.jsonl")

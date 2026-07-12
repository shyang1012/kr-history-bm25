"""
@Project: kr-history-bm25
@File: embed_bge_gpu.py
@Description: bge-m3(q8 ONNX)를 Radeon GPU(DirectML)로 실행해 sg/sy passage 원문·직역 벡터를 생성하고,
              Node 하니스 캐시 포맷(tmp/embed-bgem3-{han,ko}.f32 + .meta.json)으로 저장한다.
              빌드 시점 GPU ingest 경로(전 코퍼스 확장 시 재사용). CLS 풀링 + L2 정규화, 프리픽스 없음.
              실행: .venv/Scripts/python.exe scripts/embed_bge_gpu.py
@Author: shyang
@LastModified: 2026-07-12
"""

import json
import sqlite3
import time

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

CACHE = "node_modules/@huggingface/transformers/.cache/Xenova/bge-m3"
MODEL = f"{CACHE}/onnx/model_fp16.onnx"  # DirectML 실 GPU(fp16). q8은 DML 미지원→CPU 폴백
TOK = f"{CACHE}/tokenizer.json"
DB = "data/history.sqlite"
DIM = 1024
TEXT_CAP = 512  # Node 하니스와 동일(긴 passage attention 방어)
MAXLEN = 512
BATCH = 16

tok = Tokenizer.from_file(TOK)
tok.enable_truncation(max_length=MAXLEN)
# 고정 길이 패딩 — DirectML 동적 shape 재컴파일 오류 방어(모든 배치 [B,512] 상수 shape)
tok.enable_padding(pad_id=1, pad_token="<pad>", length=MAXLEN)

sess = ort.InferenceSession(MODEL, providers=["DmlExecutionProvider", "CPUExecutionProvider"])
print("providers:", sess.get_providers())


def embed(texts):
    texts = [t[:TEXT_CAP] for t in texts]
    encs = tok.encode_batch(texts)
    ids = np.array([e.ids for e in encs], dtype=np.int64)
    mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
    out = sess.run(None, {"input_ids": ids, "attention_mask": mask})[0]  # [B, L, 1024]
    cls = out[:, 0, :].astype(np.float32)  # CLS(<s>) 토큰 = dense 임베딩(fp16→fp32)
    n = np.linalg.norm(cls, axis=1, keepdims=True)
    n[n == 0] = 1
    return (cls / n).astype("<f4")


def embed_all(texts, label):
    out = np.zeros((len(texts), DIM), dtype="<f4")
    t0 = time.time()
    for i in range(0, len(texts), BATCH):
        out[i : i + BATCH] = embed(texts[i : i + BATCH])
        if i % (BATCH * 8) == 0:
            print(f"  [{label}] {min(i + BATCH, len(texts))}/{len(texts)} ({time.time() - t0:.0f}s)")
    return out


def write_cache(kind, vecs, ids):
    vecs.reshape(-1).astype("<f4").tofile(f"tmp/embed-bgem3-{kind}.f32")
    meta = {"model": "Xenova/bge-m3", "dim": DIM, "count": len(ids), "first": ids[0], "last": ids[-1]}
    with open(f"tmp/embed-bgem3-{kind}.meta.json", "w") as f:
        json.dump(meta, f)
    print(f"  wrote tmp/embed-bgem3-{kind}.f32 ({len(ids)}x{DIM})")


con = sqlite3.connect(DB)
rows = con.execute(
    """
    SELECT p.id, p.text_han, t.text FROM passage p
    JOIN node n ON n.id = p.node_id
    JOIN corpus c ON c.id = n.corpus_id
    JOIN translation t ON t.passage_id = p.id AND t.adopted = 1
    WHERE c.code IN ('sg','sy') ORDER BY p.id"""
).fetchall()
ids = [int(r[0]) for r in rows]
han = [r[1] or "" for r in rows]
ko = [r[2] or "" for r in rows]
print(f"passages={len(ids)}")

write_cache("han", embed_all(han, "han"), ids)
write_cache("ko", embed_all(ko, "ko"), ids)
print("done")

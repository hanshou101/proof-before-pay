# -*- coding: utf-8 -*-
"""Narration for the demo video: Kokoro-82M (Apache-2.0) through kokoro-onnx, run locally.

Each line of docs/video/narration.json is split into sentences; every sentence is synthesised on
its own and joined with a short pause, so the start of each sentence is known exactly. The editor
syncs highlights to those sentence starts (and to character offsets inside a sentence).

Usage (Python 3.12 via uv, no global install):
  uv run --python 3.12 --with kokoro-onnx==0.4.9 --with soundfile==0.13.1 \
      python -I scripts/video/tts.py docs/video/narration.json proof/video/narration
Model files (not in Git; ~350 MB): KOKORO_DIR (default ~/.cache/kokoro-onnx) must contain
kokoro-v1.0.onnx and voices-v1.0.bin from
https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
Writes <out>/<id>.wav (24 kHz mono) and <out>/timing.json.
"""
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

PAUSE_S = 0.25


def sentences(text):
    # Split after . ? ! when followed by a space and a capital or a quote; keep the punctuation.
    parts = re.split(r'(?<=[.?!])\s+(?=["A-Z])', text.strip())
    return [p for p in parts if p]


def main():
    script_path, out_dir = sys.argv[1], sys.argv[2]
    spec = json.load(open(script_path, encoding="utf-8"))
    model_dir = os.path.expanduser(os.environ.get("KOKORO_DIR", "~/.cache/kokoro-onnx"))
    kokoro = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
    os.makedirs(out_dir, exist_ok=True)
    timing = {"voice": spec["voice"], "speed": spec["speed"], "sampleRate": None, "lines": {}}
    for line in spec["lines"]:
        chunks = []
        cursor = 0.0
        audio = []
        for index, sentence in enumerate(sentences(line["text"])):
            samples, rate = kokoro.create(sentence, voice=spec["voice"], speed=spec["speed"], lang="en-us")
            timing["sampleRate"] = rate
            # Trim the model's leading/trailing near-silence so pauses are ours, not random.
            loud = np.where(np.abs(samples) > 0.01)[0]
            if loud.size:
                samples = samples[max(loud[0] - int(0.03 * rate), 0): loud[-1] + int(0.08 * rate)]
            if index > 0:
                audio.append(np.zeros(int(PAUSE_S * rate), dtype=np.float32))
                cursor += PAUSE_S
            start = cursor
            audio.append(samples.astype(np.float32))
            cursor += len(samples) / rate
            chunks.append({"text": sentence, "start": round(start, 3), "end": round(cursor, 3)})
        wav = np.concatenate(audio)
        sf.write(os.path.join(out_dir, f"{line['id']}.wav"), wav, timing["sampleRate"])
        timing["lines"][line["id"]] = {"duration": round(cursor, 3), "sentences": chunks, "text": line["text"]}
        print(f"{line['id']}: {cursor:5.2f}s · {len(chunks)} sentences", flush=True)
    json.dump(timing, open(os.path.join(out_dir, "timing.json"), "w", encoding="utf-8"), indent=1)
    total = sum(v["duration"] for v in timing["lines"].values())
    print(f"total narration {total:.1f}s")


if __name__ == "__main__":
    main()

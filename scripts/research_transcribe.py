"""Offline ASR worker. Media and models are explicitly selected local files."""
import argparse
import json
import math
import os
from pathlib import Path
import socket
import subprocess
import sys

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["PYANNOTE_METRICS_ENABLED"] = "0"
# Some optional backends still consult their package-level HTTP client.
# This worker has no network operation, even if a configured model is incomplete.
def offline(*_args, **_kwargs):
    raise OSError("Network is disabled in the ARES transcription worker")
socket.socket.connect = offline
socket.socket.connect_ex = offline

def send(kind, **details):
    print(json.dumps({"kind": kind, **details}, ensure_ascii=False, allow_nan=False), flush=True)

def milliseconds(value):
    return round(float(value) * 1000) if value is not None and math.isfinite(float(value)) else None

def package_segment(segment):
    return {
        "start": milliseconds(segment.start),
        "end": milliseconds(segment.end),
        "text": segment.text.strip(),
        "words": [
            {"start": milliseconds(word.start), "end": milliseconds(word.end), "text": word.word.strip()}
            for word in (segment.words or []) if word.word.strip()
        ],
        "uncertain": segment.avg_logprob is not None and segment.avg_logprob < -1.0,
    }

def decode(args, start, length):
    import numpy
    result = subprocess.run([
        args.ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-ss", str(start), "-f", args.demux, "-i", args.media, "-t", str(length),
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=max(40, int(length)), check=True,
       creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    return numpy.frombuffer(result.stdout, dtype="<f4")

def align_and_label(args, segments, language):
    from whisperx.alignment import align, load_align_model
    loaded_audio = decode(args, 0, args.duration)
    transcript = [
        {"start": row["start"] / 1000, "end": row["end"] / 1000, "text": row["text"]}
        for row in segments
    ]
    model, metadata = load_align_model(language, args.device, model_name=args.align, model_cache_only=True)
    aligned = align(transcript, model, metadata, loaded_audio, args.device, return_char_alignments=False)
    if args.diarization:
        from whisperx.diarize import DiarizationPipeline, assign_word_speakers
        pipeline = DiarizationPipeline(model_name=args.diarization, token=None, device=args.device)
        aligned = assign_word_speakers(pipeline(loaded_audio), aligned)
    return [
        {
            "start": milliseconds(row.get("start")),
            "end": milliseconds(row.get("end")),
            "text": row["text"].strip(),
            "speaker": row.get("speaker", ""),
            "words": [
                {"start": milliseconds(word.get("start")), "end": milliseconds(word.get("end")), "text": word["word"]}
                for word in row.get("words", [])
            ],
        }
        for row in aligned["segments"]
        if row.get("start") is not None and row.get("end") is not None and row.get("text", "").strip()
    ]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--demux", required=True, choices=("wav", "mp3", "flac", "ogg", "mov", "matroska"))
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--language")
    parser.add_argument("--resume")
    parser.add_argument("--align")
    parser.add_argument("--diarization")
    args = parser.parse_args()
    model_dir = Path(args.model)
    if not model_dir.is_absolute() or not all((model_dir / name).is_file() for name in ("config.json", "model.bin", "tokenizer.json")):
        send("error", code="model-incomplete")
        return 2
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        send("error", code="engine-unavailable")
        return 2
    if args.align:
        if not Path(args.align).is_absolute() or not Path(args.align).is_dir():
            send("error", code="alignment-model-incomplete")
            return 2
        # Only accept an explicit local pipeline config. Offline mode also
        # applies to referenced weights and any gated pyannote dependencies.
        if args.diarization and not (Path(args.diarization).is_absolute() and Path(args.diarization).is_file()):
            send("error", code="diarization-model-incomplete")
            return 2
    previous = json.loads(Path(args.resume).read_text(encoding="utf-8")) if args.resume else {}
    segments = previous.get("segments", [])
    offset = segments[-1]["end"] if segments else 0
    model = WhisperModel(str(model_dir), device=args.device, local_files_only=True,
                         compute_type="int8" if args.device == "cpu" else "float16",
                         cpu_threads=4, num_workers=1)
    language = args.language or previous.get("language")
    if not math.isfinite(args.duration) or not 0 < args.duration <= 10800:
        raise ValueError("Invalid duration")
    duration = milliseconds(args.duration)
    send("info", language=language, duration=duration)
    chunk_ms, overlap = 300000, 2000
    start = offset
    while start < duration:
        end = min(start + chunk_ms, duration)
        left = max(0, start - overlap)
        right = min(duration, end + overlap)
        audio = decode(args, left / 1000, (right - left) / 1000)
        if audio.size:
            result, info = model.transcribe(audio, language=language, beam_size=3, vad_filter=False,
                                           word_timestamps=True, condition_on_previous_text=False)
            if not language:
                language = info.language
                send("info", language=language, duration=duration)
            for segment in result:
                row = package_segment(segment)
                row["start"] += left
                row["end"] = min(duration, row["end"] + left)
                for word in row["words"]:
                    if word["start"] is not None:
                        word["start"] += left
                    if word["end"] is not None:
                        word["end"] = min(duration, word["end"] + left)
                middle = (row["start"] + row["end"]) / 2
                if row["text"] and start <= middle < end and row["end"] > offset and row["end"] > row["start"]:
                    segments.append(row)
                    send("segment", **row)
        send("progress", position=end)
        start = end
    if args.align and segments:
        send("aligning")
        for row in align_and_label(args, segments, language):
            send("aligned-segment", **row)
    send("done", aligned=bool(args.align and segments), duration=duration)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except ModuleNotFoundError:
        send("error", code="optional-engine-unavailable")
        sys.exit(3)
    except Exception as error:
        send("error", code="processing-error", engineError=type(error).__name__)
        sys.exit(4)

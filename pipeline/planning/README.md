# Planning Pipeline (Local + Colab)

This package migrates planning out of a single notebook into reusable modules:

- Local machine:
  - metadata extraction (`ffprobe`)
  - optional Whisper transcription
  - optional frame sampling for frame-array requests
  - post-Colab plan validation and local rendering
- Colab:
  - Qwen Pass 1 timeline understanding
  - Qwen Pass 2 edit plan generation
  - final plan assembly

## Structure

- `shared/`
  - shared prompt builders and normalization helpers extracted from notebook logic
- `local/`
  - local preprocessing and local-to-colab orchestration script
- `colab_api/`
  - FastAPI app and Qwen engine used inside Colab

## Colab setup (step-by-step)

Use a single Colab notebook with GPU runtime.

### 1) Clone/mount repo in Colab

```python
from google.colab import drive
drive.mount("/content/drive")
%cd /content
!git clone <your-repo-url> ai-edits
%cd /content/ai-edits
```

If you already keep the repo in Drive, just `%cd` into it.

### 2) Install dependencies

```bash
pip install -r pipeline/planning/requirements.txt
pip install -U "transformers>=4.53.0" accelerate sentencepiece qwen-vl-utils[decord]
```

### 3) (Optional but common) set HF auth

```python
import os
os.environ["HF_TOKEN"] = "your_hf_token"
```

### 4) Align model path with your existing notebook cache

The server now defaults to the same notebook cache path:
- `QWEN_MODEL_NAME=Qwen/Qwen3-VL-8B-Instruct`
- `QWEN_CACHE_DIR=/content/drive/MyDrive/hf_models`

Set explicitly if you want:

```python
import os
os.environ["QWEN_MODEL_NAME"] = "Qwen/Qwen3-VL-8B-Instruct"
os.environ["QWEN_CACHE_DIR"] = "/content/drive/MyDrive/hf_models"
```

### 5) Start FastAPI server

```bash
uvicorn pipeline.planning.colab_api.app:app --host 0.0.0.0 --port 8000
```

You should now have:
- `GET /health`
- `GET /model-status`
- `POST /warmup`
- `POST /jobs/plan`
- `GET /jobs/{job_id}`

### 6) Expose Colab server

Use one tunnel option:

```bash
# Option A: cloudflared (quick)
cloudflared tunnel --url http://127.0.0.1:8000
```

or

```bash
# Option B: ngrok
ngrok http 8000
```

Copy the HTTPS URL and use it as `--colab-url` locally.

### 7) Verify model cache and server

From local terminal:

```bash
curl -s https://your-colab-endpoint/health
curl -s https://your-colab-endpoint/model-status
curl -s -X POST https://your-colab-endpoint/warmup
```

`/model-status` returns whether model weights already exist in cache.  
If `exists=false`, call `/warmup` once so model download/load happens before first job submission.

### 8) Submit and poll a job (timeout-safe path)

Submit:

```bash
curl -s -X POST https://your-colab-endpoint/jobs/plan \
  -H "Content-Type: application/json" \
  -d @request.json
```

Poll:

```bash
curl -s https://your-colab-endpoint/jobs/<job_id>
```

Job statuses:
- `queued`
- `running`
- `completed` (contains `result`)
- `failed` (contains `error`)

## Run local orchestration

### Mode A: baseline video path (recommended first)

In this mode, Colab reads the video file path directly. Pass a path that exists in Colab.

```bash
python -m pipeline.planning.local.run_local_to_colab \
  --video /local/path/video.mp4 \
  --colab-url https://your-colab-endpoint \
  --colab-video-path /content/drive/MyDrive/test_videos/video.mp4 \
  --prompt "remove filler and keep it engaging" \
  --run-whisper \
  --output-plan edit_plans/generated_from_colab.json \
  --render-out output_videos/rendered_from_colab.mp4
```

### Mode B: frame-array transport (cookbook-style list input)

In this mode, local backend samples frames and sends them to Colab as base64 JPEGs. Colab decodes and passes them to Qwen as frame list input with `sample_fps`.

```bash
python -m pipeline.planning.local.run_local_to_colab \
  --video /local/path/video.mp4 \
  --colab-url https://your-colab-endpoint \
  --prompt "remove filler and keep it engaging" \
  --run-whisper \
  --use-frame-array \
  --sample-fps 2 \
  --max-frames 120 \
  --output-plan edit_plans/generated_from_colab_frames.json \
  --render-out output_videos/rendered_from_colab_frames.mp4
```

This follows Qwen cookbook behavior:
- full video path mode for automatic sampling, and
- frame-list mode where `sample_fps` describes temporal density of provided frames.

## Pass 1 and Pass 2 outputs from server

Completed job `result` returns both raw model outputs for debugging:
- `pass1_raw_response` (direct text from timeline pass)
- `timeline_events` (validated parsed events)
- `pass2_raw_response` (direct text from edit-plan pass)
- `model_plan_raw` (parsed pass 2 JSON before final assembly)
- `final_edit_plan`

This is useful for quickly seeing what Pass 1 generated versus what was accepted by validation.

## Tunnel + timeout troubleshooting

- Running `uvicorn` and `cloudflared` in parallel is valid.
- `524` from Cloudflare usually means a request took too long.
- Call `POST /warmup` before first inference request.
- Use `POST /jobs/plan` + `GET /jobs/{job_id}` to avoid long-held HTTP connections.
- In video-path mode, server returns explicit `400` if Colab cannot find `--colab-video-path`.

## In-memory job caveat

- Job data is stored in process memory only.
- Restarting Colab runtime or uvicorn clears all queued/running/completed jobs.

## Video path behavior (important)

- **Baseline `video_path` mode**: the path must exist on **Colab** (`--colab-video-path`).  
  Local path can be different.
- **Frame-array mode (`--use-frame-array`)**: video needs to exist on **local** machine only; frames are sent over HTTP.
- In current local script, `--video` is always required locally because local preprocess (Whisper/frame sampling/render source) uses it.

## What was implemented for steps 1-4

1. **Refactor notebook logic into shared modules**  
   Shared helpers now live in `pipeline/planning/shared/`.
2. **Stand up minimal Colab FastAPI endpoint**  
   `pipeline/planning/colab_api/app.py` exposes async job endpoints.
3. **Wire local orchestrator -> Colab -> validate+render**  
   `pipeline/planning/local/run_local_to_colab.py` handles this flow.
4. **Support baseline video and frame-array transport**  
   Both are implemented and selectable via CLI flags.

## Validation + renderer invariants

- Local validation uses `pipeline/render/validate_plan.py`.
- Local render uses `pipeline/render/render.py`.
- `edit_plan_schema.json` remains the source-of-truth contract.


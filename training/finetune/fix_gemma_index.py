"""
Fix corrupted Gemma HF repos by restoring the original 5-shard index.
The 5-shard files (uploaded 3 days ago) are the original correct model.
The 8-shard files (1 day ago) are corrupted from a bad dequant.py run.

Usage:
  pip install huggingface_hub safetensors -q
  HF_TOKEN=hf_... python3 fix_gemma_index.py
"""
import json, os, tempfile
from pathlib import Path
from huggingface_hub import HfApi, hf_hub_download
from safetensors import safe_open

HF_USER = "thejesraj"
REPOS   = ["wos-coding-gemma", "wos-meeting-gemma", "wos-main-gemma"]
GOOD    = [f"model-0000{i}-of-00005.safetensors" for i in range(1, 6)]
BAD     = [f"model-0000{i}-of-00008.safetensors" for i in range(1, 9)]

def build_index(repo_id):
    print(f"  Reading tensor names from 5-shard files...")
    index = {"metadata": {"total_size": 0}, "weight_map": {}}
    with tempfile.TemporaryDirectory() as tmp:
        for shard in GOOD:
            print(f"    Downloading {shard}...")
            path = hf_hub_download(repo_id=repo_id, filename=shard, local_dir=tmp)
            index["metadata"]["total_size"] += Path(path).stat().st_size
            with safe_open(path, framework="pt") as f:
                for key in f.keys():
                    index["weight_map"][key] = shard
    print(f"  {len(index['weight_map'])} tensors mapped across 5 shards")
    return index

def fix_repo(repo_id, api):
    print(f"\n{'='*55}\nFixing: {repo_id}\n{'='*55}")
    index = build_index(repo_id)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(index, f, indent=2)
        tmp = f.name
    print("  Uploading corrected model.safetensors.index.json...")
    api.upload_file(
        path_or_fileobj=tmp,
        path_in_repo="model.safetensors.index.json",
        repo_id=repo_id,
        commit_message="Restore 5-shard index (remove corrupted 8-shard dequant upload)",
    )
    os.unlink(tmp)
    print("  Index uploaded!")
    print("  Deleting corrupted 8-shard files...")
    for shard in BAD:
        try:
            api.delete_file(path_in_repo=shard, repo_id=repo_id,
                            commit_message=f"Remove corrupted {shard}")
            print(f"    Deleted {shard}")
        except Exception as e:
            print(f"    Skip {shard}: {e}")
    print(f"  Done: https://huggingface.co/{repo_id}")

def main():
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("ERROR: set HF_TOKEN first:  export HF_TOKEN=hf_...")
        return
    api = HfApi(token=token)
    for repo in REPOS:
        try:
            fix_repo(f"{HF_USER}/{repo}", api)
        except Exception as e:
            print(f"FAILED {repo}: {e}")
    print("\nAll done! Next: increase GPU count to 2 on each Gemma RunPod endpoint.")

if __name__ == "__main__":
    main()

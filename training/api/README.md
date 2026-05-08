# WOS Unified Model Gateway

Single OpenAI-compatible endpoint for all 9 WOS fine-tuned models.

## Models

| Model ID | Architecture | Description |
|---|---|---|
| `wos-coding` | Qwen 2.5-32B | Fine-tuned on 60k coding examples |
| `wos-meeting` | Qwen 2.5-32B | Fine-tuned on 22k meeting transcripts |
| `wos-main` | Qwen 2.5-32B | General-purpose assistant |
| `wos-coding-mixtral` | Mixtral 8x7B | Fine-tuned on 60k coding examples |
| `wos-meeting-mixtral` | Mixtral 8x7B | Fine-tuned on 22k meeting transcripts |
| `wos-main-mixtral` | Mixtral 8x7B | General-purpose assistant |
| `wos-coding-gemma` | Gemma 2-27B | Fine-tuned on 60k coding examples |
| `wos-meeting-gemma` | Gemma 2-27B | Fine-tuned on 22k meeting transcripts |
| `wos-main-gemma` | Gemma 2-27B | General-purpose assistant |

## Setup

```bash
cd training/api
npm install
RUNPOD_API_KEY=rpa_YOUR_KEY node gateway.js
# → http://localhost:3000
```

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/v1/models` | List all models + metadata |
| GET | `/v1/models/:id` | Get single model metadata |
| POST | `/v1/chat/completions` | OpenAI chat completions |
| POST | `/v1/responses` | OpenAI Responses API |
| GET | `/v1/responses/:id` | Retrieve stored response |
| GET | `/health` | Health check |

---

## Usage Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="rpa_YOUR_RUNPOD_KEY"
)

# List all models
models = client.models.list()
for m in models.data:
    print(m.id, '-', m.description)

# Chat completions
response = client.chat.completions.create(
    model="wos-coding",
    messages=[{"role": "user", "content": "Write a Python fibonacci function"}],
    stream=True
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="", flush=True)

# Responses API
response = client.responses.create(
    model="wos-meeting",
    input="Summarize this transcript: Alice: Let's ship by Friday. Bob: I'll handle testing.",
    instructions="You are a meeting summarization assistant. Extract summary, action items, and decisions.",
    reasoning={"effort": "medium"}
)
print(response.output[0].content[0].text)
```

### JavaScript (OpenAI SDK)

```js
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'rpa_YOUR_RUNPOD_KEY',
})

// List models
const models = await client.models.list()
console.log(models.data.map(m => m.id))

// Chat
const completion = await client.chat.completions.create({
  model: 'wos-coding',
  messages: [{ role: 'user', content: 'Explain async/await in Python' }],
})
console.log(completion.choices[0].message.content)

// Responses API
const response = await client.responses.create({
  model: 'wos-meeting',
  input: 'Meeting transcript here...',
  instructions: 'Summarize with action items',
  reasoning: { effort: 'high' },
  stream: true,
})
for await (const event of response) {
  if (event.type === 'response.output_text.delta') process.stdout.write(event.delta)
}
```

### curl

```bash
# List models
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer rpa_YOUR_KEY"

# Chat completions
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer rpa_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"wos-coding","messages":[{"role":"user","content":"Write hello world in Rust"}]}'

# Responses API
curl http://localhost:3000/v1/responses \
  -H "Authorization: Bearer rpa_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "wos-meeting",
    "input": "Alice said ship by Friday. Bob will handle QA.",
    "instructions": "Extract action items and decisions",
    "reasoning": {"effort": "medium"}
  }'
```

## Share with Team (Public URL)

```bash
# Install ngrok if needed: brew install ngrok
ngrok http 3000
# → Forwarding https://abc123.ngrok.io → localhost:3000
# Share: https://abc123.ngrok.io/v1
```

## Environment Variables

| Variable | Description |
|---|---|
| `RUNPOD_API_KEY` | RunPod API key (starts with `rpa_`) |
| `PORT` | Server port (default: 3000) |

# What the phone model does, and what Sparky does

This is the design question behind the bridge: with a capable model running
on the phone, what should it do itself, and what should it pass to the PC?

## The two models are about the same size

| | Phone (BonzAI) | Sparky (home PC) |
|---|---|---|
| Model | PrismML **Bonsai 8B**, 1-bit | **Qwen 3.5 9B** on a desktop GPU (Ollama); hosted Nemotron models as fallback |
| Footprint | ~1.15 GB | Shares a 16 GB GPU with other local services |
| Speed | ~40 tok/s on iPhone 17 Pro | Desktop GPU, no battery or heat limits |
| Quality | Averages 70.5 on PrismML's benchmark mix, above Llama 3.1 8B (67.1) and near Ministral 3 8B (71.0) | Newer generation, somewhat stronger, same class |
| Context | Short in practice (battery, heat) | 64k tokens |
| Data | Only what is on the device, plus web search | Your workspace, long-term memory, tasks, reports, email, files |
| Tools | BonzAI built-ins + this bridge | Full OpenClaw tool set |

**The main point:** passing a request to Sparky rarely gets you a *smarter*
model. Both are 8–9B class. What Sparky adds is **access** (data, memory,
tools), **time** (long runs without a phone in your hand), and **power** (no
battery or heat limits). Route on those, not on "this seems hard."

The Nemotron fallbacks are the exception. When Sparky escalates to a hosted
30B–550B model, the answer really is smarter. That is on the roadmap as an
explicit option, not something the phone should trigger by accident.

## What the phone model should do itself

These work well on a 1-bit 8B and keep data on the device:

- **Rewrite, summarize, translate, explain** text you paste or shares from another app.
- **Read a document on the device**: pull the key facts out of a PDF, receipt
  or screenshot without sending it anywhere.
- **Quick questions** with BonzAI's built-in web search.
- **Offline work**: on a plane, in a basement, or with no signal. The bridge
  needs Tailscale; the phone model does not.
- **Capture**: turn a rambling voice note into a clean `sparky_note`.
- **Triage**: decide "me or Sparky?" and, if Sparky, **write a request that
  makes sense on its own**. A small model does this cheaply, and it saves
  Sparky a clarifying turn.
- **Read and condense** what Sparky sends back (`sparky_inbox`) for a phone screen.

## What it should pass to Sparky

- Anything that needs **your information**: "what did I decide about the
  website redesign?", "what's in my inbox?", "where is the release checklist?"
- **Multi-step or long work**: research with many fetches, writing a report,
  checking several systems. Use `background: true` and collect the result later.
- Anything that **acts on the PC** or on your accounts. Even then Sparky
  should confirm with you directly before doing anything outward-facing (see
  [SECURITY.md](../SECURITY.md)).

## Where a small model struggles, and how the design compensates

| Weakness | Mitigation |
|---|---|
| Long tool chains go wrong after 2–3 calls | Six coarse tools; one `sparky_ask` call replaces a whole workflow |
| Tends to invent tool results | Tool output is short JSON with one clear `status`; the system prompt says "never make up what Sparky said" |
| Long waits and timeouts | `sparky_ask` returns a `job_id` after about 75 s instead of hanging the app |
| Limited context | Outbox messages are capped at 4,000 characters; Sparky is told to put the important thing first |
| Can be steered by text it read on the web | Sparky gets a header on every relayed turn and should run under a restricted agent with no outward-facing tools |

## Example flows

**Private, local only.** You share a contract PDF: "What's the termination
clause?" The phone reads it on the device and answers. Nothing leaves the phone.

**Needs your data.** "What did Sparky and I decide about the backup schedule?" The
phone calls `sparky_ask`. Sparky searches memory and replies in about 10–30 s.

**Long job.** "Research 1-bit model benchmarks and write me a summary." The
phone calls `sparky_ask` with `background: true`, tells you it's queued, and
later `sparky_job_result` returns the summary.

**Capture on the go.** Voice: "Remind Sparky to reorder the GPU riser." The
phone calls `sparky_note`. Sparky's `bonzai-mailbox` skill picks it up during
triage.

**Morning routine.** A BonzAI Agent Routine at 7:00 calls `sparky_inbox`,
condenses it into three bullets, and acks what it showed.

## Picking the phone model

Bonsai 8B is a good default: small, fast, and its published benchmarks include
tool use (BFCL). Things worth testing on your own devices:

- **Keep context short** (8–16k) on the phone. Longer contexts cost battery
  and heat, and the bridge keeps tool output small anyway.
- **Bonsai 1.7B** (~0.24 GB, ~130 tok/s) is worth trying on the iPad or for
  routines that only triage and summarize.
- If tool calling is unreliable with a given model, test the same system
  prompt with Qwen 3.5 4B in BonzAI before blaming the bridge.

Sources: [PrismML announcement](https://prismml.com/news/bonsai-8b),
[Bonsai-8B on Hugging Face](https://huggingface.co/prism-ml/Bonsai-8B-mlx-1bit),
[The Register](https://www.theregister.com/2026/04/04/prismml_1bit_llm/).

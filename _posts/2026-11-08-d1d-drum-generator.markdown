---
layout: post
title:  "D1D: generating drum one-shots on the CPU in 0.3 seconds"
date:   2026-11-08 18:00:00 +0100
categories:
---

# D1D: generating drum one-shots on the CPU in 0.3 seconds

D1D ("Drum 1D") is a small generative model that creates **kick, snare and hi-hat
one-shots as raw audio**: 0.512 s, mono, 32 kHz. You press a button, you get a new
drum sound that never existed before. It is 4.9 M parameters in total and runs
on an ordinary CPU, with no GPU and no cloud.

<audio controls src="{{ "/assets/d1d/turbo_kick_00.wav" | relative_url }}"></audio>
<audio controls src="{{ "/assets/d1d/turbo_snare_01.wav" | relative_url }}"></audio>
<audio controls src="{{ "/assets/d1d/turbo_hat_02.wav" | relative_url }}"></audio>

*Kick, snare, hat: straight out of D1D-Turbo, no post-processing.*

**[→ Try it in the browser]({{ "/d1d/" | relative_url }})** (access-restricted for now)
· Models on Hugging Face: [D1D](https://huggingface.co/sixf0ur/D1D),
[D1D-Turbo](https://huggingface.co/sixf0ur/D1D-Turbo)

## What I built

| | D1D | D1D-Turbo |
|---|---|---|
| network passes per sound | 100 (50 steps + guidance) | **3** |
| time per sound, 6-core CPU | ~12 s | **~0.35 s** |
| silence before/after the hit | faint noise floor | exact digital silence |

D1D-Turbo is the one you actually use; D1D is the full-quality "teacher" it was
distilled from. Both run in three ways, none of which needs PyTorch:

- **Python** with ONNX Runtime;
- **C++**, as a single header-only library (`d1d.hpp`, standard library only, no
  DLLs) plus a small command-line tool;
- **in the browser**, as a JavaScript/WebAssembly port. The demo above runs
  completely on your machine.

## How

**Raw waveform, no VAE.** My first attempt was the "image diffusion" recipe: a VAE
compresses the audio, and a diffusion transformer generates in the latent space.
The latent only compressed 4×, though, and the VAE's reconstruction errors capped
everything downstream. Hi-hats came out dull, with most of their highs missing.
So I dropped the VAE and generate the waveform directly.

**A 1D U-Net trained with rectified flow.** The network is a convolutional U-Net
over the 16,384 samples:
- 5 resolution levels;
- residual blocks conditioned on time and drum class via FiLM;
- self-attention only at the lowest resolution.

It learns a velocity field that carries Gaussian noise to a drum sound along
straight-ish paths (rectified flow / flow matching). Sampling is a plain Euler
loop.

**The bug you could hear.** The first models had perfect spectra but sounded
"played backwards": the envelope peaked hundreds of milliseconds after the onset,
and snares swelled instead of decaying. Convolutions only see a local window and
attention without positions doesn't know where it is, so nothing in the net
knew how far it was from the hit. Adding a sin-cos positional encoding to the
attention, scaled by a learnable gate that starts at zero, fixed it. The attack
went from 344 ms late to on time.

**From 100 passes to 3: reflow distillation.**
- I let the teacher turn 60,000 noise vectors into sounds (50 Euler steps with
  classifier-free guidance).
- I trained a copy of it on the *straight* lines between each noise and its
  sound. Straight paths can be integrated in a handful of steps, and because the
  pairs were made with guidance, the guidance is baked in.
- Result: 3 steps, 1 pass each. That is about 33× faster, with the same spectrum,
  attack and decay as the teacher.

**Making silence actually silent.** On headphones you could hear a faint hiss
before and after every hit. With velocity prediction, exact silence would require
the network to cancel the noise to about 0.03 % precision, and loss tweaks
plateaued around −57 dB. The fix was architectural instead: a tiny learned output
gate (225 parameters) that multiplies the predicted sound by a value in [0, 1].
Silence now only needs "gate ≤ −1", a margin instead of a precision. After
fine-tuning, the noise floor in the silent parts dropped from about −60 dB to
digital zero.

**Making it fast on a CPU.** I wrote the C++ inference from scratch:
- a hand-written AVX2 convolution kernel;
- a persistent thread pool;
- buffer reuse;
- fused concat, upsample and residual add.

It runs at 114 ms per network pass on a Ryzen 5 5500, slightly faster than ONNX
Runtime, and its output matches PyTorch to within 7·10⁻⁶. The same code is the
header-only library, so it can drop into a plugin or a game engine.

**Did it just memorise?** For 128 generated sounds per class, I searched for the
most similar training sound. The generated sounds are *less* similar to the
training data than the training sounds are to each other, and none comes close
to a copy.

## What's next

44.1 kHz, more instruments (toms, claps, percussion), and control beyond "kick /
snare / hat", possibly as a plugin.

#!/usr/bin/env python3
"""Radio chain analysis — spectrogram comparison of clean vs processed audio.
Requires: numpy, matplotlib (both standard on macOS/Homebrew), ffmpeg in PATH.

Usage:
  python3 scripts/analyze-radio.py clean.mp3 processed.mp3
  python3 scripts/analyze-radio.py audio/hostomel/atc_olena.mp3 CRACKLE_RADIO_atc_olena.mp3
"""

import sys, math, subprocess, struct
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

# ── Audio loader — uses ffmpeg, works on MP3/WAV/any format ──────────────────

def load_audio(path):
    """Decode any audio file to mono float32 via ffmpeg."""
    cmd = [
        'ffmpeg', '-v', 'quiet', '-i', path,
        '-f', 's16le', '-ac', '1', '-ar', '44100', 'pipe:1'
    ]
    raw = subprocess.run(cmd, capture_output=True).stdout
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, 44100

# ── Spectrogram panel ─────────────────────────────────────────────────────────

def draw_spectrogram(ax, samples, sr, title):
    NFFT  = 1024
    NOVLP = 896
    _, _, _, im = ax.specgram(
        samples, NFFT=NFFT, Fs=sr, noverlap=NOVLP,
        cmap='inferno', vmin=-90, vmax=-20,
        mode='psd', scale='dB'
    )
    ax.set_ylim(0, 4000)
    ax.set_ylabel('Frequency (Hz)')
    ax.set_title(title, fontsize=10, fontweight='bold')
    ax.yaxis.set_major_locator(ticker.MultipleLocator(500))
    ax.yaxis.set_minor_locator(ticker.MultipleLocator(100))
    plt.colorbar(im, ax=ax, label='dB')

    # VHF aviation band markers
    ax.axhline(350,  color='cyan',   linewidth=0.7, linestyle='--', alpha=0.7)
    ax.axhline(3400, color='cyan',   linewidth=0.7, linestyle='--', alpha=0.7)
    ax.axhline(2100, color='yellow', linewidth=0.6, linestyle=':',  alpha=0.6)
    ax.text(0.3, 400,  '350 Hz',  color='cyan',   fontsize=7)
    ax.text(0.3, 3300, '3400 Hz', color='cyan',   fontsize=7)
    ax.text(0.3, 2150, '2100 Hz presence', color='yellow', fontsize=7)

# ── Waveform panel ────────────────────────────────────────────────────────────

def draw_waveform(ax, samples, sr, color):
    t = np.linspace(0, len(samples)/sr, len(samples))
    step = max(1, len(samples) // 6000)
    ax.plot(t[::step], samples[::step], color=color, linewidth=0.4)
    ax.set_ylabel('Amplitude')
    ax.set_xlabel('Time (s)')
    ax.set_ylim(-1, 1)
    ax.set_xlim(0, len(samples)/sr)
    ax.axhline(0, color='white', linewidth=0.3, alpha=0.3)

# ── Band energy report ────────────────────────────────────────────────────────

def print_band_energy(label, samples, sr):
    N    = 65536
    win  = np.hanning(min(len(samples), N))
    seg  = samples[:len(win)] * win
    fft  = np.abs(np.fft.rfft(seg, n=N))
    freq = np.fft.rfftfreq(N, 1/sr)

    def band_rms(lo, hi):
        mask = (freq >= lo) & (freq < hi)
        return math.sqrt(np.mean(fft[mask]**2)) if mask.any() else 0.0

    rms = math.sqrt(np.mean(samples**2))
    peak = freq[np.argmax(fft[freq < 5000])]
    print(f'\n  {label}')
    print(f'    Sub-bass   <350 Hz   : {band_rms(20,   350):8.3f}')
    print(f'    Voice band 350-3400  : {band_rms(350, 3400):8.3f}')
    print(f'    Presence   1800-2600 : {band_rms(1800,2600):8.3f}')
    print(f'    Air        >3400 Hz  : {band_rms(3400,8000):8.3f}')
    print(f'    Peak freq            : {peak:.0f} Hz')
    print(f'    RMS level            : {rms:.4f}')

# ── Main ──────────────────────────────────────────────────────────────────────

if len(sys.argv) < 3:
    print(__doc__)
    sys.exit(1)

clean_path = sys.argv[1]
proc_path  = sys.argv[2]

print(f'Loading: {clean_path}')
clean, sr = load_audio(clean_path)
print(f'Loading: {proc_path}')
proc,  _  = load_audio(proc_path)

print(f'\nClean    : {sr} Hz  |  {len(clean)/sr:.1f}s  |  {len(clean):,} samples')
print(f'Processed: {sr} Hz  |  {len(proc)/sr:.1f}s  |  {len(proc):,} samples')

print_band_energy('CLEAN',     clean, sr)
print_band_energy('PROCESSED', proc,  sr)

fig, axes = plt.subplots(2, 2, figsize=(18, 10),
                          gridspec_kw={'height_ratios': [3, 1]})
fig.suptitle('Radio Chain Analysis — Clean vs Processed', fontsize=13, fontweight='bold')

draw_spectrogram(axes[0][0], clean, sr, f'CLEAN — {clean_path}')
draw_spectrogram(axes[0][1], proc,  sr, f'PROCESSED — {proc_path}')
draw_waveform(axes[1][0], clean, sr, '#88aaff')
draw_waveform(axes[1][1], proc,  sr, '#ffaa44')

plt.tight_layout()
out = 'radio_analysis.png'
plt.savefig(out, dpi=150)
print(f'\nSpectrogram saved: {out}')
plt.show()

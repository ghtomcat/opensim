#!/usr/bin/env python3
"""DB 605 startup synthesis — spectrogram + phase annotations.
Usage: python3 scripts/analyze-startup.py startup.wav"""

import sys, struct, math
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

WAV = sys.argv[1] if len(sys.argv) > 1 else 'startup.wav'

# ── Read WAV ──────────────────────────────────────────────────────────────────
with open(WAV, 'rb') as f:
    f.read(22)                          # RIFF/WAVE/fmt
    channels = struct.unpack('<H', f.read(2))[0]
    sr       = struct.unpack('<I', f.read(4))[0]
    f.read(6)                           # byte rate, block align
    bits     = struct.unpack('<H', f.read(2))[0]
    f.read(4)                           # 'data'
    data_len = struct.unpack('<I', f.read(4))[0]
    raw      = f.read(data_len)

samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
if channels == 2:
    samples = samples[::2]              # take left channel
duration = len(samples) / sr
print(f'File     : {WAV}')
print(f'SR       : {sr} Hz  |  Duration : {duration:.1f}s  |  Samples : {len(samples):,}')

# ── Known phase boundaries (seconds) ─────────────────────────────────────────
# Flywheel(26) + gap(0.06) + Klonk(0.18) + gap(0.06) + Motoring(2.8) + gap(0.06) + Runup(42)
FW_END    = 26.0
KLONK_END = FW_END + 0.06 + 0.18
MOT_END   = KLONK_END + 0.06 + 2.8
RUN_START = MOT_END + 0.06
ZUND1     = RUN_START + 0.04           # first Knall (Zündung 1)
LADER_IN  = RUN_START + 42.0 * 0.28   # supercharger fades in at 28% into runup

phases = [
    (0,         'Schwungrad'),
    (FW_END,    'Klonk'),
    (MOT_END,   'Anlassen'),
    (RUN_START, 'Anlauf'),
    (ZUND1,     'Zündung 1'),
    (LADER_IN,  'Lader ein'),
]

# ── Spectrogram ───────────────────────────────────────────────────────────────
fig, axes = plt.subplots(2, 1, figsize=(18, 10), gridspec_kw={'height_ratios': [3, 1]})
fig.suptitle('DB 605 Startup Synthesis — Spectrogram', fontsize=13, fontweight='bold')

ax = axes[0]
NFFT   = 2048
NOVLP  = 1792
cmap   = 'inferno'

Pxx, freqs, times, im = ax.specgram(
    samples, NFFT=NFFT, Fs=sr, noverlap=NOVLP,
    cmap=cmap, vmin=-90, vmax=-20,
    mode='psd', scale='dB'
)
ax.set_ylim(0, 3000)
ax.set_ylabel('Frequency (Hz)')
ax.set_xlabel('')
ax.yaxis.set_major_locator(ticker.MultipleLocator(500))
ax.yaxis.set_minor_locator(ticker.MultipleLocator(100))
plt.colorbar(im, ax=ax, label='dB')

# Phase lines + labels
for t, label in phases:
    ax.axvline(t, color='cyan', linewidth=0.8, alpha=0.7)
    ax.text(t + 0.3, 2800, label, color='cyan', fontsize=7.5, va='top')

# Supercharger idle frequency reference
ax.axhline(700, color='yellow', linewidth=0.6, linestyle='--', alpha=0.6)
ax.text(1, 710, '700 Hz (Lader idle)', color='yellow', fontsize=7)

# ── Waveform ─────────────────────────────────────────────────────────────────
ax2 = axes[1]
t_ax = np.linspace(0, duration, len(samples))
# downsample for plotting
step = max(1, len(samples) // 8000)
ax2.plot(t_ax[::step], samples[::step], color='#88aaff', linewidth=0.4)
ax2.set_xlim(0, duration)
ax2.set_ylabel('Amplitude')
ax2.set_xlabel('Time (s)')
ax2.set_ylim(-1, 1)
ax2.axhline(0, color='white', linewidth=0.3, alpha=0.3)
for t, label in phases:
    ax2.axvline(t, color='cyan', linewidth=0.8, alpha=0.7)

# ── Frequency profile over time (for key windows) ────────────────────────────
print('\nPeak frequencies at key moments:')
windows = [
    ('Flywheel mid',  10.0,  2.0),
    ('Klonk',         FW_END + 0.09, 0.1),
    ('Motoring mid',  (FW_END + MOT_END) / 2, 0.5),
    ('Zündung 1',     ZUND1, 0.5),
    ('Lader in',      LADER_IN, 1.0),
    ('Runup end',     RUN_START + 40.0, 1.5),
]
for label, t_center, t_win in windows:
    i0 = max(0, int((t_center - t_win/2) * sr))
    i1 = min(len(samples), int((t_center + t_win/2) * sr))
    seg = samples[i0:i1]
    if len(seg) < 512: continue
    fft = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n=8192))
    freq_axis = np.fft.rfftfreq(8192, 1/sr)
    # only look below 3000 Hz
    mask = freq_axis < 3000
    peak_freq = freq_axis[mask][np.argmax(fft[mask])]
    rms = math.sqrt(np.mean(seg**2))
    print(f'  {label:<16} t={t_center:5.1f}s  peak={peak_freq:6.0f} Hz  rms={rms:.4f}')

plt.tight_layout()
out_img = WAV.replace('.wav', '_spectrogram.png')
plt.savefig(out_img, dpi=150)
print(f'\nSpectrogram saved: {out_img}')
plt.show()

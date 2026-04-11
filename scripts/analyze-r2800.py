#!/usr/bin/env python3
"""R-2800 Double Wasp spectrum analysis.
Analyzes the reference recording to extract synthesis parameters.
Usage: python3 scripts/analyze-r2800.py audio/r2800_reference.wav
Engine start at t=68s (1:08 in video).
"""

import sys, struct, math
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

WAV      = sys.argv[1] if len(sys.argv) > 1 else 'audio/r2800_reference.wav'
T_START  = 68.0    # engine start (1:08)

# ── Read WAV ──────────────────────────────────────────────────────────────────
with open(WAV, 'rb') as f:
    f.read(22)
    channels = struct.unpack('<H', f.read(2))[0]
    sr       = struct.unpack('<I', f.read(4))[0]
    f.read(6)
    bits     = struct.unpack('<H', f.read(2))[0]
    f.read(4)
    data_len = struct.unpack('<I', f.read(4))[0]
    raw      = f.read(data_len)

samples  = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
if channels == 2:
    samples = samples[::2]
duration = len(samples) / sr
print(f'File     : {WAV}')
print(f'SR       : {sr} Hz  |  Duration: {duration:.1f}s  |  Channels: {channels}')

# ── Helper ────────────────────────────────────────────────────────────────────
def segment(t_center, t_win):
    i0 = max(0, int((t_center - t_win/2) * sr))
    i1 = min(len(samples), int((t_center + t_win/2) * sr))
    return samples[i0:i1]

def peak_freqs(seg, n=5, lo=30, hi=4000):
    """Return top N spectral peaks between lo and hi Hz."""
    if len(seg) < 512:
        return []
    win = np.hanning(len(seg))
    fft = np.abs(np.fft.rfft(seg * win, n=16384))
    freq_axis = np.fft.rfftfreq(16384, 1/sr)
    mask = (freq_axis >= lo) & (freq_axis <= hi)
    f = freq_axis[mask]
    m = fft[mask]
    # find peaks (local maxima)
    peaks = []
    for i in range(1, len(m)-1):
        if m[i] > m[i-1] and m[i] > m[i+1]:
            peaks.append((f[i], m[i]))
    peaks.sort(key=lambda x: -x[1])
    return peaks[:n]

def rms(seg):
    return math.sqrt(np.mean(seg**2)) if len(seg) > 0 else 0

# ── Key analysis windows ──────────────────────────────────────────────────────
print(f'\nEngine start at t={T_START:.0f}s (1:08 in video)')
print('=' * 70)

windows = [
    ('Pre-start (ambient)',  T_START - 5.0,  2.0),
    ('First puffs (cold)',   T_START + 2.0,  2.0),
    ('Early idle',           T_START + 8.0,  2.0),
    ('Settled idle',         T_START + 20.0, 3.0),
    ('Mid power',            T_START + 50.0, 3.0),
    ('High power',           T_START + 90.0, 3.0),
]

for label, t_c, t_w in windows:
    if t_c < 0 or t_c > duration:
        continue
    seg = segment(t_c, t_w)
    peaks = peak_freqs(seg)
    rms_val = rms(seg)
    print(f'\n{label}  (t={t_c:.0f}s, window={t_w:.0f}s)')
    print(f'  RMS amplitude: {rms_val:.4f}')
    if peaks:
        print(f'  Top spectral peaks:')
        for freq, amp in peaks:
            ratio = freq / peaks[0][0] if peaks[0][0] > 0 else 0
            print(f'    {freq:7.1f} Hz   amp={amp:.1f}   ratio={ratio:.2f}×fundamental')
    else:
        print('  (no segment data)')

# ── Firing rate analysis — count puffs at cold idle ──────────────────────────
print('\n' + '=' * 70)
print('Puff rate analysis (cold idle, first 5s after start):')
seg_idle = segment(T_START + 1.5, 5.0)
if len(seg_idle) > sr:
    # rectify + lowpass → envelope
    env = np.abs(seg_idle)
    # simple moving average 20ms
    kernel_len = int(0.020 * sr)
    kernel = np.ones(kernel_len) / kernel_len
    env_smooth = np.convolve(env, kernel, mode='same')
    # count threshold crossings (upward)
    threshold = np.percentile(env_smooth, 75)
    above = env_smooth > threshold
    crossings = np.where(np.diff(above.astype(int)) == 1)[0]
    if len(crossings) > 2:
        intervals = np.diff(crossings) / sr
        median_interval = np.median(intervals)
        puff_rate = 1.0 / median_interval
        # R-2800: puffs/s = RPM/60 × 9 (pairs per revolution)
        implied_rpm = puff_rate / 9 * 60
        print(f'  Threshold crossings: {len(crossings)}')
        print(f'  Median puff interval: {median_interval*1000:.1f} ms')
        print(f'  Puff rate: {puff_rate:.1f} puffs/s')
        print(f'  Implied RPM (18-cyl, 9 pairs/rev): {implied_rpm:.0f} RPM')
    else:
        print('  Not enough crossings to measure puff rate')

# ── Supercharger whine detection ──────────────────────────────────────────────
print('\n' + '=' * 70)
print('Supercharger whine sweep (idle → power):')
whine_windows = [
    ('Settled idle',  T_START + 20.0, 1.0),
    ('Mid power',     T_START + 50.0, 1.0),
    ('High power',    T_START + 90.0, 1.0),
]
for label, t_c, t_w in whine_windows:
    if t_c < 0 or t_c > duration:
        continue
    seg = segment(t_c, t_w)
    peaks = peak_freqs(seg, n=3, lo=400, hi=5000)
    if peaks:
        print(f'  {label} (t={t_c:.0f}s): {", ".join(f"{f:.0f} Hz" for f, _ in peaks)}')

# ── Spectrogram — from T_START to T_START+120s ───────────────────────────────
i0 = max(0, int(T_START * sr))
i1 = min(len(samples), int((T_START + 120) * sr))
seg_plot = samples[i0:i1]

fig, axes = plt.subplots(2, 1, figsize=(18, 10), gridspec_kw={'height_ratios': [3, 1]})
fig.suptitle('R-2800 Double Wasp — Startup Spectrum Analysis', fontsize=13, fontweight='bold')

ax = axes[0]
NFFT  = 2048
NOVLP = 1792
Pxx, freqs, times, im = ax.specgram(
    seg_plot, NFFT=NFFT, Fs=sr, noverlap=NOVLP,
    cmap='inferno', vmin=-80, vmax=-20, mode='psd', scale='dB'
)
ax.set_ylim(0, 3000)
ax.set_ylabel('Frequency (Hz)')
ax.yaxis.set_major_locator(ticker.MultipleLocator(200))
ax.yaxis.set_minor_locator(ticker.MultipleLocator(50))
plt.colorbar(im, ax=ax, label='dB')
ax.set_title(f'Spectrogram — t={T_START:.0f}s to t={T_START+120:.0f}s (engine start + 2 min)')

# Annotation lines
for t_offset, label in [(2, 'first puffs'), (8, 'early idle'), (20, 'settled idle'), (50, 'mid power'), (90, 'high power')]:
    if T_START + t_offset < duration:
        ax.axvline(t_offset, color='cyan', linewidth=0.8, alpha=0.7)
        ax.text(t_offset + 0.3, 2800, label, color='cyan', fontsize=7.5, va='top')

# Reference frequencies
for hz, label, color in [(90, '90 Hz (600 RPM fund.)', 'yellow'), (405, '405 Hz (2700 RPM fund.)', 'lime')]:
    ax.axhline(hz, color=color, linewidth=0.6, linestyle='--', alpha=0.6)
    ax.text(1, hz + 10, label, color=color, fontsize=7)

ax2 = axes[1]
t_ax = np.linspace(0, len(seg_plot)/sr, len(seg_plot))
step = max(1, len(seg_plot) // 8000)
ax2.plot(t_ax[::step], seg_plot[::step], color='#88aaff', linewidth=0.4)
ax2.set_xlim(0, len(seg_plot)/sr)
ax2.set_ylabel('Amplitude')
ax2.set_xlabel('Time (s) from engine start')
ax2.set_ylim(-1, 1)

plt.tight_layout()
out_img = WAV.replace('.wav', '_spectrogram.png')
plt.savefig(out_img, dpi=150)
print(f'\nSpectrogram saved: {out_img}')
plt.show()

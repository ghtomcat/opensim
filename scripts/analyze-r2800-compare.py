#!/usr/bin/env python3
"""Compare R-2800 synthesis vs old vs new worklet at 750 RPM idle.
Usage: python3 scripts/analyze-r2800-compare.py [audio/r2800_compare.wav]

WAV layout (from render-r2800-compare.mjs):
  t=0.0s  startup synthesis  (3s)
  t=4.0s  old worklet        (3s)
  t=8.0s  new worklet        (3s)
"""

import sys, struct, math
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker

WAV   = sys.argv[1] if len(sys.argv) > 1 else 'audio/r2800_compare.wav'
SEG   = 3.0   # segment duration
GAP   = 1.0   # silence between segments
T0    = 0.0
T1    = SEG + GAP
T2    = 2 * (SEG + GAP)
RPM   = 750
FUND  = RPM / 120 * 9  # 56.25 Hz

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

samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
if channels == 2:
    samples = samples[::2]
print(f'WAV: {WAV}  |  SR={sr}Hz  |  {len(samples)/sr:.1f}s  |  {channels}ch')

def get_seg(t_start):
    i0 = int(t_start * sr)
    i1 = i0 + int(SEG * sr)
    return samples[i0:i1]

seg_synth = get_seg(T0)
seg_old   = get_seg(T1)
seg_new   = get_seg(T2)

NFFT  = 65536
freqs = np.fft.rfftfreq(NFFT, 1/sr)

def spectrum(seg):
    win = np.hanning(len(seg))
    s   = seg[:NFFT] if len(seg) >= NFFT else np.pad(seg, (0, NFFT - len(seg)))
    mag = np.abs(np.fft.rfft(s * np.hanning(NFFT), n=NFFT))
    mag = 20 * np.log10(np.maximum(mag, 1e-12))
    return mag

sp_synth = spectrum(seg_synth)
sp_old   = spectrum(seg_old)
sp_new   = spectrum(seg_new)

# ── Print peak table ──────────────────────────────────────────────────────────
def top_peaks(sp, lo=30, hi=1200, n=10):
    mask = (freqs >= lo) & (freqs <= hi)
    f, m = freqs[mask], sp[mask]
    peaks = [(f[i], m[i]) for i in range(1, len(m)-1) if m[i] > m[i-1] and m[i] > m[i+1]]
    return sorted(peaks, key=lambda x: -x[1])[:n]

print(f'\nFundamental at 750 RPM: {FUND:.2f} Hz')
print(f'\n{"Hz":>8}  {"synth dB":>10}  {"old dB":>10}  {"new dB":>10}  {"harmonic"}')
print('-' * 60)
for h in range(1, 16):
    hz = FUND * h
    if hz > 1200: break
    def nearest_db(sp):
        idx = np.argmin(np.abs(freqs - hz))
        return sp[idx]
    print(f'{hz:8.1f}  {nearest_db(sp_synth):10.1f}  {nearest_db(sp_old):10.1f}  {nearest_db(sp_new):10.1f}  {h}×')

# Noise floor comparison (between harmonics)
def noise_floor(sp, lo, hi):
    mask = (freqs >= lo) & (freqs <= hi)
    if not np.any(mask): return -999
    return np.percentile(sp[mask], 20)

print(f'\nNoise floor (between harmonics):')
for band_lo, band_hi, label in [(70, 100, '70–100 Hz'), (170, 220, '170–220 Hz'), (350, 400, '350–400 Hz')]:
    print(f'  {label}: synth={noise_floor(sp_synth, band_lo, band_hi):.1f} dB  '
          f'old={noise_floor(sp_old, band_lo, band_hi):.1f} dB  '
          f'new={noise_floor(sp_new, band_lo, band_hi):.1f} dB')

# ── Plot ──────────────────────────────────────────────────────────────────────
fig, axes = plt.subplots(3, 1, figsize=(16, 12), sharex=True)
fig.suptitle(f'R-2800 idle 750 RPM — synthesis vs old worklet vs new worklet\n'
             f'Fundamental: {FUND:.1f} Hz, harmonics every {FUND:.1f} Hz', fontsize=12)

FMAX = 1200
mask = freqs <= FMAX

titles = ['Startup SYNTHESIS  (reference — sounds right)', 'OLD worklet  (muddy)', 'NEW worklet  (after fix)']
colors = ['#44cc88', '#ff6644', '#4499ff']
spectra = [sp_synth, sp_old, sp_new]

for ax, sp, title, color in zip(axes, spectra, titles, colors):
    ax.plot(freqs[mask], sp[mask], color=color, linewidth=0.8)
    ax.set_ylabel('dB')
    ax.set_title(title, fontsize=10, loc='left', pad=3)
    ax.set_ylim(-80, 10)
    ax.grid(True, alpha=0.2)
    ax.xaxis.set_major_locator(ticker.MultipleLocator(FUND * 2))
    ax.xaxis.set_minor_locator(ticker.MultipleLocator(FUND))

    # Harmonic markers
    for h in range(1, int(FMAX / FUND) + 1):
        hz = FUND * h
        ax.axvline(hz, color='white', linewidth=0.4, alpha=0.4, linestyle='--')
        if h <= 8:
            ax.text(hz, 8, f'{h}×', fontsize=6, ha='center', color='white', alpha=0.6)

axes[-1].set_xlabel('Frequency (Hz)')

# Overlay comparison on a 4th panel
ax4 = fig.add_axes([0.12, 0.01, 0.85, 0.25])
for sp, title, color in zip(spectra, titles, colors):
    ax4.plot(freqs[mask], sp[mask], color=color, linewidth=0.8, alpha=0.85, label=title.split('  ')[0])
ax4.set_xlim(0, FMAX)
ax4.set_ylim(-80, 10)
ax4.set_ylabel('dB')
ax4.set_xlabel('Frequency (Hz)')
ax4.set_title('Overlay comparison', fontsize=9, loc='left')
ax4.grid(True, alpha=0.2)
ax4.legend(fontsize=8, loc='upper right')
for h in range(1, int(FMAX / FUND) + 1):
    ax4.axvline(FUND * h, color='white', linewidth=0.3, alpha=0.3)

plt.tight_layout(rect=[0, 0.27, 1, 1])

out_img = WAV.replace('.wav', '_spectrum.png')
plt.savefig(out_img, dpi=150, bbox_inches='tight')
print(f'\nSaved: {out_img}')
plt.show()

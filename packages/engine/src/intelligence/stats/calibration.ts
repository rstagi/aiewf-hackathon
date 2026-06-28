/**
 * Calibration & agreement metrics for the resolution judge (§6.3).
 *
 * Accuracy/F1/κ do NOT measure calibration — a "0.8" must really mean ~80% resolved.
 * On imbalanced labels κ alone misleads, so report balanced accuracy / PABAK too.
 */

/** Mean squared error between predicted probabilities and {0,1} outcomes. */
export function brier(probs: number[], outcomes: number[]): number {
  if (probs.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < probs.length; i++) s += (probs[i] - outcomes[i]) ** 2;
  return s / probs.length;
}

export interface ReliabilityBin {
  binMid: number;
  confidence: number; // mean predicted prob in bin
  empirical: number; // observed fraction positive in bin
  count: number;
}

/** Reliability curve: bin predictions into `bins` equal-width buckets over [0,1]. */
export function reliabilityCurve(probs: number[], outcomes: number[], bins = 10): ReliabilityBin[] {
  const acc = Array.from({ length: bins }, () => ({ sumP: 0, sumO: 0, n: 0 }));
  for (let i = 0; i < probs.length; i++) {
    let b = Math.floor(probs[i] * bins);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    acc[b].sumP += probs[i];
    acc[b].sumO += outcomes[i];
    acc[b].n += 1;
  }
  return acc.map((a, i) => ({
    binMid: (i + 0.5) / bins,
    confidence: a.n ? a.sumP / a.n : 0,
    empirical: a.n ? a.sumO / a.n : 0,
    count: a.n,
  }));
}

/** Expected calibration error: count-weighted |empirical − confidence| over bins. */
export function ece(probs: number[], outcomes: number[], bins = 10): number {
  const curve = reliabilityCurve(probs, outcomes, bins);
  const n = probs.length || 1;
  return curve.reduce((acc, b) => acc + (b.count / n) * Math.abs(b.empirical - b.confidence), 0);
}

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface AgreementMetrics {
  sensitivity: number;
  specificity: number;
  accuracy: number;
  balancedAccuracy: number;
  cohenKappa: number;
  pabak: number;
}

/** Prevalence-robust agreement metrics from a 2×2 confusion matrix. */
export function agreement(c: Confusion): AgreementMetrics {
  const { tp, fp, fn, tn } = c;
  const n = tp + fp + fn + tn || 1;
  const sensitivity = tp + fn ? tp / (tp + fn) : 0;
  const specificity = tn + fp ? tn / (tn + fp) : 0;
  const accuracy = (tp + tn) / n;
  const balancedAccuracy = (sensitivity + specificity) / 2;
  const po = accuracy;
  const pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n);
  const cohenKappa = pe < 1 ? (po - pe) / (1 - pe) : 0;
  const pabak = 2 * accuracy - 1;
  return { sensitivity, specificity, accuracy, balancedAccuracy, cohenKappa, pabak };
}

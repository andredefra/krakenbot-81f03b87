// Italian tax rules for crypto capital gains.
// Isomorphic helpers — pure functions, no I/O.

export type TaxDeadline = {
  id: string;
  label: string;
  date: string; // ISO date for the current/next occurrence
  description: string;
  category: "saldo" | "acconto" | "dichiarazione" | "monitoraggio";
};

export type TaxSummary = {
  country: "IT";
  year: number;
  realizedGainCents: number; // gross realized P&L for the year (live trades)
  lossCarryforwardCents: number;
  taxableBaseCents: number; // max(realized - carryforward, 0)
  taxRateBps: number; // 2600 = 26%
  taxDueCents: number;
  reservedCents: number;
  reserveCoverageBps: number; // 10000 = 100%
  deadlines: TaxDeadline[];
  nextDeadline?: TaxDeadline & { daysLeft: number };
  notes: string[];
};

export const IT_TAX_RATE_BPS = 2600; // 26%

/**
 * Generates Italian tax deadlines for the next ~14 months from `today`.
 * Note: dates use solar calendar; if a deadline falls on weekend, Agenzia delle Entrate
 * typically shifts to next business day — not modeled here to avoid false precision.
 */
export function getItalianDeadlines(today: Date = new Date()): TaxDeadline[] {
  const y = today.getFullYear();
  const candidates: TaxDeadline[] = [];

  for (const offset of [0, 1]) {
    const yr = y + offset;
    candidates.push(
      {
        id: `it-saldo-${yr}`,
        label: `Saldo imposta sostitutiva ${yr - 1}`,
        date: `${yr}-06-30`,
        description: `Versamento saldo 26% sulle plusvalenze crypto realizzate nel ${yr - 1} (Quadro RT, Modello Redditi PF).`,
        category: "saldo",
      },
      {
        id: `it-acconto2-${yr}`,
        label: `2° acconto ${yr}`,
        date: `${yr}-11-30`,
        description: `Secondo acconto imposte ${yr} (se dovuto in base al saldo dell'anno precedente).`,
        category: "acconto",
      },
      {
        id: `it-dichiarazione-${yr}`,
        label: `Dichiarazione Redditi PF ${yr}`,
        date: `${yr}-09-30`,
        description: `Termine invio telematico Modello Redditi PF anno d'imposta ${yr - 1} (Quadro RT per crypto, Quadro RW per monitoraggio se applicabile).`,
        category: "dichiarazione",
      },
    );
  }

  // Sort & keep only future / today
  const todayStr = today.toISOString().slice(0, 10);
  return candidates
    .filter((d) => d.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function computeItalianTax(input: {
  realizedGainCents: number;
  lossCarryforwardCents: number;
  reservedCents: number;
  year: number;
  today?: Date;
}): TaxSummary {
  const today = input.today ?? new Date();
  const taxableBaseCents = Math.max(
    0,
    input.realizedGainCents - input.lossCarryforwardCents,
  );
  const taxDueCents = Math.round((taxableBaseCents * IT_TAX_RATE_BPS) / 10000);
  const reserveCoverageBps =
    taxDueCents > 0 ? Math.min(10000, Math.round((input.reservedCents / taxDueCents) * 10000)) : 10000;

  const deadlines = getItalianDeadlines(today);
  const next = deadlines[0];
  const nextDeadline = next
    ? {
        ...next,
        daysLeft: Math.ceil(
          (new Date(next.date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        ),
      }
    : undefined;

  return {
    country: "IT",
    year: input.year,
    realizedGainCents: input.realizedGainCents,
    lossCarryforwardCents: input.lossCarryforwardCents,
    taxableBaseCents,
    taxRateBps: IT_TAX_RATE_BPS,
    taxDueCents,
    reservedCents: input.reservedCents,
    reserveCoverageBps,
    deadlines,
    nextDeadline,
    notes: [
      "Calcolo basato su imposta sostitutiva 26% (Quadro RT). Le minusvalenze pregresse sono riportabili fino a 4 anni.",
      "Il monitoraggio fiscale (Quadro RW) e l'eventuale bollo IVAFE non sono calcolati automaticamente — verifica con il commercialista.",
      "Solo i trade Live concorrono alla base imponibile. I dati Paper sono esclusi.",
    ],
  };
}

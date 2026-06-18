#!/usr/bin/env python3
"""
backtest_v3.py — Backtest del CORE della Strategia v3 contro i benchmark giusti.

Cosa testa (sul SINGOLO asset, di solito BTC poi ETH):
  1. buy_hold   : comprare e tenere (benchmark 1)
  2. dca        : acquisto periodico a importo fisso (benchmark 2 — il vero metro)
  3. trend_core : investito quando close > SMA(n), altrimenti cash (filtro di regime v3)
  4. trend_dca  : trend_core + accumulo (DCA) in ribasso profondo (la proposta v3)

IMPORTANTISSIMO — COMMISSIONI:
  I default replicano Kraken Pro (taker 0.40% per lato + slippage), NON lo 0.1%
  dei backtest "da brochure". A commissioni realistiche il quadro cambia molto.

Dati:
  --csv path.csv   con almeno le colonne: date, close  (consigliato: open,high,low,close,volume)
  --symbol BTC-USD usa yfinance (richiede rete + `pip install yfinance`)

Esempi:
  python backtest_v3.py --csv btc_daily.csv
  python backtest_v3.py --symbol BTC-USD --period 3y --sma 200 --commission 0.004 --slippage 0.0005
  python backtest_v3.py --csv eth_daily.csv --save eth_equity

NB: il sentiment (Fear & Greed) NON è incluso: yfinance non lo fornisce. Qui il
"ribasso profondo" è approssimato dal drawdown dal massimo a N giorni. Il bot reale
usa il Fear & Greed: collega quella serie per un test fedele.
"""

import argparse, sys
import numpy as np
import pandas as pd


# ----------------------------- dati -----------------------------
def load_csv(path):
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    if "date" not in df.columns or "close" not in df.columns:
        sys.exit("CSV deve contenere almeno le colonne 'date' e 'close'.")
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df[["date", "close"]]


def load_yf(symbol, period, interval):
    try:
        import yfinance as yf
    except ImportError:
        sys.exit("yfinance non installato. Usa --csv, oppure `pip install yfinance`.")
    data = yf.download(symbol, period=period, interval=interval, progress=False)
    if data.empty:
        sys.exit(f"Nessun dato per {symbol} (rete bloccata? prova --csv).")
    data = data.reset_index()
    out = pd.DataFrame({"date": pd.to_datetime(data["Date"]),
                        "close": np.asarray(data["Close"]).reshape(-1)})
    return out


# ----------------------------- metriche -----------------------------
def metrics_from_equity(equity, dates, trades=None, periods_per_year=365):
    equity = np.asarray(equity, dtype=float)
    ret = np.diff(equity) / equity[:-1]
    total_return = equity[-1] / equity[0] - 1.0
    days = (dates.iloc[-1] - dates.iloc[0]).days or 1
    years = days / 365.0
    cagr = (equity[-1] / equity[0]) ** (1 / years) - 1.0 if years > 0 else float("nan")
    vol = ret.std(ddof=1) * np.sqrt(periods_per_year) if len(ret) > 1 else float("nan")
    sharpe = (ret.mean() * periods_per_year) / vol if vol and vol == vol and vol != 0 else float("nan")
    downside = ret[ret < 0]
    dstd = downside.std(ddof=1) * np.sqrt(periods_per_year) if len(downside) > 1 else float("nan")
    sortino = (ret.mean() * periods_per_year) / dstd if dstd and dstd == dstd and dstd != 0 else float("nan")
    peak = np.maximum.accumulate(equity)
    max_dd = ((equity - peak) / peak).min()
    calmar = cagr / abs(max_dd) if max_dd != 0 else float("nan")

    out = {"total_return": total_return, "cagr": cagr, "vol": vol, "sharpe": sharpe,
           "sortino": sortino, "max_dd": max_dd, "calmar": calmar,
           "n_trades": 0, "win_rate": float("nan"), "profit_factor": float("nan")}
    if trades:
        pnls = [t["pnl"] for t in trades]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]
        out["n_trades"] = len(pnls)
        out["win_rate"] = (len(wins) / len(pnls)) if pnls else float("nan")
        gp, gl = sum(wins), -sum(losses)
        out["profit_factor"] = (gp / gl) if gl > 0 else float("inf")
    return out


# ----------------------------- strategie -----------------------------
def fee(notional, commission, slippage):
    return notional * (commission + slippage)


def run_buy_hold(df, capital, commission, slippage):
    price = df["close"].values
    units = (capital - fee(capital, commission, slippage)) / price[0]
    equity = units * price
    return equity, []


def run_dca(df, capital, commission, slippage, interval=7, n_tranches=None):
    price = df["close"].values
    n = len(price)
    n_tranches = n_tranches or max(1, n // interval)
    tranche = capital / n_tranches
    cash, units, deployed = capital, 0.0, 0
    equity = np.empty(n)
    for i in range(n):
        if i % interval == 0 and deployed < n_tranches and cash >= tranche:
            spend = min(tranche, cash)
            units += (spend - fee(spend, commission, slippage)) / price[i]
            cash -= spend
            deployed += 1
        equity[i] = cash + units * price[i]
    return equity, []


def run_trend(df, capital, commission, slippage, sma=200,
              bear_dca=False, dd_trigger=0.25, dca_interval=14,
              dca_tranche_frac=0.05, dca_max_frac=0.30, dd_window=90):
    """trend_core (bear_dca=False) oppure trend_dca (bear_dca=True)."""
    price = df["close"].values
    n = len(price)
    sma_arr = pd.Series(price).rolling(sma).mean().values
    roll_high = pd.Series(price).rolling(dd_window, min_periods=1).max().values

    cash, units = capital, 0.0
    equity = np.empty(n)
    trades = []
    in_trend_position = False        # True = posizione di trend (si esce in downtrend); False+units = accumulo (si tiene)
    cost_basis = 0.0                 # cassa cumulata spesa per la posizione corrente
    last_dca, dca_deployed = -10**9, 0.0

    for i in range(n):
        in_uptrend = (not np.isnan(sma_arr[i])) and price[i] > sma_arr[i]

        if in_uptrend:
            if not in_trend_position:            # da flat o da accumulo → vai full invest
                spend = cash
                if spend > 0:
                    units += (spend - fee(spend, commission, slippage)) / price[i]
                    cost_basis += spend
                    cash = 0.0
                in_trend_position = True
            # se già investito: tieni
        else:                                    # downtrend
            if in_trend_position:                # esci dalla posizione di trend
                proceeds = units * price[i] - fee(units * price[i], commission, slippage)
                trades.append({"pnl": proceeds - cost_basis})
                cash, units = proceeds, 0.0
                in_trend_position, cost_basis = False, 0.0
                last_dca, dca_deployed = -10**9, 0.0
            elif bear_dca:                        # accumulo nel ribasso profondo (si TIENE)
                dd = price[i] / roll_high[i] - 1.0
                budget_left = dca_max_frac * capital - dca_deployed
                if dd <= -dd_trigger and budget_left > 0 and (i - last_dca) >= dca_interval:
                    spend = min(dca_tranche_frac * capital, cash, budget_left)
                    if spend > 0:
                        units += (spend - fee(spend, commission, slippage)) / price[i]
                        cash -= spend
                        cost_basis += spend
                        dca_deployed += spend
                        last_dca = i

        equity[i] = cash + units * price[i]

    if units > 0:                                          # posizione ancora aperta a fine serie (mark-to-market)
        proceeds = units * price[-1] - fee(units * price[-1], commission, slippage)
        trades.append({"pnl": proceeds - cost_basis})
    return equity, trades


# ----------------------------- main -----------------------------
def fmt(x, pct=False):
    if x != x:  # NaN
        return "  n/a"
    return f"{x*100:+.1f}%" if pct else f"{x:.2f}"


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv")
    src.add_argument("--symbol")
    ap.add_argument("--period", default="3y")
    ap.add_argument("--interval", default="1d")
    ap.add_argument("--capital", type=float, default=318.0)
    ap.add_argument("--sma", type=int, default=200, help="periodo SMA del filtro di regime")
    ap.add_argument("--commission", type=float, default=0.004, help="per lato (Kraken taker ~0.004)")
    ap.add_argument("--slippage", type=float, default=0.0005)
    ap.add_argument("--dd-trigger", type=float, default=0.25, help="drawdown per attivare il bear-DCA")
    ap.add_argument("--save", default=None, help="prefisso file per salvare equity CSV/PNG")
    args = ap.parse_args()

    df = load_csv(args.csv) if args.csv else load_yf(args.symbol, args.period, args.interval)
    label = args.csv or args.symbol
    if len(df) < args.sma + 30:
        print(f"ATTENZIONE: solo {len(df)} barre; con SMA{args.sma} il test è poco significativo.")

    strategies = {
        "Buy & Hold":  run_buy_hold(df, args.capital, args.commission, args.slippage),
        "DCA":         run_dca(df, args.capital, args.commission, args.slippage),
        f"Trend (SMA{args.sma})": run_trend(df, args.capital, args.commission, args.slippage, sma=args.sma),
        "Trend + BearDCA": run_trend(df, args.capital, args.commission, args.slippage,
                                     sma=args.sma, bear_dca=True, dd_trigger=args.dd_trigger),
    }

    print("=" * 92)
    print(f" BACKTEST v3  |  {label}  |  {df['date'].iloc[0].date()} → {df['date'].iloc[-1].date()}  "
          f"|  fee/lato {args.commission*100:.2f}% + slip {args.slippage*100:.3f}%")
    print("=" * 92)
    hdr = f"{'Strategia':<18}{'Ritorno':>10}{'CAGR':>9}{'Sharpe':>8}{'Sortino':>9}{'MaxDD':>9}{'Calmar':>8}{'Trade':>7}{'Win%':>7}{'PF':>7}"
    print(hdr); print("-" * 92)
    results = {}
    for name, (equity, trades) in strategies.items():
        m = metrics_from_equity(equity, df["date"], trades)
        results[name] = (equity, m)
        print(f"{name:<18}{fmt(m['total_return'],1):>10}{fmt(m['cagr'],1):>9}{fmt(m['sharpe']):>8}"
              f"{fmt(m['sortino']):>9}{fmt(m['max_dd'],1):>9}{fmt(m['calmar']):>8}"
              f"{m['n_trades']:>7}{fmt(m['win_rate'],1):>7}{fmt(m['profit_factor']):>7}")
    print("=" * 92)
    print("Lettura onesta: se 'Trend' e 'Trend+BearDCA' non battono DCA su Sharpe E MaxDD,")
    print("la complessità non è giustificata. Ripeti su 2 periodi diversi (walk-forward).")

    if args.save:
        out = pd.DataFrame({"date": df["date"]})
        for name, (equity, _) in results.items():
            out[name] = equity
        out.to_csv(f"{args.save}.csv", index=False)
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            plt.figure(figsize=(11, 5))
            for name, (equity, _) in results.items():
                plt.plot(df["date"], equity, label=name)
            plt.legend(); plt.title(f"Equity — {label}"); plt.ylabel("Valore"); plt.grid(alpha=.3)
            plt.tight_layout(); plt.savefig(f"{args.save}.png", dpi=120)
            print(f"Salvati: {args.save}.csv e {args.save}.png")
        except Exception as e:
            print(f"CSV salvato; PNG saltato ({e}).")


if __name__ == "__main__":
    main()

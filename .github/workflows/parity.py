"""Compare the TypeScript engine against the original Python engine in the Orallexa repo."""
import json, sys
import numpy as np, pandas as pd
repo, out = sys.argv[1], sys.argv[2]
sys.path.insert(0, repo)
from skills.technical_analysis_v2 import TechnicalAnalysisSkillV2
from engine.strategies import STRATEGY_REGISTRY, STRATEGY_DEFAULT_PARAMS
from engine.backtest import simple_backtest
from engine.evaluation import evaluate

ts = json.load(open(f"{out}/ts_results.json"))
fails = 0
for seed, res in ts.items():
    df = pd.read_csv(f"{out}/bars_{seed}.csv", parse_dates=["Date"], index_col="Date")
    df = TechnicalAnalysisSkillV2(df).add_indicators().copy()
    for k, vals in res["indicators"].items():
        a = df[k].to_numpy(dtype=float); b = np.array([np.nan if v is None else v for v in vals], dtype=float)
        ok = np.allclose(a, b, rtol=1e-6, atol=1e-6, equal_nan=True)
        if not ok:
            fails += 1; idx = np.where(~np.isclose(a, b, rtol=1e-6, atol=1e-6, equal_nan=True))[0][:3]
            print(f"seed {seed} indicator {k} MISMATCH at {idx}: py={a[idx]} ts={b[idx]}")
    for name, r in res["strategies"].items():
        sig = STRATEGY_REGISTRY[name](df, STRATEGY_DEFAULT_PARAMS[name])
        mism = int((sig.to_numpy() != np.array(r["signal"])).sum())
        bt = simple_backtest(df.assign(signal=sig.values)); ev = evaluate(bt)
        dr = abs(ev["total_return"] - r["total_return"]); ds = abs(ev["sharpe"] - r["sharpe"]); dd = abs(ev["max_drawdown"] - r["max_drawdown"])
        status = "OK " if mism == 0 and max(dr, ds, dd) < 1e-6 else "BAD"
        if status == "BAD": fails += 1
        print(f"{status} seed={seed:>4} {name:<19} signal mismatches={mism:<3} return py={ev['total_return']:+.4f} ts={r['total_return']:+.4f}  sharpe py={ev['sharpe']:+.3f} ts={r['sharpe']:+.3f}")
print("PARITY FAILURES:", fails)
sys.exit(1 if fails else 0)

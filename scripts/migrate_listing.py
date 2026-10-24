#!/usr/bin/env python3
"""migrate_listing.py — pindahkan listing #1 dari pasar v1 ke v2 lewat agentic wallet.
Urutan: cancel di v1 -> approve ke v2 -> list di v2. Semua preview dulu, baru execute.
"""
import json
import subprocess
import sys
import time
import urllib.request

BAW = "/home/ubuntu/.npm-global/bin/baw"
ME = "0xdcdB85c9CaD6aaf82528C60FC36ED1F9cBF6c732"
RPC = "https://bsc-dataseed.bnbchain.org"
CALLS = json.load(open("/tmp/migrate_calls.json"))


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        out = json.loads(r.read())
    return out.get("result")


def baw(*args, timeout=180):
    p = subprocess.run([BAW] + list(args) + ["--json"], capture_output=True, text=True, timeout=timeout)
    try:
        return json.loads(p.stdout)
    except Exception:
        return {"success": False, "raw": (p.stdout or p.stderr)[:300]}


def do(name):
    c = CALLS[name]
    pv = baw("contract-call", "preview", "--binanceChainId", "56", "--from", ME,
             "--to", c["to"], "--value", "0", "--inputData", c["data"])
    if not pv.get("success"):
        print(name, "PREVIEW GAGAL:", json.dumps(pv)[:250])
        return False
    rid = pv["data"]["requestId"]
    sim = (pv["data"].get("simulationResult") or {})
    print(f"{name}: preview ok · sim={sim.get('simulationCode')} err={sim.get('simulationErrorDetail')}")
    ex = baw("contract-call", "execute", "--requestId", rid)
    d = ex.get("data") or {}
    print(f"{name}: execute status={d.get('status')} tx={d.get('txHash')}")
    return bool(d.get("txHash"))


def main():
    for name in ["cancel_v1", "approve_v2", "list_v2"]:
        if not do(name):
            print("STOP di", name)
            sys.exit(1)
        time.sleep(6)

    v2 = "0x36c8F300fAa5F470cB5E84F641bc21647c58aefd"
    sel = "0x" + "9d6b0a1d"  # placeholder, diganti di bawah
    data = "0x" + subprocess.run(
        ["node", "-e", "const{ethers}=require('/home/ubuntu/projects/lodepass/node_modules/ethers');console.log(ethers.id('listing(uint256)').slice(2,10))"],
        capture_output=True, text=True).stdout.strip() + format(1, "064x")
    res = rpc("eth_call", [{"to": v2, "data": data}, "latest"])
    raw = res[2:]
    seller = "0x" + raw[24:64]
    price = int(raw[64:128], 16) / 1e18
    expiry = int(raw[128:192], 16)
    print(f"\nverifikasi v2 listing(1): seller={seller} price={price} BNB expiry={expiry}")


if __name__ == "__main__":
    main()

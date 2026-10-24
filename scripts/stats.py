#!/usr/bin/env python3
"""stats.py - real Lodepass numbers read from chain (for daily posts). Nothing invented."""
import json
import time
import urllib.request

LODE = "0x31b074C8e77e44F29df285F19d4fc76E6D927d01"
MKT = "0xf607c6aD07c173056B7D4D63d0c9d26Ad9D3f4E2"
RPC = "https://bsc-dataseed.bnbchain.org"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        out = json.loads(r.read())
    if "result" not in out:
        raise RuntimeError(out.get("error"))
    return out["result"]


def call(sig, *args):
    data = sig + "".join(format(a, "064x") for a in args)
    res = rpc("eth_call", [{"to": LODE, "data": data}, "latest"])
    return int(res, 16) if res and res != "0x" else 0


def main():
    minted = call("0xa2309ff8")            # totalMinted()
    burned = call("0x1a5f5c0f") if False else None
    # totalBurned() selector
    # read through the real selectors below
    import subprocess
    def selector(sig):
        return subprocess.run(
            ["node", "-e", f"const{{ethers}}=require('/home/ubuntu/projects/lodepass/node_modules/ethers');console.log(ethers.id('{sig}').slice(0,10))"],
            capture_output=True, text=True).stdout.strip()

    def read(sig):
        s = selector(sig)
        res = rpc("eth_call", [{"to": LODE, "data": s}, "latest"])
        return int(res, 16) if res and res != "0x" else 0

    total_minted = read("totalMinted()")
    total_burned = read("totalBurned()")
    pool = read("rewardPool()")
    price = read("priceWei()")
    bal = int(rpc("eth_getBalance", [LODE, "latest"]), 16)

    print(f"totalMinted  : {total_minted}")
    print(f"totalBurned : {total_burned}")
    print(f"rewardPool  : {pool/1e18:.6f} BNB")
    print(f"contract balance: {bal/1e18:.6f} BNB ({'equals pool ✓' if bal == pool else 'DIFFERS from pool!'})")
    print(f"priceWei    : {price/1e18:.6f} BNB")
    print(f"time        : {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""mint_first.py - wait for the Lodepass mint to open, then mint 1 FREE piece from the .ai wallet.

The first piece per wallet is free (FREE_PER_WALLET=1), so only gas is paid (~0.000014 BNB).
Verify the result from the Transfer event and balanceOf, not from a backend response.
"""
import json
import subprocess
import time
import urllib.request

LODE = "0x31b074C8e77e44F29df285F19d4fc76E6D927d01"
ME = "0xdcdB85c9CaD6aaf82528C60FC36ED1F9cBF6c732"
RPC = "https://bsc-dataseed.bnbchain.org"
BAW = "/home/ubuntu/.npm-global/bin/baw"
LOG = "/home/ubuntu/projects/lodepass/mint_first.log"


def log(m):
    line = f"[{time.strftime('%H:%M:%S')}] {m}"
    print(line, flush=True)
    open(LOG, "a").write(line + "\n")


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read()).get("result")


def call_data(sig_selector, *args):
    data = sig_selector
    for a in args:
        data += format(a, "064x")
    return data


def main():
    start = int(rpc("eth_call", [{"to": LODE, "data": "0x78e97925"}, "latest"]), 16)
    while int(time.time()) < start + 5:
        time.sleep(15)
    log("mint dibuka, mulai")

    data = call_data("0xa0712d68", 1)  # mint(uint256) = 0xa0712d68
    out = subprocess.run(
        [BAW, "contract-call", "preview", "--binanceChainId", "56", "--from", ME,
         "--to", LODE, "--value", "0", "--inputData", data, "--json"],
        capture_output=True, text=True, timeout=180,
    )
    pj = json.loads(out.stdout)
    if not pj.get("success"):
        log("preview GAGAL: " + out.stdout[:300])
        return
    rid = pj["data"]["requestId"]
    log(f"preview ok · requestId {rid}")

    out = subprocess.run([BAW, "contract-call", "execute", "--requestId", rid, "--json"],
                         capture_output=True, text=True, timeout=240)
    ej = json.loads(out.stdout)
    tx = (ej.get("data") or {}).get("txHash")
    log(f"execute: {json.dumps(ej.get('data'))[:200]}")
    if not tx:
        return

    # verifikasi dari chain
    rc = None
    for _ in range(30):
        rc = rpc("eth_getTransactionReceipt", [tx])
        if rc:
            break
        time.sleep(3)
    if not rc:
        log("receipt never appeared")
        return
    log(f"status {rc.get('status')} · gas {int(rc['gasUsed'],16)}")

    transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
    ids = []
    for lg in rc.get("logs", []):
        t = lg.get("topics", [])
        if t and t[0].lower() == transfer and len(t) == 4 and t[2][-40:].lower() == ME[2:].lower():
            ids.append(int(t[3], 16))
    bal = int(rpc("eth_call", [{"to": LODE, "data": "0x70a08231" + ME[2:].rjust(64, "0")}, "latest"]), 16)
    log(f"tokenId: {ids} · balanceOf: {bal} · tx {tx}")
    json.dump({"tx": tx, "tokenIds": ids, "balance": bal}, open("/home/ubuntu/projects/lodepass/mint_first.json", "w"), indent=1)


if __name__ == "__main__":
    main()

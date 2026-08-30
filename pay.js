/* Cheesecake Bob — Solana checkout (mainnet SOL) */
(function () {
  const MERCHANT = "68wcbLLBULTWKBriRq5BmgYw6fQREV54e59hRqrWWtj8";
  const RPC = "https://api.mainnet-beta.solana.com";
  const CAKES = {
    classic: { name: "Classic New York", usd: 42 },
    berry: { name: "Fresh Berry", usd: 48 },
    chocolate: { name: "Chocolate Swirl", usd: 48 },
    lemon: { name: "Lemon Zest", usd: 46 },
    seasonal: { name: "Seasonal Special", usd: 50 }
  };

  const $ = function (id) { return document.getElementById(id); };
  let priceUsd = null;
  let provider = null;

  function wallet() {
    if (window.solana && window.solana.isPhantom) return window.solana;
    if (window.solflare) return window.solflare;
    return window.solana || null;
  }

  function setStatus(msg, ok) {
    const el = $("pay-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mt-4 text-sm " + (ok === true ? "text-gold" : ok === false ? "text-rastaRed" : "text-cream/70");
  }

  async function solUsd() {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
      const j = await r.json();
      priceUsd = j && j.solana && j.solana.usd;
    } catch (e) {
      priceUsd = null;
    }
    paintQuote();
  }

  function selected() {
    const key = ($("cake") || {}).value || "classic";
    return CAKES[key] || CAKES.classic;
  }

  function solAmount() {
    const cake = selected();
    if (!priceUsd || priceUsd <= 0) return null;
    return cake.usd / priceUsd;
  }

  function paintQuote() {
    const cake = selected();
    const sol = solAmount();
    const q = $("pay-quote");
    if (!q) return;
    if (!sol) {
      q.textContent = cake.name + " · $" + cake.usd + " USD · SOL rate loading…";
      return;
    }
    q.textContent = cake.name + " · $" + cake.usd + " ≈ " + sol.toFixed(4) + " SOL";
  }

  async function connect() {
    provider = wallet();
    if (!provider) {
      setStatus("Install Phantom or Solflare, then refresh.", false);
      window.open("https://phantom.app/", "_blank");
      return null;
    }
    const res = await provider.connect();
    const pk = (res && res.publicKey) ? res.publicKey.toString() : (provider.publicKey && provider.publicKey.toString());
    $("pay-wallet").textContent = pk ? (pk.slice(0, 4) + "…" + pk.slice(-4)) : "—";
    setStatus("Wallet connected.", true);
    return pk;
  }

  async function pay() {
    try {
      if (!window.solanaWeb3) {
        setStatus("Solana library failed to load. Refresh and try again.", false);
        return;
      }
      const pk = await connect();
      if (!pk) return;
      const sol = solAmount();
      if (!sol) {
        setStatus("Waiting on SOL price. Try again in a few seconds.", false);
        await solUsd();
        return;
      }
      const cake = selected();
      const note = (($("note") || {}).value || "").trim();
      const name = (($("buyer") || {}).value || "").trim();
      setStatus("Approve " + sol.toFixed(4) + " SOL in your wallet…");

      const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = window.solanaWeb3;
      const conn = new Connection(RPC, "confirmed");
      const from = new PublicKey(pk);
      const to = new PublicKey(MERCHANT);
      const lamports = Math.max(1, Math.round(sol * LAMPORTS_PER_SOL));
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports }));
      tx.feePayer = from;
      const { blockhash } = await conn.getLatestBlockhash("finalized");
      tx.recentBlockhash = blockhash;
      const signed = await provider.signAndSendTransaction(tx);
      const sig = signed.signature || signed;
      setStatus("Sent. Confirming on Solana…");
      await conn.confirmTransaction(sig, "confirmed");
      const recap = cake.name + " paid by " + (name || pk.slice(0, 6)) + (note ? (" — " + note) : "");
      setStatus("Paid. Signature " + sig.slice(0, 8) + "… Bob will reach out. " + recap, true);
      try { localStorage.setItem("cb_last_pay", JSON.stringify({ sig: sig, cake: cake.name, usd: cake.usd, sol: sol, at: Date.now() })); } catch (e) {}
    } catch (e) {
      setStatus((e && e.message) ? e.message : "Payment cancelled.", false);
    }
  }

  function wire() {
    const cake = $("cake");
    if (cake) cake.addEventListener("change", paintQuote);
    const cbtn = $("connect-sol");
    if (cbtn) cbtn.addEventListener("click", function () { connect().catch(function (e) { setStatus(e.message, false); }); });
    const pbtn = $("pay-sol");
    if (pbtn) pbtn.addEventListener("click", pay);
    document.querySelectorAll("[data-cake]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (cake) cake.value = btn.getAttribute("data-cake");
        paintQuote();
        document.getElementById("order").scrollIntoView({ behavior: "smooth" });
      });
    });
    paintQuote();
    solUsd();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

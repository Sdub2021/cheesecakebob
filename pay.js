/* Buyer pays from THEIR wallet. Site never holds keys. */
(function () {
  const MERCHANT = "68wcbLLBULTWKBriRq5BmgYw6fQREV54e59hRqrWWtj8";
  const RPC = "https://api.mainnet-beta.solana.com";
  const QUOTE_MS = 90000;
  const SITE = (location.origin + location.pathname).replace(/index\.html$/, "");
  const CAKES = {
    classic: { name: "Classic New York", usd: 42 },
    berry: { name: "Fresh Berry", usd: 48 },
    chocolate: { name: "Chocolate Swirl", usd: 48 },
    lemon: { name: "Lemon Zest", usd: 46 },
    seasonal: { name: "Seasonal Special", usd: 50 }
  };

  const $ = function (id) { return document.getElementById(id); };
  let priceUsd = null, quoteAt = 0, provider = null, connectedPk = null, walletName = "";

  function isMobile() { return /iPhone|iPad|Android/i.test(navigator.userAgent || ""); }
  function insecure() { return location.protocol !== "https:" && location.hostname !== "localhost"; }
  function setStatus(msg, ok) {
    const el = $("pay-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mt-3 text-sm leading-relaxed " + (ok === true ? "text-gold" : ok === false ? "text-red-300" : "text-cream/70");
  }

  function candidates() {
    const list = [];
    function add(name, p) {
      if (p && typeof p.connect === "function") list.push({ name: name, provider: p });
    }
    add("Phantom", window.phantom && window.phantom.solana);
    add("Phantom", window.solana && window.solana.isPhantom ? window.solana : null);
    add("Solflare", window.solflare);
    add("Backpack", window.backpack);
    add("Backpack", window.backpack && window.backpack.solana);
    add("Glow", window.glow);
    add("Glow", window.glowSolana);
    add("OKX", window.okxwallet && window.okxwallet.solana);
    add("Coinbase", window.coinbaseSolana);
    add("Magic Eden", window.magicEden && window.magicEden.solana);
    add("Solana", window.solana);
    const seen = [];
    return list.filter(function (w) {
      if (!w.provider || seen.indexOf(w.provider) >= 0) return false;
      seen.push(w.provider);
      return true;
    });
  }

  function getProvider() {
    const all = candidates();
    return all.length ? all[0].provider : null;
  }

  function waitProvider(ms) {
    return new Promise(function (resolve) {
      const now = getProvider();
      if (now) { resolve(now); return; }
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        window.removeEventListener("solana#initialized", finish);
        resolve(getProvider());
      }
      window.addEventListener("solana#initialized", finish);
      setTimeout(finish, ms || 2000);
    });
  }

  async function solUsd() {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { cache: "no-store" });
      const j = await r.json();
      const n = j && j.solana && Number(j.solana.usd);
      if (n > 0) { priceUsd = n; quoteAt = Date.now(); }
    } catch (e) {}
    paintQuote();
  }

  function selected() { return CAKES[($("cake") || {}).value] || CAKES.classic; }
  function solAmount() {
    if (!priceUsd || priceUsd <= 0) return null;
    return selected().usd / priceUsd;
  }
  function paintQuote() {
    const q = $("pay-quote");
    if (!q) return;
    const cake = selected();
    const sol = solAmount();
    q.textContent = sol ? cake.name + " · $" + cake.usd + " ≈ " + sol.toFixed(4) + " SOL from your wallet" : cake.name + " · $" + cake.usd + " · fetching SOL price…";
  }
  function paintWallet() {
    const el = $("pay-wallet");
    if (!el) return;
    el.textContent = connectedPk ? (walletName + " " + connectedPk.slice(0, 4) + "…" + connectedPk.slice(-4)) : "your wallet — not connected yet";
  }

  function solanaPayUri() {
    const sol = solAmount();
    if (!sol) return "";
    const cake = selected();
    const note = (($("note") || {}).value || cake.name).slice(0, 80);
    return "solana:" + MERCHANT + "?amount=" + sol.toFixed(6) +
      "&label=" + encodeURIComponent("Cheesecake Bob") +
      "&message=" + encodeURIComponent(note);
  }

  function openInPhantom() {
    location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(SITE + "#order");
  }

  async function payWithAnyWallet() {
    if (Date.now() - quoteAt > QUOTE_MS) await solUsd();
    const uri = solanaPayUri();
    if (!uri) {
      setStatus("Wait for the quote, then tap again.", false);
      return;
    }
    setStatus("Opening your wallet app. You send SOL from an address you control.");
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(uri);
    } catch (e) {}
    location.href = uri;
  }

  async function connect(opts) {
    if (insecure()) {
      setStatus("Use HTTPS so your wallet will attach.", false);
      return null;
    }
    const found = candidates();
    provider = found.length ? found[0].provider : await waitProvider(isMobile() ? 1000 : 2200);
    if (found.length) walletName = found[0].name;
    if (!provider) {
      setStatus("No browser wallet found. Tap Pay from my wallet to open Phantom, Solflare, Backpack, or any Solana Pay app you already use.", false);
      return null;
    }
    try {
      const res = await provider.connect(opts && opts.onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
      const pk = (res && res.publicKey && res.publicKey.toString()) || (provider.publicKey && provider.publicKey.toString());
      if (!pk) throw new Error("Wallet did not share an address.");
      connectedPk = pk;
      if (!walletName) walletName = "Your wallet";
      paintWallet();
      if (!(opts && opts.onlyIfTrusted)) setStatus("Using " + walletName + ". Keys stay in your app. We only request a SOL send to Bob.", true);
      return pk;
    } catch (e) {
      if (opts && opts.onlyIfTrusted) return null;
      setStatus((e && e.message) || "You declined connect.", false);
      return null;
    }
  }

  function assertTransfer(tx, from) {
    const { SystemProgram } = window.solanaWeb3;
    if (!tx.instructions || tx.instructions.length !== 1) throw new Error("Blocked: extra instructions.");
    const ix = tx.instructions[0];
    if (ix.programId.toBase58() !== SystemProgram.programId.toBase58()) throw new Error("Blocked: not a SOL transfer.");
    const dest = ix.keys && ix.keys[1] && ix.keys[1].pubkey && ix.keys[1].pubkey.toBase58();
    if (dest !== MERCHANT) throw new Error("Blocked: destination mismatch.");
    if (tx.feePayer.toBase58() !== from.toBase58()) throw new Error("Blocked: not your fee payer.");
  }

  async function payInjected() {
    if (!window.solanaWeb3) throw new Error("Refresh to load Solana.");
    if (Date.now() - quoteAt > QUOTE_MS) await solUsd();
    const sol = solAmount();
    if (!sol) throw new Error("No SOL quote yet.");
    const pk = connectedPk || await connect();
    if (!pk) return;
    const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = window.solanaWeb3;
    const from = new PublicKey(pk);
    const to = new PublicKey(MERCHANT);
    const lamports = Math.round(sol * LAMPORTS_PER_SOL);
    const conn = new Connection(RPC, "confirmed");
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports }));
    tx.feePayer = from;
    const latest = await conn.getLatestBlockhash("finalized");
    tx.recentBlockhash = latest.blockhash;
    assertTransfer(tx, from);
    provider = provider || getProvider();
    if (!provider || !provider.signAndSendTransaction) {
      await payWithAnyWallet();
      return;
    }
    setStatus("Approve in " + (walletName || "your wallet") + ": send " + sol.toFixed(4) + " SOL from your account.");
    const signed = await provider.signAndSendTransaction(tx);
    const sig = typeof signed === "string" ? signed : signed.signature;
    setStatus("Your wallet broadcast the payment. Confirming…");
    await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    setStatus("Paid from your wallet. " + selected().name + ". Sig " + String(sig).slice(0, 8) + "…", true);
    try { localStorage.setItem("cb_last_pay", JSON.stringify({ sig: sig, from: pk, cake: selected().name, at: Date.now() })); } catch (e) {}
  }

  async function pay() {
    try {
      if (getProvider()) await payInjected();
      else await payWithAnyWallet();
    } catch (e) {
      setStatus((e && e.message) || "Cancelled in your wallet.", false);
    }
  }

  function wire() {
    const cake = $("cake");
    if (cake) cake.addEventListener("change", paintQuote);
    const cbtn = $("connect-sol");
    if (cbtn) cbtn.addEventListener("click", function () { connect(); });
    const pbtn = $("pay-sol");
    if (pbtn) pbtn.addEventListener("click", pay);
    const any = $("pay-any");
    if (any) any.addEventListener("click", function () { payWithAnyWallet(); });
    const ph = $("open-phantom");
    if (ph) {
      ph.classList.toggle("hidden", !isMobile() || !!getProvider());
      ph.addEventListener("click", openInPhantom);
    }
    document.querySelectorAll("[data-cake]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (cake) cake.value = btn.getAttribute("data-cake");
        paintQuote();
        const ord = document.getElementById("order");
        if (ord) ord.scrollIntoView({ behavior: "smooth" });
      });
    });
    const tog = $("nav-toggle");
    const menu = $("nav-links");
    if (tog && menu) tog.addEventListener("click", function () { menu.classList.toggle("hidden"); });
    paintQuote();
    paintWallet();
    solUsd();
    connect({ onlyIfTrusted: true }).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

/* Cheesecake Bob — non-custodial Solana checkout. Never asks for a seed. */
(function () {
  const MERCHANT = "68wcbLLBULTWKBriRq5BmgYw6fQREV54e59hRqrWWtj8";
  const RPC = "https://api.mainnet-beta.solana.com";
  const QUOTE_MS = 90000;
  const CAKES = {
    classic: { name: "Classic New York", usd: 42 },
    berry: { name: "Fresh Berry", usd: 48 },
    chocolate: { name: "Chocolate Swirl", usd: 48 },
    lemon: { name: "Lemon Zest", usd: 46 },
    seasonal: { name: "Seasonal Special", usd: 50 }
  };

  const $ = function (id) { return document.getElementById(id); };
  let priceUsd = null;
  let quoteAt = 0;
  let provider = null;
  let connectedPk = null;

  function setStatus(msg, ok) {
    const el = $("pay-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mt-4 text-sm " + (ok === true ? "text-gold" : ok === false ? "text-red-300" : "text-cream/70");
  }

  function getProvider() {
    const phantom = (window.phantom && window.phantom.solana) || null;
    if (phantom && phantom.isPhantom) return phantom;
    if (window.solana && window.solana.isPhantom) return window.solana;
    if (window.solflare && (window.solflare.isSolflare || window.solflare.isConnected || window.solflare.connect)) return window.solflare;
    if (window.solana && window.solana.connect) return window.solana;
    return null;
  }

  function waitProvider(ms) {
    return new Promise(function (resolve) {
      const found = getProvider();
      if (found) { resolve(found); return; }
      let done = false;
      const finish = function (p) {
        if (done) return;
        done = true;
        window.removeEventListener("solana#initialized", onInit);
        resolve(p || getProvider());
      };
      function onInit() { finish(getProvider()); }
      window.addEventListener("solana#initialized", onInit);
      setTimeout(function () { finish(getProvider()); }, ms || 2500);
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
    q.textContent = cake.name + " · $" + cake.usd + " ≈ " + sol.toFixed(4) + " SOL @ $" + priceUsd.toFixed(2);
  }

  function paintWallet() {
    const el = $("pay-wallet");
    if (!el) return;
    el.textContent = connectedPk ? (connectedPk.slice(0, 4) + "…" + connectedPk.slice(-4)) : "not connected";
  }

  function insecureOrigin() {
    return location.protocol !== "https:" && location.hostname !== "localhost";
  }

  async function connect(opts) {
    if (insecureOrigin()) {
      setStatus("Open this page over HTTPS. Wallets refuse insecure origins.", false);
      return null;
    }
    provider = await waitProvider(2800);
    if (!provider) {
      setStatus("No wallet found. Use Phantom or Solflare in this browser (on phone: open the site inside the Phantom app browser).", false);
      return null;
    }
    try {
      if (provider.isConnected && provider.publicKey && opts && opts.onlyIfTrusted) {
        connectedPk = provider.publicKey.toString();
        paintWallet();
        return connectedPk;
      }
      const res = await provider.connect(opts && opts.onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
      const pk = (res && res.publicKey && res.publicKey.toString()) || (provider.publicKey && provider.publicKey.toString());
      if (!pk) throw new Error("Wallet did not return an address.");
      connectedPk = pk;
      paintWallet();
      if (!(opts && opts.onlyIfTrusted)) setStatus("Connected. Approve only a SOL transfer to Bob’s address below.", true);
      return pk;
    } catch (e) {
      if (opts && opts.onlyIfTrusted) return null;
      const msg = (e && e.message) ? e.message : "Connection rejected.";
      setStatus(msg, false);
      return null;
    }
  }

  function assertTransfer(tx, from, lamports) {
    const { SystemProgram, PublicKey } = window.solanaWeb3;
    if (!tx.instructions || tx.instructions.length !== 1) throw new Error("Refusing to sign: unexpected instruction count.");
    const ix = tx.instructions[0];
    if (ix.programId.toBase58() !== SystemProgram.programId.toBase58()) throw new Error("Refusing to sign: not a system transfer.");
    const dest = ix.keys && ix.keys[1] && ix.keys[1].pubkey && ix.keys[1].pubkey.toBase58();
    if (dest !== MERCHANT) throw new Error("Refusing to sign: destination is not Bob’s wallet.");
    if (tx.feePayer.toBase58() !== from.toBase58()) throw new Error("Refusing to sign: unexpected fee payer.");
    return true;
  }

  async function pay() {
    try {
      if (!window.solanaWeb3) {
        setStatus("Solana library did not load. Hard-refresh and try again.", false);
        return;
      }
      if (Date.now() - quoteAt > QUOTE_MS) await solUsd();
      const sol = solAmount();
      if (!sol) {
        setStatus("Could not lock a SOL price. Try again.", false);
        return;
      }
      const pk = connectedPk || await connect();
      if (!pk) return;
      const cake = selected();
      const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = window.solanaWeb3;
      const from = new PublicKey(pk);
      const to = new PublicKey(MERCHANT);
      const lamports = Math.round(sol * LAMPORTS_PER_SOL);
      if (lamports < 1000) throw new Error("Amount too small.");
      setStatus("Wallet will ask you to send " + sol.toFixed(4) + " SOL to Bob. Check the address before you approve.");

      const conn = new Connection(RPC, "confirmed");
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports }));
      tx.feePayer = from;
      const latest = await conn.getLatestBlockhash("finalized");
      tx.recentBlockhash = latest.blockhash;
      assertTransfer(tx, from, lamports);

      if (!provider) provider = getProvider();
      if (!provider || !provider.signAndSendTransaction) throw new Error("Wallet cannot send transactions in this browser.");
      const signed = await provider.signAndSendTransaction(tx);
      const sig = typeof signed === "string" ? signed : (signed.signature || signed);
      setStatus("Broadcast. Waiting for confirmation…");
      await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
      const recap = cake.name + " · $" + cake.usd;
      setStatus("Paid. " + recap + ". Signature " + String(sig).slice(0, 8) + "… Keep that for pickup.", true);
      try { localStorage.setItem("cb_last_pay", JSON.stringify({ sig: sig, cake: cake.name, usd: cake.usd, sol: sol, at: Date.now() })); } catch (e) {}
    } catch (e) {
      setStatus((e && e.message) ? e.message : "Payment cancelled.", false);
    }
  }

  function mobileHint() {
    const ua = navigator.userAgent || "";
    const mobile = /iPhone|iPad|Android/i.test(ua);
    const injected = !!(window.phantom || window.solana || window.solflare);
    if (mobile && !injected) {
      setStatus("On phone, open this URL inside the Phantom app browser (Explore → paste the site). Safari/Chrome cannot see the wallet.", false);
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
        const ord = document.getElementById("order");
        if (ord) ord.scrollIntoView({ behavior: "smooth" });
      });
    });
    paintQuote();
    paintWallet();
    solUsd();
    mobileHint();
    connect({ onlyIfTrusted: true }).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

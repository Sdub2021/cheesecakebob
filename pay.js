/* Cheesecake Bob — non-custodial SOL checkout. No seeds. One transfer. */
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
  let priceUsd = null, quoteAt = 0, provider = null, connectedPk = null;

  function isMobile() { return /iPhone|iPad|Android/i.test(navigator.userAgent || ""); }
  function insecure() { return location.protocol !== "https:" && location.hostname !== "localhost"; }

  function setStatus(msg, ok) {
    const el = $("pay-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "mt-3 text-sm leading-relaxed " + (ok === true ? "text-gold" : ok === false ? "text-red-300" : "text-cream/70");
  }

  function getProvider() {
    const ph = window.phantom && window.phantom.solana;
    if (ph && ph.isPhantom) return ph;
    if (window.solana && window.solana.isPhantom) return window.solana;
    if (window.solflare && window.solflare.connect) return window.solflare;
    if (window.solana && window.solana.connect) return window.solana;
    return null;
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
      setTimeout(finish, ms || 2200);
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
    return CAKES[($("cake") || {}).value] || CAKES.classic;
  }

  function solAmount() {
    if (!priceUsd || priceUsd <= 0) return null;
    return selected().usd / priceUsd;
  }

  function paintQuote() {
    const q = $("pay-quote");
    if (!q) return;
    const cake = selected();
    const sol = solAmount();
    q.textContent = sol
      ? cake.name + " · $" + cake.usd + " ≈ " + sol.toFixed(4) + " SOL"
      : cake.name + " · $" + cake.usd + " · fetching SOL price…";
  }

  function paintWallet() {
    const el = $("pay-wallet");
    if (el) el.textContent = connectedPk ? (connectedPk.slice(0, 4) + "…" + connectedPk.slice(-4)) : "not connected";
  }

  function solanaPayUri() {
    const sol = solAmount();
    if (!sol) return "";
    const cake = selected();
    const note = (($("note") || {}).value || cake.name).slice(0, 80);
    return "solana:" + MERCHANT +
      "?amount=" + sol.toFixed(6) +
      "&label=" + encodeURIComponent("Cheesecake Bob") +
      "&message=" + encodeURIComponent(note) +
      "&memo=" + encodeURIComponent(cake.name);
  }

  function openInPhantom() {
    const browse = "https://phantom.app/ul/browse/" + encodeURIComponent(SITE + "#order");
    location.href = browse;
  }

  async function connect(opts) {
    if (insecure()) {
      setStatus("Wallets block this origin. Use HTTPS.", false);
      return null;
    }
    provider = await waitProvider(isMobile() ? 1200 : 2500);
    if (!provider) {
      if (isMobile()) {
        setStatus("No wallet in this browser. Tap Open in Phantom, or paste this site into Phantom → Explore.", false);
      } else {
        setStatus("Install the Phantom or Solflare extension, then refresh.", false);
      }
      return null;
    }
    try {
      const res = await provider.connect(opts && opts.onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
      const pk = (res && res.publicKey && res.publicKey.toString()) || (provider.publicKey && provider.publicKey.toString());
      if (!pk) throw new Error("Wallet returned no address.");
      connectedPk = pk;
      paintWallet();
      if (!(opts && opts.onlyIfTrusted)) setStatus("Connected. Pay only sends SOL to the address on this page.", true);
      return pk;
    } catch (e) {
      if (opts && opts.onlyIfTrusted) return null;
      setStatus((e && e.message) || "Connection rejected.", false);
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
    if (tx.feePayer.toBase58() !== from.toBase58()) throw new Error("Blocked: fee payer mismatch.");
  }

  async function payInjected() {
    if (!window.solanaWeb3) throw new Error("Solana library missing. Hard-refresh.");
    if (Date.now() - quoteAt > QUOTE_MS) await solUsd();
    const sol = solAmount();
    if (!sol) throw new Error("Could not lock a SOL price.");
    const pk = connectedPk || await connect();
    if (!pk) return;
    const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = window.solanaWeb3;
    const from = new PublicKey(pk);
    const to = new PublicKey(MERCHANT);
    const lamports = Math.round(sol * LAMPORTS_PER_SOL);
    if (lamports < 1000) throw new Error("Amount too small.");
    const conn = new Connection(RPC, "confirmed");
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: lamports }));
    tx.feePayer = from;
    const latest = await conn.getLatestBlockhash("finalized");
    tx.recentBlockhash = latest.blockhash;
    assertTransfer(tx, from);
    provider = provider || getProvider();
    if (!provider || !provider.signAndSendTransaction) throw new Error("This wallet cannot send from this browser.");
    setStatus("Approve " + sol.toFixed(4) + " SOL to Bob. Read the address in Phantom first.");
    const signed = await provider.signAndSendTransaction(tx);
    const sig = typeof signed === "string" ? signed : signed.signature;
    setStatus("Broadcast. Confirming…");
    await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed");
    setStatus("Paid " + selected().name + ". Sig " + String(sig).slice(0, 8) + "… Save that for pickup.", true);
    try { localStorage.setItem("cb_last_pay", JSON.stringify({ sig: sig, cake: selected().name, usd: selected().usd, sol: sol, at: Date.now() })); } catch (e) {}
  }

  async function pay() {
    try {
      if (getProvider()) {
        await payInjected();
        return;
      }
      if (isMobile()) {
        const uri = solanaPayUri();
        if (!uri) {
          setStatus("Wait for the SOL quote, then tap Pay again.", false);
          await solUsd();
          return;
        }
        setStatus("Opening wallet with a Solana Pay request. Confirm destination is Bob.");
        location.href = uri;
        return;
      }
      setStatus("No wallet detected. Install Phantom, then refresh.", false);
    } catch (e) {
      setStatus((e && e.message) || "Payment cancelled.", false);
    }
  }

  function wire() {
    const cake = $("cake");
    if (cake) cake.addEventListener("change", paintQuote);
    const cbtn = $("connect-sol");
    if (cbtn) cbtn.addEventListener("click", function () { connect(); });
    const pbtn = $("pay-sol");
    if (pbtn) pbtn.addEventListener("click", pay);
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
    if (isMobile() && !getProvider()) {
      setStatus("On a phone, open this page inside Phantom (Explore) or tap Open in Phantom.");
    }
    connect({ onlyIfTrusted: true }).catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

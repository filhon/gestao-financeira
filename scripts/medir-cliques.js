// Mede a resposta de cada clique. Cole no console do DevTools com o sistema
// aberto (produção ou `npm run build && npm start`; em dev não há pré-carga) e
// use normalmente. Rode `__cliques()` para ver a tabela.
//   pintura  = do clique até a tela reagir (o que o INP mede)
//   pronto   = do clique até a tela ficar sem skeleton e sem lista esmaecida
//   estavel  = do clique até a última mudança no conteúdo (dados carregados)
//   servidor = do clique até a resposta da última function ou /api/ chamada
//   rede = duração dessa chamada no navegador, com preflight (a execução está
//     no log `tempo_status` da function)
//   js, layoutForcado, pinturaQuadro = divisão do quadro longo do clique
//   destravou = do clique até a linha sair de "Confirmando…", "Aprovando…" etc.
// Espere a tela assentar entre um clique e outro: um clique novo encerra a
// medição do anterior, e essa linha sai com `cortado` marcado.
(() => {
  const linhas = [];
  let aberta = null;
  const SILENCIO = 3000;

  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      if (e.name !== "click") continue;
      const linha = linhas.find((l) => Math.abs(l.t0 - e.startTime) < 1);
      if (!linha) continue;
      linha.pintura = Math.round(e.duration);
      linha.espera = Math.round(e.processingStart - e.startTime);
      linha.codigo = Math.round(e.processingEnd - e.processingStart);
      linha.desenho = Math.round(e.startTime + e.duration - e.processingEnd);
    }
  }).observe({ type: "event", durationThreshold: 16 });

  // Quadro longo (50 ms+) do clique: JS, layout forçado e o restante da pintura.
  new PerformanceObserver((lista) => {
    for (const q of lista.getEntries()) {
      const linha = linhas.find(
        (l) => l.t0 >= q.startTime - 16 && l.t0 < q.startTime + q.duration,
      );
      if (!linha) continue;
      linha.js = Math.round(
        q.scripts.reduce((soma, s) => soma + s.duration, 0),
      );
      linha.layoutForcado = Math.round(
        q.scripts.reduce((soma, s) => soma + s.forcedStyleAndLayoutDuration, 0),
      );
      linha.pinturaQuadro = Math.round(
        q.startTime + q.duration - (q.renderStart || q.startTime + q.duration),
      );
    }
  }).observe({ type: "long-animation-frame" });

  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      if (!/cloudfunctions\.net|\/api\//.test(e.name)) continue;
      const linha = linhas.findLast((l) => l.t0 <= e.startTime);
      if (linha && e.responseEnd - linha.t0 > (linha.servidor ?? 0)) {
        linha.servidor = Math.round(e.responseEnd - linha.t0);
        linha.chamada = new URL(e.name).pathname;
        linha.rede = Math.round(e.duration);
      }
    }
  }).observe({ type: "resource" });

  document.addEventListener(
    "click",
    (e) => {
      const alvo =
        e.target.closest?.("a,button,[role=tab],[data-row-id]") ?? e.target;
      const linha = {
        alvo: (
          alvo.innerText ||
          alvo.getAttribute?.("aria-label") ||
          alvo.tagName
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40),
        t0: e.timeStamp,
        pintura: "<16",
        estavel: 0,
      };
      if (aberta) aberta.cortado = true;
      linhas.push(linha);
      aberta = linha;
    },
    true,
  );

  // O toast some segundos depois e não é resposta do clique.
  const contaComoMudanca = (r) => {
    const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    if (el?.closest("[data-sonner-toaster]")) return false;
    const nos = [...r.addedNodes, ...r.removedNodes];
    return (
      nos.length === 0 ||
      !nos.every((n) =>
        n.matches?.("[data-sonner-toast],[data-sonner-toaster]"),
      )
    );
  };

  // Linha travada: vale até o rótulo sair da tela, mesmo com outro clique.
  const TRAVA = /Confirmando…|Aprovando…|Rejeitando…|Enviando…|Atualizando…/;
  let travada = null;
  const acompanhaTrava = (registros) => {
    if (travada) {
      if (TRAVA.test(document.body.textContent)) return;
      travada.destravou = Math.round(performance.now() - travada.t0);
      travada = null;
    } else if (
      registros.some((r) =>
        [...r.addedNodes].some((n) => TRAVA.test(n.textContent)),
      )
    ) {
      travada = linhas.at(-1) ?? null;
    }
  };

  new MutationObserver((registros) => {
    acompanhaTrava(registros);
    if (!aberta || !registros.some(contaComoMudanca)) return;
    aberta.estavel = Math.round(performance.now() - aberta.t0);
    if (
      aberta.pronto === undefined &&
      !document.querySelector('[aria-busy="true"],.animate-pulse')
    )
      aberta.pronto = aberta.estavel;
  }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Fecha a medição depois de um tempo sem mudança no conteúdo.
  setInterval(() => {
    if (aberta && performance.now() - aberta.t0 - aberta.estavel > SILENCIO)
      aberta = null;
  }, 500);

  window.__cliques = () =>
    console.table(linhas, [
      "alvo",
      "pintura",
      "espera",
      "codigo",
      "desenho",
      "js",
      "layoutForcado",
      "pinturaQuadro",
      "pronto",
      "estavel",
      "servidor",
      "chamada",
      "rede",
      "destravou",
      "cortado",
    ]);
  // Tamanho do cache do Firestore no navegador e tempo para ler tudo dele. Toda
  // consulta nova varre esses documentos antes de ir ao servidor.
  window.__cacheFirestore = async () => {
    const dbs = await indexedDB.databases();
    const nome = dbs.find((d) => /^firestore\/.*\/main$/.test(d.name))?.name;
    if (!nome) return console.log("Cache do Firestore não encontrado.");
    const banco = await new Promise((ok, erro) => {
      const req = indexedDB.open(nome);
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    });
    const loja = [...banco.objectStoreNames].find((n) =>
      n.startsWith("remoteDocuments"),
    );
    const inicio = performance.now();
    const docs = await new Promise((ok, erro) => {
      const req = banco.transaction(loja).objectStore(loja).getAll();
      req.onsuccess = () => ok(req.result);
      req.onerror = () => erro(req.error);
    });
    const ms = Math.round(performance.now() - inicio);
    banco.close();
    console.log(
      `Cache do Firestore: ${docs.length} documentos, leitura em ${ms} ms.`,
    );
  };
  console.log(
    "Medindo cliques. Use o sistema e rode __cliques() e __cacheFirestore().",
  );
})();

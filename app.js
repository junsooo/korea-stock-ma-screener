const $ = (selector) => document.querySelector(selector);

const state = {
  dataset: null,
  matches: [],
  selectedCode: null,
  loading: false,
  hasSearched: false,
  excludedStatus: 0,
  error: ""
};

const els = {
  appTitle: $("#appTitle"),
  appSubtitle: $("#appSubtitle"),
  keyword: $("#keyword"),
  maWindow: $("#maWindow"),
  recentDays: $("#recentDays"),
  declineDays: $("#declineDays"),
  tolerance: $("#tolerance"),
  market: $("#market"),
  strictMode: $("#strictMode"),
  strictCopy: $("#strictCopy"),
  excludeHalted: $("#excludeHalted"),
  runSearch: $("#runSearch"),
  reset: $("#reset"),
  matchCount: $("#matchCount"),
  universeCount: $("#universeCount"),
  asOf: $("#asOf"),
  excludedCount: $("#excludedCount"),
  dataSource: $("#dataSource"),
  results: $("#results"),
  detailTitle: $("#detailTitle"),
  detailMeta: $("#detailMeta"),
  signalBadge: $("#signalBadge"),
  explain: $("#explain"),
  chart: $("#chart")
};

function formatNumber(value) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function maDays() {
  return Number(els.maWindow.value) || 120;
}

function maLabel() {
  return `${maDays()}일선`;
}

function updateMovingAverageCopy() {
  const label = maLabel();
  const recent = Number(els.recentDays.value) || 20;
  document.title = `한국 주식 ${label} 전환 검색기`;
  els.appTitle.textContent = `${label} 전환 검색`;
  els.appSubtitle.textContent = `하락하던 ${label}이 최근 ${recent}거래일 상승으로 돌아선 종목`;
  els.strictCopy.textContent = `엄격 모드: 기간 내 모든 ${label} 기울기가 조건과 일치해야 함`;
}

function queryString() {
  const params = new URLSearchParams({
    q: els.keyword.value.trim(),
    ma: els.maWindow.value,
    recent: els.recentDays.value,
    decline: els.declineDays.value,
    tolerance: els.tolerance.value,
    strict: els.strictMode.checked ? "1" : "0",
    excludeHalted: els.excludeHalted.checked ? "1" : "0",
    market: els.market.value
  });
  return params.toString();
}

function getSettings() {
  return {
    maWindow: Number(els.maWindow.value),
    recentDays: Number(els.recentDays.value),
    declineDays: Number(els.declineDays.value),
    tolerance: Number(els.tolerance.value),
    strictMode: els.strictMode.checked,
    excludeHalted: els.excludeHalted.checked,
    market: els.market.value,
    keyword: els.keyword.value.trim().toLowerCase()
  };
}

async function loadDataset() {
  if (state.dataset) return state.dataset;
  const response = await fetch("data/stock-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error("정적 데이터 파일을 아직 찾을 수 없습니다.");
  state.dataset = await response.json();
  return state.dataset;
}

async function runSearch() {
  updateMovingAverageCopy();
  state.loading = true;
  state.hasSearched = true;
  state.error = "";
  renderShell();

  try {
    let payload;
    try {
      await loadDataset();
      payload = searchStatic();
    } catch (_staticError) {
      payload = await searchApiFallback();
    }

    state.matches = payload.matches;
    state.selectedCode = state.matches[0]?.code ?? null;
    state.excludedStatus = payload.excludedStatus || 0;
    els.universeCount.textContent = payload.scanned;
    els.asOf.textContent = payload.asOf || "-";
    els.dataSource.textContent = payload.source;
  } catch (error) {
    state.matches = [];
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function searchApiFallback() {
  const response = await fetch(`/api/search?${queryString()}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "검색 중 오류가 발생했습니다.");
  return payload;
}

function searchStatic() {
  const settings = getSettings();
  const dataset = state.dataset;
  const matches = [];
  let excludedStatus = 0;
  let scanned = 0;

  dataset.stocks.forEach((stock) => {
    if (settings.market !== "all" && stock.m.toLowerCase() !== settings.market) return;
    const text = `${stock.n} ${stock.c}`.toLowerCase();
    if (settings.keyword && !text.includes(settings.keyword)) return;
    scanned += 1;

    const item = analyzeStock(expandStock(stock, dataset.dates), settings);
    if (!item) return;
    if (settings.excludeHalted && stock.h) {
      excludedStatus += 1;
      return;
    }
    matches.push(item);
  });

  matches.sort((a, b) => b.score - a.score);
  return {
    source: sourceLabel(dataset),
    matches,
    scanned,
    excludedStatus,
    asOf: matches.reduce((latest, item) => item.lastDate > latest ? item.lastDate : latest, dataset.asOf || "")
  };
}

function sourceLabel(dataset) {
  if (!dataset.generatedAt) return dataset.source || "네이버 금융";
  const generated = new Date(dataset.generatedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${dataset.source || "네이버 금융"} · ${generated} 갱신`;
}

function expandStock(stock, dates) {
  const indexes = stock.i ?? stock.p.map((_close, offset) => (stock.s || 0) + offset);
  return {
    code: stock.c,
    name: stock.n,
    market: stock.m,
    halted: stock.h,
    prices: stock.p.map((close, index) => ({ date: dates[indexes[index]], close }))
  };
}

function movingAverage(points, windowSize) {
  const result = [];
  let sum = 0;

  points.forEach((point, index) => {
    sum += point.close;
    if (index >= windowSize) sum -= points[index - windowSize].close;
    result.push({
      date: point.date,
      close: point.close,
      ma: index >= windowSize - 1 ? sum / windowSize : null
    });
  });

  return result;
}

function slopeStats(series, start, end) {
  let up = 0;
  let down = 0;
  let flat = 0;

  for (let index = start + 1; index <= end; index += 1) {
    const prev = series[index - 1].ma;
    const next = series[index].ma;
    if (prev === null || next === null) continue;
    if (next > prev) up += 1;
    else if (next < prev) down += 1;
    else flat += 1;
  }

  return { up, down, flat, total: up + down + flat };
}

function analyzeStock(stock, settings) {
  const prices = stock.prices.filter((point) => point.date && Number.isFinite(point.close));
  const needed = settings.maWindow + settings.recentDays + settings.declineDays;
  if (prices.length < needed) return null;

  const series = movingAverage(prices, settings.maWindow);
  const lastIndex = series.length - 1;
  const declineEnd = lastIndex - settings.recentDays;
  const declineStart = declineEnd - settings.declineDays;
  if (declineStart < settings.maWindow - 1 || declineEnd <= declineStart) return null;

  const recent = slopeStats(series, declineEnd, lastIndex);
  const previous = slopeStats(series, declineStart, declineEnd);
  const recentPass = settings.strictMode
    ? recent.down === 0 && recent.up === recent.total
    : recent.down <= settings.tolerance && recent.up > recent.down;
  const previousPass = settings.strictMode
    ? previous.up === 0 && previous.down === previous.total
    : previous.up <= settings.tolerance && previous.down > previous.up;
  if (!recentPass || !previousPass) return null;

  const recentChange = ((series[lastIndex].ma - series[declineEnd].ma) / series[declineEnd].ma) * 100;
  const previousChange = ((series[declineEnd].ma - series[declineStart].ma) / series[declineStart].ma) * 100;
  const score = recentChange - previousChange + previous.down / Math.max(previous.total, 1);

  return {
    code: stock.code,
    name: stock.name,
    market: stock.market,
    lastClose: prices[lastIndex].close,
    lastDate: prices[lastIndex].date,
    ma: series[lastIndex].ma,
    recent,
    previous,
    recentChange,
    previousChange,
    score,
    series: series.slice(-220)
  };
}

function renderShell() {
  updateMovingAverageCopy();
  els.runSearch.disabled = state.loading;
  els.runSearch.textContent = state.loading ? "검색 중..." : "검색";
  if (state.loading) {
    els.results.innerHTML = '<div class="empty">저장된 네이버 금융 데이터를 읽고 이동평균 조건을 계산하는 중입니다.</div>';
    els.matchCount.textContent = "-";
    renderDetail(null, "검색 중");
  }
}

function render() {
  updateMovingAverageCopy();
  els.runSearch.disabled = state.loading;
  els.runSearch.textContent = state.loading ? "검색 중..." : "검색";
  els.matchCount.textContent = state.matches.length;
  els.excludedCount.textContent = state.excludedStatus;

  if (!state.hasSearched) {
    els.results.innerHTML = '<div class="empty">검색 버튼을 누르면 저장된 코스피+코스닥 전체 데이터를 기준으로 조건을 계산합니다.</div>';
    renderDetail(null, "대기");
    return;
  }

  if (state.error) {
    els.results.innerHTML = `<div class="empty">${escapeHtml(state.error)}</div>`;
    renderDetail(null, "오류");
    return;
  }

  if (state.matches.length === 0) {
    els.results.innerHTML = '<div class="empty">조건을 만족하는 종목이 없습니다. 허용 반전 수를 늘리거나 시장 조건을 바꿔보세요.</div>';
    renderDetail(null, "대기");
    return;
  }

  els.results.innerHTML = state.matches.map((item) => `
    <button class="result-card ${item.code === state.selectedCode ? "active" : ""}" data-code="${item.code}" type="button">
      <div class="result-top">
        <div>
          <div class="result-name">${escapeHtml(item.name)}</div>
          <div class="result-code">${item.code} · ${item.market}</div>
        </div>
        <div class="price">${formatNumber(item.lastClose)}원</div>
      </div>
      <div class="metrics">
        <div class="metric"><strong>${formatPercent(item.previousChange)}</strong><span>이전 ${maLabel()}</span></div>
        <div class="metric"><strong>${formatPercent(item.recentChange)}</strong><span>최근 ${maLabel()}</span></div>
        <div class="metric"><strong>${item.recent.up}/${item.recent.total}</strong><span>최근 상승일</span></div>
      </div>
    </button>
  `).join("");

  document.querySelectorAll(".result-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCode = button.dataset.code;
      render();
    });
  });

  renderDetail(state.matches.find((item) => item.code === state.selectedCode) ?? state.matches[0]);
}

function renderDetail(item, badge = "대기") {
  const label = maLabel();
  const recent = Number(els.recentDays.value) || 20;
  const decline = Number(els.declineDays.value) || 60;
  if (!item) {
    els.detailTitle.textContent = state.loading ? "데이터 계산 중" : "종목을 선택하세요";
    els.detailMeta.textContent = state.loading
      ? `${label} 전환 조건을 계산하고 있습니다.`
      : `검색 결과에서 종목을 누르면 ${label} 흐름을 볼 수 있습니다.`;
    els.signalBadge.textContent = badge;
    els.explain.innerHTML = "";
    drawChart(null);
    return;
  }

  els.detailTitle.textContent = `${item.name} (${item.code})`;
  els.detailMeta.textContent = `${item.lastDate} 기준, 종가 ${formatNumber(item.lastClose)}원 · ${label} ${formatNumber(item.ma)}원`;
  els.signalBadge.textContent = "전환 포착";
  els.explain.innerHTML = `
    <div><strong>${formatPercent(item.previousChange)}</strong><p>${recent}거래일 전까지 ${decline}거래일 동안의 ${label} 변화율</p></div>
    <div><strong>${formatPercent(item.recentChange)}</strong><p>최근 ${recent}거래일 동안의 ${label} 변화율</p></div>
    <div><strong>${item.previous.down}/${item.previous.total} → ${item.recent.up}/${item.recent.total}</strong><p>하락 기울기 수에서 상승 기울기 수로 전환</p></div>
  `;
  drawChart(item);
}

function drawChart(item) {
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(260, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  if (!item) {
    ctx.fillStyle = "#63736b";
    ctx.textAlign = "center";
    ctx.font = "14px Segoe UI, Malgun Gothic, sans-serif";
    ctx.fillText(state.loading ? "계산 중..." : "표시할 차트가 없습니다.", rect.width / 2, rect.height / 2);
    return;
  }

  const visible = item.series.slice(-180);
  const values = visible.flatMap((point) => [point.close, point.ma].filter(Boolean));
  const min = Math.min(...values) * 0.985;
  const max = Math.max(...values) * 1.015;
  const pad = { left: 56, right: 22, top: 24, bottom: 42 };
  const width = rect.width - pad.left - pad.right;
  const height = rect.height - pad.top - pad.bottom;
  const x = (index) => pad.left + (index / (visible.length - 1)) * width;
  const y = (value) => pad.top + ((max - value) / (max - min)) * height;

  ctx.strokeStyle = "#dbe2de";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const yy = pad.top + (height / 4) * i;
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(rect.width - pad.right, yy);
  }
  ctx.stroke();

  drawLine(ctx, visible, x, y, "close", "#64748b", 1.5);
  drawLine(ctx, visible, x, y, "ma", "#0f8b6f", 3);

  ctx.fillStyle = "#17211d";
  ctx.font = "12px Segoe UI, Malgun Gothic, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("종가", pad.left, 16);
  ctx.fillStyle = "#0f8b6f";
  ctx.fillText(`${maLabel()} 이동평균`, pad.left + 44, 16);

  ctx.fillStyle = "#63736b";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = max - ((max - min) / 4) * i;
    ctx.fillText(formatNumber(value), pad.left - 10, pad.top + (height / 4) * i + 4);
  }
}

function drawLine(ctx, points, x, y, key, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  points.forEach((point, index) => {
    if (!point[key]) return;
    const xx = x(index);
    const yy = y(point[key]);
    if (!started) {
      ctx.moveTo(xx, yy);
      started = true;
    } else {
      ctx.lineTo(xx, yy);
    }
  });
  ctx.stroke();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.runSearch.addEventListener("click", runSearch);
els.reset.addEventListener("click", () => {
  els.keyword.value = "";
  els.maWindow.value = 120;
  els.recentDays.value = 20;
  els.declineDays.value = 60;
  els.tolerance.value = 4;
  els.market.value = "all";
  els.strictMode.checked = false;
  els.excludeHalted.checked = true;
  runSearch();
});
["input", "change"].forEach((eventName) => {
  els.maWindow.addEventListener(eventName, () => {
    updateMovingAverageCopy();
    renderDetail(state.matches.find((item) => item.code === state.selectedCode));
  });
  els.recentDays.addEventListener(eventName, updateMovingAverageCopy);
});
window.addEventListener("resize", () => renderDetail(state.matches.find((item) => item.code === state.selectedCode)));

render();

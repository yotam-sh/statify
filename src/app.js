import Chart from 'chart.js/auto';
import { TreemapController, TreemapElement } from 'chartjs-chart-treemap';
Chart.register(TreemapController, TreemapElement);

// ── Globals ──────────────────────────────────────────────────────────
Chart.defaults.color = '#b3b3b3';
Chart.defaults.borderColor = '#2a2a2a';
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";

// ── Crosshair plugin ────────────────────────────────────────────────
const crosshairPlugin = {
  id: 'crosshair',
  afterEvent(chart, args) {
    if (chart.config.type === 'doughnut' || chart.config.type === 'pie') return;
    const evt = args.event;
    if (evt.type === 'mousemove' && args.inChartArea) {
      chart._crosshair = { x: evt.x, y: evt.y };
    } else if (evt.type === 'mouseout') {
      chart._crosshair = null;
    }
    args.changed = true;
  },
  afterDatasetsDraw(chart) {
    if (!chart._crosshair || chart.config.type === 'doughnut' || chart.config.type === 'pie') return;
    const { x, y } = chart._crosshair;
    const { top, bottom, left, right } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    // vertical
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    // horizontal
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.restore();
  }
};
Chart.register(crosshairPlugin);

const charts = {};
const GREEN = '#1DB954';
const GREEN_15 = 'rgba(29,185,84,0.15)';
const PALETTE = ['#1DB954','#1E90FF','#FF6B6B','#FFA726','#AB47BC','#26C6DA','#FFEE58','#EC407A','#66BB6A','#8D6E63'];

// Admin impersonation — when set, data endpoints are routed to /api/u/{username}/...
window._adminViewAs = null;
function apiFetch(path, options) {
  const base = window._adminViewAs ? `/api/u/${encodeURIComponent(window._adminViewAs)}` : '/api';
  return fetch(base + path, options);
}

// ── Tab navigation ───────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.classList.add('text-gray-400'); });
    btn.classList.add('active'); btn.classList.remove('text-gray-400');
    document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
    const tab = btn.dataset.tab;
    document.getElementById('tab-' + tab).classList.remove('hidden');
    // Load on first visit
    const loaders = { dashboard: loadDashboard, 'top-artists': loadTopArtists, 'top-tracks': loadTopTracks, 'top-albums': loadTopAlbums, timeline: loadTimeline, habits: loadHabits, 'deep-dive': loadDeepDiveSuggestions, admin: loadAdmin };
    if (loaders[tab]) loaders[tab]();
  });
});

// ── Unit toggle ─────────────────────────────────────────────────────
let useMinutes = false;
let currentArtist = null;
function fmtDur(hours) {
  if (useMinutes) return Math.round(hours * 60).toLocaleString();
  return hours.toLocaleString();
}
function durLabel() { return useMinutes ? 'Minutes' : 'Hours'; }
function durVal(hours) { return useMinutes ? Math.round(hours * 60) : hours; }
function setUnit(minutes) {
  if (useMinutes === minutes) return;
  useMinutes = minutes;
  document.querySelectorAll('nav .unit-opt').forEach(b => b.classList.toggle('active', b.dataset.unit === (minutes ? 'm' : 'h')));
  document.querySelectorAll('.dur-header').forEach(el => el.textContent = durLabel());
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  const loaders = { dashboard: loadDashboard, 'top-artists': loadTopArtists, 'top-tracks': loadTopTracks, 'top-albums': loadTopAlbums, timeline: loadTimeline, habits: loadHabits };
  if (loaders[activeTab]) loaders[activeTab]();
  if (activeTab === 'deep-dive' && currentArtist) selectArtist(currentArtist);
}

// ── Helpers ──────────────────────────────────────────────────────────
function makeChart(id, config) {
  const existed = !!charts[id];
  if (existed) charts[id].destroy();
  if (existed) {
    config.options = config.options || {};
    config.options.animation = false;
  }
  charts[id] = new Chart(document.getElementById(id), config);
}

function showContent(prefix) {
  document.getElementById(prefix + '-loading')?.classList.add('hidden');
  document.getElementById(prefix + '-content')?.classList.remove('hidden');
  document.getElementById('refresh-overlay')?.classList.remove('visible');
}
function showLoading(prefix) {
  const content = document.getElementById(prefix + '-content');
  if (content && !content.classList.contains('hidden')) {
    document.getElementById('refresh-overlay')?.classList.add('visible');
    return;
  }
  document.getElementById(prefix + '-loading')?.classList.remove('hidden');
  content?.classList.add('hidden');
}

function statCard(value, label) {
  return `<div class="stat-card"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function imgTag(url, size, rounded, dataKey) {
  const r = rounded ? 'border-radius:50%;' : 'border-radius:4px;';
  const cog = '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';
  const note = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
  const dk = dataKey ? ` data-img-key="${esc(dataKey)}"` : '';
  if (url) return `<img src="${url}" width="${size}" height="${size}" style="object-fit:cover;${r}flex-shrink:0;" loading="lazy"${dk}>`;
  if (dataKey) return `<span class="img-placeholder loading" style="width:${size}px;height:${size}px;${r}"${dk}>${cog}</span>`;
  return `<span class="img-placeholder" style="width:${size}px;height:${size}px;${r}"${dk}>${note}</span>`;
}

async function resolveImages(artists, albums) {
  // Collect only items that have no image yet (empty string or missing)
  const needArtists = artists ? artists.filter(n => n) : [];
  const needAlbums = albums ? albums.filter(a => a && a.length === 2) : [];
  if (!needArtists.length && !needAlbums.length) return null;
  try {
    const resp = await fetch('/api/resolve-images', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({artists: needArtists, albums: needAlbums})
    });
    const data = await resp.json();
    // Patch artist images into DOM
    for (const [name, url] of Object.entries(data.artists || {})) {
      if (!url) continue;
      document.querySelectorAll(`[data-img-key="${CSS.escape(name)}"]`).forEach(el => {
        if (el.tagName === 'IMG') return; // already has image
        const img = document.createElement('img');
        img.src = url; img.width = el.offsetWidth || 32; img.height = el.offsetHeight || 32;
        img.style.cssText = el.style.cssText; img.loading = 'lazy';
        img.setAttribute('data-img-key', name);
        el.replaceWith(img);
      });
    }
    // Patch album images into DOM
    for (const [key, url] of Object.entries(data.albums || {})) {
      if (!url) continue;
      document.querySelectorAll(`[data-img-key="${CSS.escape(key)}"]`).forEach(el => {
        if (el.tagName === 'IMG') return;
        const img = document.createElement('img');
        img.src = url; img.width = el.offsetWidth || 32; img.height = el.offsetHeight || 32;
        img.style.cssText = el.style.cssText; img.loading = 'lazy';
        img.setAttribute('data-img-key', key);
        el.replaceWith(img);
      });
    }
    // Stop spinning on placeholders that didn't get an image
    document.querySelectorAll('.img-placeholder.loading').forEach(el => {
      el.classList.remove('loading');
      el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
    });
    return data;
  } catch (e) {
    // On error, also stop all spinners
    document.querySelectorAll('.img-placeholder.loading').forEach(el => {
      el.classList.remove('loading');
      el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
    });
    return null;
  }
}

function axisTitle(text) { return { display: true, text, color: '#888', font: { size: 12 } }; }

function wrapLabel(text, maxLen) {
  if (text.length <= maxLen) return text;
  const words = text.split(/\s+/);
  const lines = []; let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxLen) { lines.push(line); line = w; }
    else { line = line ? line + ' ' + w : w; }
  }
  if (line) lines.push(line);
  return lines;
}

// Shared custom tooltip element
const customTooltipEl = (() => {
  const el = document.createElement('div');
  el.id = 'custom-tooltip';
  el.style.cssText = 'position:absolute;pointer-events:none;transition:opacity 0.15s;opacity:0;background:rgba(30,30,30,0.95);border:1px solid #444;border-radius:10px;padding:12px 16px;text-align:center;z-index:50;min-width:120px;';
  document.body.appendChild(el);
  return el;
})();

function customTooltip(context, imgLookup, rounded, origLabels) {
  const tooltip = context.tooltip;
  if (tooltip.opacity === 0) { customTooltipEl.style.opacity = '0'; return; }
  const dp = tooltip.dataPoints?.[0];
  if (!dp) return;
  const label = origLabels && dp.dataIndex != null ? origLabels[dp.dataIndex] : (dp.dataset.label || (Array.isArray(dp.label) ? dp.label.join(' ') : dp.label));
  const value = dp.raw;
  const imgUrl = imgLookup ? (imgLookup[label] || '') : '';
  const r = rounded ? 'border-radius:50%;' : 'border-radius:6px;';
  const imgHtml = imgUrl
    ? `<img src="${imgUrl}" style="width:64px;height:64px;${r}object-fit:cover;margin:0 auto 8px;">`
    : `<div style="width:64px;height:64px;${r}background:#333;margin:0 auto 8px;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:#666"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></div>`;
  customTooltipEl.innerHTML = `${imgHtml}<div style="color:#fff;font-weight:600;font-size:0.9rem">${esc(label)}</div><div style="color:#b3b3b3;font-size:0.8rem">${value.toLocaleString()} ${durLabel().toLowerCase()}</div>`;
  const pos = context.chart.canvas.getBoundingClientRect();
  customTooltipEl.style.opacity = '1';
  customTooltipEl.style.left = pos.left + window.scrollX + tooltip.caretX - customTooltipEl.offsetWidth / 2 + 'px';
  customTooltipEl.style.top = pos.top + window.scrollY + tooltip.caretY - customTooltipEl.offsetHeight - 10 + 'px';
}

function horizontalBar(id, labels, values, height, xLabel, images, rounded) {
  const canvas = document.getElementById(id);
  const h = Math.max(height || 0, labels.length * 32);
  canvas.parentElement.style.height = h + 'px';
  const wrappedLabels = labels.map(l => wrapLabel(l, 20));
  const imgLookup = images || null;
  const origLabels = labels;
  makeChart(id, {
    type: 'bar',
    data: { labels: wrappedLabels, datasets: [{ data: values, backgroundColor: GREEN, borderRadius: 4, barThickness: 18 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: imgLookup ? { enabled: false, external: ctx => customTooltip(ctx, imgLookup, rounded, origLabels) } : {} },
      scales: { x: { grid: { color: '#222' }, title: axisTitle(xLabel || durLabel()) },
        y: { grid: { display: false }, afterFit(axis) { axis.width = 150; }, ticks: { autoSkip: false } } } }
  });
}

function doughnutChart(id, labels, values, colors) {
  makeChart(id, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors || [GREEN, '#444'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: {
      legend: { position: 'left', labels: { padding: 12, boxWidth: 12 } },
      tooltip: { callbacks: { label: ctx => { const total = ctx.dataset.data.reduce((a,b)=>a+b,0); return `${ctx.label}: ${ctx.raw.toLocaleString()} (${(ctx.raw/total*100).toFixed(1)}%)`; } } }
    }}
  });
}

// Treemap image plugin — draws images on treemap tiles as fill backgrounds
const treemapImgCache = {};  // global cache survives chart.destroy()
const treemapImagePlugin = {
  id: 'treemapImages',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const imgLookup = chart.options._imgLookup;
    if (!imgLookup) return;
    const ctx = chart.ctx;
    if (!ctx) return;
    meta.data.forEach((el, i) => {
      const raw = el.$context?.raw;
      const label = raw?.g || '';
      const url = imgLookup[label];
      if (!url) return;
      if (!treemapImgCache[url]) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        img.onload = () => { treemapImgCache[url] = img; if (chart.ctx) chart.draw(); };
        treemapImgCache[url] = 'loading';
        return;
      }
      if (treemapImgCache[url] === 'loading') return;
      const img = treemapImgCache[url];
      const { x, y, width, height } = el;
      if (width < 4 || height < 4) return;
      ctx.save();
      // Clip to tile bounds
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      // Draw image in "cover" mode: scale to fill tile, center crop
      const imgRatio = img.naturalWidth / img.naturalHeight;
      const tileRatio = width / height;
      let drawW, drawH, drawX, drawY;
      if (imgRatio > tileRatio) {
        drawH = height;
        drawW = height * imgRatio;
        drawX = x + (width - drawW) / 2;
        drawY = y;
      } else {
        drawW = width;
        drawH = width / imgRatio;
        drawX = x;
        drawY = y + (height - drawH) / 2;
      }
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      // Dark overlay for text readability
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    });

    // Draw group captions on group-level tiles
    const groups = chart.config.data.datasets[0].groups;
    if (groups && groups.length > 1) {
      const maxLevel = groups.length;
      const captionH = 18;
      for (const el of meta.data) {
        const raw = el.$context?.raw;
        if (!raw || !raw.g) continue;
        if (raw.l === undefined || raw.l >= maxLevel - 1) continue;
        if (el.width < 30 || el.height < captionH) continue;
        ctx.save();
        // Dark banner background
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(el.x, el.y, el.width, captionH);
        // Caption text — shrink font to fit if needed
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const pad = 10;
        const maxW = el.width - pad;
        let fontSize = 11;
        ctx.font = `bold ${fontSize}px sans-serif`;
        while (fontSize > 7 && ctx.measureText(raw.g).width > maxW) {
          fontSize--;
          ctx.font = `bold ${fontSize}px sans-serif`;
        }
        ctx.fillText(raw.g, el.x + 5, el.y + captionH / 2, maxW);
        ctx.restore();
      }
    }
  }
};
Chart.register(treemapImagePlugin);

function buildTreemap(id, tableData, labelKey, valueKey, imgLookup, rounded, groupKey, tooltipFn) {
  const tree = tableData.map(r => {
    const item = {
      label: r[labelKey],
      value: durVal(r[valueKey]),
    };
    if (groupKey) item.group = r[groupKey];
    return item;
  });

  const metaByLabel = {};
  tableData.forEach(r => { metaByLabel[r[labelKey]] = r; });

  const groups = groupKey ? ['group', 'label'] : ['label'];
  const groupColorMap = {};

  makeChart(id, {
    type: 'treemap',
    data: { datasets: [{
      tree,
      key: 'value',
      groups,
      backgroundColor(ctx) {
        if (ctx.type !== 'data') return '#333';
        if (groupKey) {
          const gName = ctx.raw._data?.group || ctx.raw.g;
          if (!groupColorMap[gName]) groupColorMap[gName] = PALETTE[Object.keys(groupColorMap).length % PALETTE.length];
          return groupColorMap[gName];
        }
        return PALETTE[ctx.dataIndex % PALETTE.length];
      },
      borderWidth: 2,
      borderColor: '#333',
      captions: { display: false },
      labels: {
        display: true,
        color: '#fff',
        font: { size: 11, weight: 'bold' },
        overflow: 'fit',
        formatter(ctx) {
          if (ctx.type !== 'data') return '';
          return [ctx.raw.g, ctx.raw.v ? fmtDur(ctx.raw.v / (useMinutes ? 60 : 1)) + ' ' + durLabel().toLowerCase() : ''];
        }
      }
    }] },
    options: { responsive: true, maintainAspectRatio: false, _imgLookup: imgLookup,
      plugins: { legend: { display: false },
        tooltip: {
          enabled: false,
          external: (context) => {
            const tooltip = context.tooltip;
            if (tooltip.opacity === 0) { customTooltipEl.style.opacity = '0'; return; }
            // Find the smallest (leaf) element at the cursor via el.inRange()
            const meta = context.chart.getDatasetMeta(0);
            let bestRaw = null, bestArea = Infinity;
            if (meta?.data) {
              for (const el of meta.data) {
                if (!el.inRange(tooltip.caretX, tooltip.caretY)) continue;
                const area = el.width * el.height;
                if (area < bestArea) { bestArea = area; bestRaw = el.$context?.raw; }
              }
            }
            if (!bestRaw) bestRaw = tooltip.dataPoints?.[0]?.raw;
            if (!bestRaw) return;
            const label = bestRaw.g || '';
            const value = bestRaw.v || 0;

            let tipImg, tipLines;
            if (tooltipFn) {
              const result = tooltipFn(label, bestRaw, metaByLabel);
              if (!result) { customTooltipEl.style.opacity = '0'; return; }
              tipImg = result.imgUrl;
              tipLines = result.lines;
            } else {
              tipImg = imgLookup[label] || '';
              tipLines = [
                { text: label, bold: true },
                { text: fmtDur(value / (useMinutes ? 60 : 1)) + ' ' + durLabel().toLowerCase(), color: '#b3b3b3' }
              ];
            }

            const r = rounded ? 'border-radius:50%;' : 'border-radius:6px;';
            const imgHtml = tipImg
              ? `<img src="${tipImg}" style="width:64px;height:64px;${r}object-fit:cover;margin:0 auto 8px;">`
              : `<div style="width:64px;height:64px;${r}background:#333;margin:0 auto 8px;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:#666"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></div>`;
            const linesHtml = tipLines.map(l =>
              `<div style="color:${l.color || '#fff'};font-weight:${l.bold ? '600' : '400'};font-size:${l.bold ? '0.9rem' : '0.8rem'}">${esc(l.text)}</div>`
            ).join('');
            customTooltipEl.innerHTML = imgHtml + linesHtml;
            const pos = context.chart.canvas.getBoundingClientRect();
            customTooltipEl.style.opacity = '1';
            customTooltipEl.style.left = pos.left + window.scrollX + tooltip.caretX - customTooltipEl.offsetWidth / 2 + 'px';
            customTooltipEl.style.top = pos.top + window.scrollY + tooltip.caretY - customTooltipEl.offsetHeight - 10 + 'px';
          }
        }
      }
    }
  });
}

// ── Filter helpers ───────────────────────────────────────────────────
function buildFilterParams(yearBtnsId) {
  const container = document.getElementById(yearBtnsId);
  if (!container) return '';
  const allBtn = container.querySelector('.year-btn[data-year="all"]');
  if (allBtn?.classList.contains('active')) return '';
  const selected = [...container.querySelectorAll('.year-btn.active')].map(b => b.dataset.year).filter(y => y !== 'all');
  if (!selected.length) return '';
  return `&years=${selected.join(',')}`;
}

function setupYearButtons(containerId, years, onSelect) {
  const container = document.getElementById(containerId);
  let html = '<button class="year-btn active" data-year="all">All Time</button>';
  years.forEach(y => { html += `<button class="year-btn" data-year="${y}">${y}</button>`; });
  html += '<button class="year-btn-clear" data-action="clear" style="display:none">Clear</button>';
  container.innerHTML = html;

  const allBtn = container.querySelector('.year-btn[data-year="all"]');
  const clearBtn = container.querySelector('.year-btn-clear');

  function updateClear() {
    clearBtn.style.display = allBtn.classList.contains('active') ? 'none' : '';
  }

  function resetToAll() {
    container.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    updateClear();
    onSelect();
  }

  clearBtn.addEventListener('click', resetToAll);

  container.querySelectorAll('.year-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.year === 'all') {
        resetToAll();
        return;
      }
      allBtn.classList.remove('active');
      btn.classList.toggle('active');
      if (!container.querySelector('.year-btn.active')) allBtn.classList.add('active');
      updateClear();
      onSelect();
    });
  });
}

let yearsInitialized = {};

// ── Dashboard ────────────────────────────────────────────────────────
async function loadDashboard() {
  showLoading('dashboard');

  const params = buildFilterParams('dash-year-btns');
  const data = await apiFetch('/dashboard?' + params).then(r => r.json());

  if (!yearsInitialized.dashboard && data.years) {
    setupYearButtons('dash-year-btns', data.years, loadDashboard);
    yearsInitialized.dashboard = true;
  }

  const s = data.stats;
  document.getElementById('dashboard-stats').innerHTML =
    statCard(s.total_plays.toLocaleString(), 'Total Plays') +
    statCard(fmtDur(s.total_hours), 'Total ' + durLabel()) +
    statCard(s.unique_artists.toLocaleString(), 'Unique Artists') +
    statCard(s.unique_tracks.toLocaleString(), 'Unique Tracks') +
    statCard(s.first_listen + ' &rarr; ' + s.last_listen, 'Date Range');

  // Monthly hours line chart (issue #3: hover + axis labels)
  makeChart('chart-monthly-hours', {
    type: 'line',
    data: { labels: data.monthly_hours.labels, datasets: [{
      data: data.monthly_hours.values.map(durVal), fill: true,
      backgroundColor: GREEN_15, borderColor: GREEN, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHitRadius: 10
    }]},
    options: { responsive: true,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 20 }, title: axisTitle('Month') },
        y: { grid: { color: '#222' }, beginAtZero: true, title: axisTitle(durLabel()) }
      }
    }
  });

  // Top 5 with images
  const ta = data.top_artists;
  const maxArtistVal = Math.max(...ta.values);
  document.getElementById('dash-top5-artists').innerHTML = ta.labels.map((name, i) => {
    const pct = (ta.values[i] / maxArtistVal * 100).toFixed(0);
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      ${imgTag(ta.images && ta.images[i], 36, true, name)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px"><span class="text-sm font-medium" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><span class="text-sm text-gray-400">${fmtDur(ta.values[i])}</span></div>
        <div style="height:6px;background:#2a2a2a;border-radius:3px"><div style="height:100%;width:${pct}%;background:${GREEN};border-radius:3px"></div></div>
      </div>
    </div>`;
  }).join('');

  const tt = data.top_tracks;
  const maxTrackVal = Math.max(...tt.values);
  const trackAlbums = [];
  document.getElementById('dash-top5-tracks').innerHTML = tt.labels.map((name, i) => {
    const pct = (tt.values[i] / maxTrackVal * 100).toFixed(0);
    const albumKey = (tt.album_keys && tt.album_keys[i]) || '';
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      ${imgTag(tt.images && tt.images[i], 36, false, albumKey)}
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;margin-bottom:2px"><span class="text-sm font-medium" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><span class="text-sm text-gray-400">${fmtDur(tt.values[i])}</span></div>
        <div style="height:6px;background:#2a2a2a;border-radius:3px"><div style="height:100%;width:${pct}%;background:${GREEN};border-radius:3px"></div></div>
      </div>
    </div>`;
  }).join('');

  showContent('dashboard');

  // Resolve uncached images in background
  const missingArtists = ta.labels.filter((n, i) => !ta.images || !ta.images[i]);
  const missingAlbums = (tt.album_pairs || []).filter((_, i) => !tt.images || !tt.images[i]);
  resolveImages(missingArtists, missingAlbums);
}

// ── Top Artists ──────────────────────────────────────────────────────
async function loadTopArtists() {
  const limit = document.getElementById('artists-limit').value;
  const params = `limit=${limit}` + buildFilterParams('artists-year-btns');

  showLoading('top-artists');

  const data = await apiFetch('/top-artists?' + params).then(r => r.json());

  if (!yearsInitialized.topArtists) {
    const dashData = await apiFetch('/dashboard').then(r => r.json());
    setupYearButtons('artists-year-btns', dashData.years, loadTopArtists);
    document.getElementById('artists-limit').addEventListener('change', loadTopArtists);
    yearsInitialized.topArtists = true;
  }

  const artistImgLookup = {};
  data.table.forEach(r => { if (r.image) artistImgLookup[r.artist] = r.image; });

  document.getElementById('artists-table').innerHTML = data.table.map((r, i) =>
    `<tr class="table-row border-b border-white/5"><td class="py-2 px-3 text-gray-400">${i+1}</td><td class="py-2 px-3">${imgTag(r.image, 32, true, r.artist)}</td><td class="py-2 px-3 font-medium">${esc(r.artist)}</td><td class="py-2 px-3 text-right">${r.plays.toLocaleString()}</td><td class="py-2 px-3 text-right">${fmtDur(r.hours)}</td></tr>`
  ).join('');
  showContent('top-artists');
  requestAnimationFrame(() => {
    buildTreemap('chart-artists-bar', data.table.slice(0, 50), 'artist', 'hours', artistImgLookup, true);
  });

  // Resolve uncached images in background, then update treemap
  const missingArtists = data.table.filter(r => !r.image).map(r => r.artist);
  resolveImages(missingArtists, []).then(resolved => {
    if (!resolved) return;
    const chart = charts['chart-artists-bar'];
    if (!chart) return;
    const lookup = chart.options._imgLookup;
    for (const [name, url] of Object.entries(resolved.artists || {})) {
      if (url) lookup[name] = url;
    }
    chart.draw();
  });
}

// ── Top Tracks ───────────────────────────────────────────────────────
async function loadTopTracks() {
  const limit = document.getElementById('tracks-limit').value;
  const params = `limit=${limit}` + buildFilterParams('tracks-year-btns');

  showLoading('top-tracks');

  const data = await apiFetch('/top-tracks?' + params).then(r => r.json());

  if (!yearsInitialized.topTracks) {
    const dashData = await apiFetch('/dashboard').then(r => r.json());
    setupYearButtons('tracks-year-btns', dashData.years, loadTopTracks);
    document.getElementById('tracks-limit').addEventListener('change', loadTopTracks);
    yearsInitialized.topTracks = true;
  }

  const trackImgLookup = {};
  data.table.forEach(r => { if (r.image) trackImgLookup[r.track] = r.image; });

  document.getElementById('tracks-table').innerHTML = data.table.map((r, i) => {
    const albumKey = `${r.album}||${r.artist}`;
    return `<tr class="table-row border-b border-white/5"><td class="py-2 px-3 text-gray-400">${i+1}</td><td class="py-2 px-3">${imgTag(r.image, 32, false, albumKey)}</td><td class="py-2 px-3 font-medium">${esc(r.track)}</td><td class="py-2 px-3 text-gray-300">${esc(r.artist)}</td><td class="py-2 px-3 text-gray-400">${esc(r.album)}</td><td class="py-2 px-3 text-right">${r.plays.toLocaleString()}</td><td class="py-2 px-3 text-right">${fmtDur(r.hours)}</td></tr>`;
  }).join('');
  showContent('top-tracks');
  requestAnimationFrame(() => {
    buildTreemap('chart-tracks-bar', data.table.slice(0, 50), 'track', 'hours', trackImgLookup, false, 'album',
      (label, raw, meta) => {
        const m = meta[label];
        if (m) return { imgUrl: m.artist_image || m.image || '', lines: [
          { text: m.artist, color: '#b3b3b3' },
          { text: m.album, color: '#888' },
          { text: m.track, bold: true },
          { text: fmtDur(m.hours) + ' ' + durLabel().toLowerCase(), color: '#b3b3b3' }
        ]};
        // Group-level tile (album header) — show album name + aggregated hours
        const v = raw.v || 0;
        return { imgUrl: '', lines: [
          { text: label, bold: true },
          { text: fmtDur(v / (useMinutes ? 60 : 1)) + ' ' + durLabel().toLowerCase(), color: '#b3b3b3' }
        ]};
      });
  });

  // Resolve uncached images in background, then update treemap
  const missingAlbums = data.table.filter(r => !r.image).map(r => [r.album, r.artist]);
  const missingArtists = [...new Set(data.table.filter(r => !r.artist_image).map(r => r.artist))];
  resolveImages(missingArtists, missingAlbums).then(resolved => {
    if (!resolved) return;
    const chart = charts['chart-tracks-bar'];
    if (!chart) return;
    const lookup = chart.options._imgLookup;
    for (const [key, url] of Object.entries(resolved.albums || {})) {
      if (!url) continue;
      const [albumName] = key.split('||');
      data.table.forEach(r => {
        if (r.album === albumName && !lookup[r.track]) lookup[r.track] = url;
      });
    }
    for (const [name, url] of Object.entries(resolved.artists || {})) {
      if (!url) continue;
      data.table.forEach(r => { if (r.artist === name) r.artist_image = url; });
    }
    chart.draw();
  });
}

// ── Top Albums ──────────────────────────────────────────────────────
async function loadTopAlbums() {
  const limit = document.getElementById('albums-limit').value;
  const params = `limit=${limit}` + buildFilterParams('albums-year-btns');

  showLoading('top-albums');

  const data = await apiFetch('/top-albums?' + params).then(r => r.json());

  if (!yearsInitialized.topAlbums) {
    const dashData = await apiFetch('/dashboard').then(r => r.json());
    setupYearButtons('albums-year-btns', dashData.years, loadTopAlbums);
    document.getElementById('albums-limit').addEventListener('change', loadTopAlbums);
    yearsInitialized.topAlbums = true;
  }

  const albumImgLookup = {};
  data.table.forEach(r => { if (r.image) albumImgLookup[r.album] = r.image; });

  document.getElementById('albums-table').innerHTML = data.table.map((r, i) => {
    const albumKey = `${r.album}||${r.artist}`;
    return `<tr class="table-row border-b border-white/5"><td class="py-2 px-3 text-gray-400">${i+1}</td><td class="py-2 px-3">${imgTag(r.image, 32, false, albumKey)}</td><td class="py-2 px-3 font-medium">${esc(r.album)}</td><td class="py-2 px-3 text-gray-300">${esc(r.artist)}</td><td class="py-2 px-3 text-right">${r.tracks}</td><td class="py-2 px-3 text-right">${r.plays.toLocaleString()}</td><td class="py-2 px-3 text-right">${fmtDur(r.hours)}</td></tr>`;
  }).join('');
  showContent('top-albums');
  requestAnimationFrame(() => {
    buildTreemap('chart-albums-bar', data.table.slice(0, 50), 'album', 'hours', albumImgLookup, false, 'artist',
      (label, raw, meta) => {
        const m = meta[label];
        if (m) return { imgUrl: m.artist_image || m.image || '', lines: [
          { text: m.album, bold: true },
          { text: m.artist, color: '#b3b3b3' },
          { text: fmtDur(m.hours) + ' ' + durLabel().toLowerCase(), color: '#b3b3b3' }
        ]};
        // Group-level tile (artist header) — show artist name + aggregated hours
        const v = raw.v || 0;
        return { imgUrl: '', lines: [
          { text: label, bold: true },
          { text: fmtDur(v / (useMinutes ? 60 : 1)) + ' ' + durLabel().toLowerCase(), color: '#b3b3b3' }
        ]};
      });
  });

  // Resolve uncached images in background, then update treemap
  const missingAlbums = data.table.filter(r => !r.image).map(r => [r.album, r.artist]);
  const missingArtists = [...new Set(data.table.filter(r => !r.artist_image).map(r => r.artist))];
  resolveImages(missingArtists, missingAlbums).then(resolved => {
    if (!resolved) return;
    const chart = charts['chart-albums-bar'];
    if (!chart) return;
    const lookup = chart.options._imgLookup;
    for (const [key, url] of Object.entries(resolved.albums || {})) {
      if (!url) continue;
      const [albumName] = key.split('||');
      if (albumName) lookup[albumName] = url;
    }
    for (const [name, url] of Object.entries(resolved.artists || {})) {
      if (!url) continue;
      data.table.forEach(r => { if (r.artist === name) r.artist_image = url; });
    }
    chart.draw();
  });
}

// ── Timeline ─────────────────────────────────────────────────────────
async function loadTimeline() {
  showLoading('timeline');

  const params = buildFilterParams('timeline-year-btns');
  const data = await apiFetch('/timeline?' + params).then(r => r.json());

  if (!yearsInitialized.timeline && data.years) {
    setupYearButtons('timeline-year-btns', data.years, loadTimeline);
    yearsInitialized.timeline = true;
  }

  // Yearly bar chart (issue #8: axis labels)
  makeChart('chart-yearly', {
    type: 'bar',
    data: { labels: data.yearly.labels, datasets: [{ data: data.yearly.values.map(durVal), backgroundColor: GREEN, borderRadius: 4 }] },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: '#222' }, beginAtZero: true, title: axisTitle(durLabel()) },
        x: { grid: { display: false }, title: axisTitle('Year') }
      }
    }
  });

  // Heatmap
  const hm = data.heatmap;
  const hmYears = Object.keys(hm).map(Number).sort();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  let maxH = 0;
  hmYears.forEach(y => Object.values(hm[y]).forEach(v => { if (v > maxH) maxH = v; }));

  let html = '<div class="grid" style="grid-template-columns: 50px repeat(12, 1fr); gap: 3px; max-width: 900px; margin: 0 auto;">';
  html += '<div></div>' + months.map(m => `<div class="text-xs text-gray-500 text-center">${m}</div>`).join('');
  hmYears.forEach(y => {
    html += `<div class="text-xs text-gray-400 flex items-center">${y}</div>`;
    for (let m = 1; m <= 12; m++) {
      const v = (hm[y] && hm[y][m]) || 0;
      const isEmpty = v === 0;
      const intensity = maxH > 0 ? v / maxH : 0;
      const bg = isEmpty ? '#1a1a1a' : `rgba(29,185,84,${0.15 + intensity * 0.85})`;
      html += `<div class="heatmap-cell${isEmpty ? ' empty' : ''}" data-year="${y}" data-month="${m}" data-hours="${v}"${isEmpty ? ' data-empty="true"' : ''} style="background:${bg}"></div>`;
    }
  });
  html += '</div>';
  document.getElementById('heatmap-container').innerHTML = html;

  // Heatmap tooltip + drill-down popup
  let hmTooltip = document.getElementById('hm-tooltip');
  if (!hmTooltip) {
    hmTooltip = document.createElement('div');
    hmTooltip.id = 'hm-tooltip';
    hmTooltip.className = 'heatmap-tooltip';
    document.body.appendChild(hmTooltip);
  }
  let hmPopup = document.getElementById('hm-popup');
  if (!hmPopup) {
    hmPopup = document.createElement('div');
    hmPopup.id = 'hm-popup';
    hmPopup.className = 'heatmap-popup';
    hmPopup.style.display = 'none';
    document.body.appendChild(hmPopup);
    // Scroll dismisses non-pinned popup
    window.addEventListener('scroll', () => {
      if (hmPopup.style.display !== 'none' && !hmPopup.dataset.pinned) {
        hmPopup.style.display = 'none';
      }
    });
    // Click outside closes pinned popup
    document.addEventListener('click', (e) => {
      if (hmPopup.style.display !== 'none' && hmPopup.dataset.pinned && !hmPopup.contains(e.target) && !e.target.closest('.heatmap-cell')) {
        hmPopup.style.display = 'none';
        delete hmPopup.dataset.pinned;
      }
    });
  }

  let hmTimer = null;
  let hmPopupLeaveTimer = null;

  hmPopup.addEventListener('mouseenter', () => { clearTimeout(hmPopupLeaveTimer); });
  hmPopup.addEventListener('mouseleave', () => {
    if (!hmPopup.dataset.pinned) {
      hmPopupLeaveTimer = setTimeout(() => { hmPopup.style.display = 'none'; }, 300);
    }
  });

  async function openDailyPopup(cell, pinned) {
    const y = cell.dataset.year;
    const m = parseInt(cell.dataset.month);
    try {
      const res = await fetch(`/api/daily-heatmap?year=${y}&month=${m}`);
      const dd = await res.json();
      renderDailyPopup(hmPopup, parseInt(y), m, dd, cell, pinned);
    } catch(err) { console.error('Daily heatmap error:', err); }
  }

  document.querySelectorAll('.heatmap-cell').forEach(cell => {
    cell.addEventListener('mouseenter', () => {
      const m = parseInt(cell.dataset.month);
      const v = parseFloat(cell.dataset.hours);
      const isEmpty = cell.dataset.empty === 'true';
      hmTooltip.textContent = isEmpty ? `${months[m-1]} ${cell.dataset.year}: No data` : `${months[m-1]} ${cell.dataset.year}: ${fmtDur(v)} ${durLabel().toLowerCase()}`;
      hmTooltip.style.opacity = '1';
      const r = cell.getBoundingClientRect();
      hmTooltip.style.left = r.left + r.width / 2 - hmTooltip.offsetWidth / 2 + window.scrollX + 'px';
      hmTooltip.style.top = r.top - hmTooltip.offsetHeight - 6 + window.scrollY + 'px';

      if (isEmpty) return;
      clearTimeout(hmTimer);
      hmTimer = setTimeout(() => openDailyPopup(cell, false), 4000);
    });
    cell.addEventListener('mouseleave', () => {
      hmTooltip.style.opacity = '0';
      clearTimeout(hmTimer);
    });
    // Click to pin
    cell.addEventListener('click', () => {
      if (cell.dataset.empty === 'true') return;
      clearTimeout(hmTimer);
      openDailyPopup(cell, true);
    });
  });

  function renderDailyPopup(popup, year, month, dd, anchorCell, pinned) {
    const totalDays = dd.total_days;
    const days = dd.days;
    let maxD = 0;
    Object.values(days).forEach(v => { if (v > maxD) maxD = v; });

    const firstDay = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const dayHeaders = ['Mo','Tu','We','Th','Fr','Sa','Su'];
    let totalHours = Object.values(days).reduce((a, b) => a + b, 0);

    let grid = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;">';
    grid += dayHeaders.map(d => `<div class="text-center" style="font-size:0.6rem;color:#888;padding:2px 0">${d}</div>`).join('');
    for (let i = 0; i < firstDay; i++) grid += '<div class="heatmap-day-empty"></div>';
    for (let d = 1; d <= totalDays; d++) {
      const v = days[d] || 0;
      const intensity = maxD > 0 ? v / maxD : 0;
      const bg = intensity === 0 ? '#1a1a1a' : `rgba(29,185,84,${0.15 + intensity * 0.85})`;
      grid += `<div class="heatmap-day" style="background:${bg}" title="${months[month-1]} ${d}: ${fmtDur(v)} ${durLabel().toLowerCase()}">${d}</div>`;
    }
    grid += '</div>';

    popup.innerHTML = `<button class="popup-close" onclick="document.getElementById('hm-popup').style.display='none';delete document.getElementById('hm-popup').dataset.pinned">&times;</button>
      <div class="popup-title">${monthsFull[month-1]} ${year}</div>
      <div class="popup-subtitle">${fmtDur(totalHours.toFixed(1))} ${durLabel().toLowerCase()} total</div>
      ${grid}`;

    if (pinned) {
      popup.dataset.pinned = 'true';
      popup.style.position = 'absolute';
    } else {
      delete popup.dataset.pinned;
      popup.style.position = 'fixed';
    }

    popup.style.display = 'block';
    const r = anchorCell.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left, top;
    if (pinned) {
      left = r.left + r.width / 2 - pw / 2 + window.scrollX;
      top = r.bottom + 8 + window.scrollY;
      if (left < 8 + window.scrollX) left = 8 + window.scrollX;
      if (left + pw > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - pw - 8;
      if (top + ph > window.scrollY + window.innerHeight - 8) top = r.top - ph - 8 + window.scrollY;
    } else {
      left = r.left + r.width / 2 - pw / 2;
      top = r.bottom + 8;
      if (left < 8) left = 8;
      if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
      if (top + ph > window.innerHeight - 8) top = r.top - ph - 8;
    }
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  // Taste evolution – Bump Chart (rank 1-5 per year)
  const evo = data.evolution;
  const evoImages = evo.images || {};
  const evoYears = evo.labels;
  const evoDatasets = evo.datasets;
  const evoArtists = evo.artists;

  // Compute ranks per year: for each year, sort artists by hours desc → rank 1-5
  const rankData = {}; // { artist: [rank_or_null_per_year] }
  const hoursData = {}; // { artist: [hours_per_year] }
  evoArtists.forEach(a => {
    rankData[a] = new Array(evoYears.length).fill(null);
    hoursData[a] = evoDatasets[a] || new Array(evoYears.length).fill(0);
  });
  evoYears.forEach((year, yi) => {
    const entries = evoArtists
      .map(a => ({ artist: a, hours: (evoDatasets[a] || [])[yi] || 0 }))
      .filter(e => e.hours > 0)
      .sort((a, b) => b.hours - a.hours);
    entries.slice(0, 5).forEach((e, rank) => { rankData[e.artist][yi] = rank + 1; });
  });

  // Helper: create circular canvas from image URL
  function makeCircleImage(url, size) {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const cx = c.getContext('2d');
        cx.beginPath(); cx.arc(size/2, size/2, size/2, 0, Math.PI*2); cx.clip();
        cx.drawImage(img, 0, 0, size, size);
        resolve(c);
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Build datasets: one line per artist that appeared in top 5 at least once
  const bumpDatasets = [];
  const artistColorMap = {};
  let colorIdx = 0;
  const circlePromises = [];
  const bumpArtistOrder = [];
  evoArtists.forEach(a => {
    if (!rankData[a].some(r => r !== null)) return;
    bumpArtistOrder.push(a);
    const color = PALETTE[colorIdx % PALETTE.length];
    artistColorMap[a] = color;
    colorIdx++;
    circlePromises.push(makeCircleImage(evoImages[a], 40));
    bumpDatasets.push({
      label: a,
      data: rankData[a],
      borderColor: color,
      backgroundColor: color,
      borderWidth: 3,
      pointRadius: 20,
      pointHoverRadius: 24,
      pointBackgroundColor: color,
      pointBorderColor: '#1e1e1e',
      pointBorderWidth: 2,
      tension: 0.3,
      spanGaps: true,
      fill: false,
      segment: {
        borderDash: ctx => {
          const d = ctx.chart.data.datasets[ctx.datasetIndex].data;
          for (let i = ctx.p0DataIndex + 1; i < ctx.p1DataIndex; i++) {
            if (d[i] === null) return [6, 4];
          }
          return undefined;
        },
        borderWidth: ctx => {
          const d = ctx.chart.data.datasets[ctx.datasetIndex].data;
          for (let i = ctx.p0DataIndex + 1; i < ctx.p1DataIndex; i++) {
            if (d[i] === null) return 1.5;
          }
          return 3;
        }
      },
    });
  });

  // Wait for all artist circle images, then assign as pointStyle and render chart
  Promise.all(circlePromises).then(circles => {
    circles.forEach((canvas, i) => {
      if (canvas) bumpDatasets[i].pointStyle = canvas;
    });

    makeChart('chart-evolution', {
      type: 'line',
      data: { labels: evoYears.map(String), datasets: bumpDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: function(context) {
              const tooltip = context.tooltip;
              if (tooltip.opacity === 0) { customTooltipEl.style.opacity = '0'; return; }
              const dp = tooltip.dataPoints?.[0];
              if (!dp) return;
              const artist = dp.dataset.label;
              const rank = dp.raw;
              const yi = dp.dataIndex;
              const hours = (hoursData[artist] || [])[yi] || 0;
              const year = evoYears[yi];
              const imgUrl = evoImages[artist] || '';
              const imgHtml = imgUrl
                ? `<img src="${imgUrl}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 8px;">`
                : `<div style="width:64px;height:64px;border-radius:50%;background:#333;margin:0 auto 8px;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:#666"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg></div>`;
              customTooltipEl.innerHTML = `${imgHtml}<div style="color:#fff;font-weight:600;font-size:0.9rem">${esc(artist)}</div><div style="color:#b3b3b3;font-size:0.8rem">#${rank} in ${year}</div><div style="color:#b3b3b3;font-size:0.8rem">${fmtDur(hours)} ${durLabel().toLowerCase()}</div>`;
              const pos = context.chart.canvas.getBoundingClientRect();
              customTooltipEl.style.opacity = '1';
              customTooltipEl.style.left = pos.left + window.scrollX + tooltip.caretX - customTooltipEl.offsetWidth / 2 + 'px';
              customTooltipEl.style.top = pos.top + window.scrollY + tooltip.caretY - customTooltipEl.offsetHeight - 10 + 'px';
            }
          }
        },
        scales: {
          y: { reverse: true, min: 0.5, max: 5.5, grid: { color: '#222' },
            ticks: { stepSize: 1, callback: v => v >= 1 && v <= 5 ? '#' + v : '' },
            title: axisTitle('Rank') },
          x: { grid: { display: false }, title: axisTitle('Year') }
        }
      }
    });
  });

  showContent('timeline');
}

// ── Habits ────────────────────────────────────────────────────────────
let habitsData = null;
let hourlyMode = 'total';
let dailyMode = 'total';

function renderHourlyChart() {
  if (!habitsData) return;
  const vals = hourlyMode === 'avg' ? habitsData.hourly.avg_values : habitsData.hourly.values;
  const label = hourlyMode === 'avg' ? `Avg ${durLabel()}/Day` : durLabel();
  makeChart('chart-hourly', {
    type: 'bar',
    data: { labels: habitsData.hourly.labels, datasets: [{ data: vals.map(durVal), backgroundColor: vals.map(v => {
      const max = Math.max(...vals); return `rgba(29,185,84,${0.2 + (max > 0 ? v/max : 0)*0.8})`;
    }), borderRadius: 3 }] },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { y: { grid: { color: '#222' }, beginAtZero: true, title: axisTitle(label) }, x: { grid: { display: false }, title: axisTitle('Hour of Day') } } }
  });
}

function renderDailyChart() {
  if (!habitsData) return;
  const vals = dailyMode === 'avg' ? habitsData.daily.avg_values : habitsData.daily.values;
  const label = dailyMode === 'avg' ? `Avg ${durLabel()}/Day` : durLabel();
  makeChart('chart-daily', {
    type: 'bar',
    data: { labels: habitsData.daily.labels, datasets: [{ data: vals.map(durVal), backgroundColor: vals.map(v => {
      const max = Math.max(...vals); return `rgba(29,185,84,${0.2 + (max > 0 ? v/max : 0)*0.8})`;
    }), borderRadius: 3 }] },
    options: { responsive: true, plugins: { legend: { display: false } },
      scales: { y: { grid: { color: '#222' }, beginAtZero: true, title: axisTitle(label) }, x: { grid: { display: false }, title: axisTitle('Day') } } }
  });
}

function setHourlyMode(mode) {
  hourlyMode = mode;
  document.querySelectorAll('#hourly-mode-switch .unit-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  renderHourlyChart();
}
function setDailyMode(mode) {
  dailyMode = mode;
  document.querySelectorAll('#daily-mode-switch .unit-opt').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  renderDailyChart();
}

async function loadHabits() {
  showLoading('habits');

  const params = buildFilterParams('habits-year-btns');
  const data = await apiFetch('/habits?' + params).then(r => r.json());
  habitsData = data;

  if (!yearsInitialized.habits && data.years) {
    setupYearButtons('habits-year-btns', data.years, loadHabits);
    yearsInitialized.habits = true;
  }

  document.getElementById('habits-stats').innerHTML =
    statCard(data.avg_track_min + ' min', 'Avg Track Duration') +
    statCard(data.total_listening_days.toLocaleString(), 'Listening Days') +
    statCard(data.unique_countries, 'Countries') +
    statCard(data.peak_hour, 'Peak Hour') +
    statCard(data.peak_day, 'Peak Day');

  renderHourlyChart();
  renderDailyChart();

  // Skip rate as percentage
  const skipYes = data.skip.labels.indexOf('Yes') >= 0 ? data.skip.values[data.skip.labels.indexOf('Yes')] : 0;
  const skipTotal = data.skip.values.reduce((a, b) => a + b, 0);
  const skipPct = skipTotal > 0 ? (skipYes / skipTotal * 100).toFixed(1) : '0';
  document.getElementById('skip-stat').innerHTML = `<div class="text-center"><div style="font-size:2.5rem;font-weight:700;color:var(--spotify-green)">${skipPct}%</div><div class="text-sm text-gray-400 mt-1">of plays were skipped</div><div class="text-xs text-gray-500 mt-1">${skipYes.toLocaleString()} skips</div></div>`;

  // Shuffle as percentage
  const shuffleYes = data.shuffle.labels.indexOf('Yes') >= 0 ? data.shuffle.values[data.shuffle.labels.indexOf('Yes')] : 0;
  const shuffleTotal = data.shuffle.values.reduce((a, b) => a + b, 0);
  const shufflePct = shuffleTotal > 0 ? (shuffleYes / shuffleTotal * 100).toFixed(1) : '0';
  document.getElementById('shuffle-stat').innerHTML = `<div class="text-center"><div style="font-size:2.5rem;font-weight:700;color:var(--spotify-green)">${shufflePct}%</div><div class="text-sm text-gray-400 mt-1">of plays were shuffled</div><div class="text-xs text-gray-500 mt-1">${shuffleYes.toLocaleString()} shuffled plays</div></div>`;

  // Platform treemap
  const platformTree = data.platform.labels.map((label, i) => ({ label, value: data.platform.values[i] }));
  makeChart('chart-platform', {
    type: 'treemap',
    data: { datasets: [{
      tree: platformTree,
      key: 'value',
      groups: ['label'],
      backgroundColor: (ctx) => PALETTE[ctx.dataIndex % PALETTE.length],
      borderWidth: 1,
      borderColor: '#333',
      labels: {
        display: true,
        color: '#fff',
        font: { size: 11, weight: 'bold' },
        formatter: (ctx) => ctx.type === 'data' ? [ctx.raw.g, ctx.raw.v.toLocaleString()] : ''
      }
    }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { title: () => '', label: (ctx) => {
          const total = platformTree.reduce((a, b) => a + b.value, 0);
          return `${ctx.raw.g}: ${ctx.raw.v.toLocaleString()} (${(ctx.raw.v/total*100).toFixed(1)}%)`;
        }}}
      }
    }
  });

  showContent('habits');
}

// ── Artist Deep-Dive ─────────────────────────────────────────────────
let searchTimeout;
const searchInput = document.getElementById('artist-search');
const searchResults = document.getElementById('artist-search-results');

async function loadDeepDiveSuggestions() {
  const top5 = await apiFetch('/top-artists-brief').then(r => r.json());
  const container = document.getElementById('artist-suggestions');
  container.innerHTML = '<span class="text-sm text-gray-500 mr-1">Try:</span>' +
    top5.map(a => `<button class="suggestion-chip" onclick="selectArtist('${a.name.replace(/'/g, "\\'")}')">${imgTag(a.image, 24, true, a.name)}${esc(a.name)}</button>`).join('');

  // Resolve uncached images in background
  const missingArtists = top5.filter(a => !a.image).map(a => a.name);
  resolveImages(missingArtists, []);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = searchInput.value.trim();
  if (q.length < 2) { searchResults.classList.add('hidden'); return; }
  searchTimeout = setTimeout(async () => {
    const results = await apiFetch('/artists/search?q=' + encodeURIComponent(q)).then(r => r.json());
    if (!results.length) { searchResults.classList.add('hidden'); return; }
    searchResults.innerHTML = results.map(r =>
      `<div onclick="selectArtist('${r.name.replace(/'/g, "\\'")}')">${esc(r.name)} <span class="text-gray-500 text-sm">(${r.plays.toLocaleString()} plays)</span></div>`
    ).join('');
    searchResults.classList.remove('hidden');
  }, 250);
});

document.addEventListener('click', e => {
  if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) searchResults.classList.add('hidden');
});

async function selectArtist(name) {
  currentArtist = name;
  searchInput.value = name;
  searchResults.classList.add('hidden');
  document.getElementById('deep-dive-content').classList.add('hidden');
  document.getElementById('tab-deep-dive').style.overflow = 'visible';

  const data = await apiFetch('/artist/' + encodeURIComponent(name)).then(r => r.json());
  if (data.error) return;

  const s = data.stats;
  document.getElementById('artist-hero-img').innerHTML = imgTag(data.artist_image, 140, true, name);
  document.getElementById('artist-stats').innerHTML =
    statCard(s.total_plays.toLocaleString(), 'Total Plays') +
    statCard(fmtDur(s.total_hours), 'Total ' + durLabel()) +
    statCard(s.first_listen, 'First Listen') +
    statCard(s.last_listen, 'Last Listen');

  // Monthly line
  makeChart('chart-artist-monthly', {
    type: 'line',
    data: { labels: data.monthly.labels, datasets: [{
      data: data.monthly.values.map(durVal), fill: true,
      backgroundColor: GREEN_15, borderColor: GREEN, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHitRadius: 10
    }]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 15 }, title: axisTitle('Month') },
        y: { grid: { color: '#222' }, beginAtZero: true, title: axisTitle(durLabel()) }
      }
    }
  });

  // Album cover cards (top 5, spread across full width)
  const albumsSlice = Math.min(data.albums.labels.length, 5);
  const albumsGrid = document.getElementById('artist-albums-grid');
  albumsGrid.className = albumsSlice >= 5 ? 'flex justify-between' : 'flex justify-center gap-6';
  albumsGrid.innerHTML = data.albums.labels.slice(0, albumsSlice).map((albumName, i) => {
    const albumKey = `${albumName}||${name}`;
    const hrs = data.albums.values[i];
    const img = (data.albums.images && data.albums.images[i]) || '';
    const imgHtml = img
      ? `<img src="${img}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:4px;" loading="lazy" data-img-key="${esc(albumKey)}">`
      : `<span class="img-placeholder loading" style="width:100%;aspect-ratio:1;border-radius:4px;" data-img-key="${esc(albumKey)}"><svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg></span>`;
    return `<div style="flex:1;min-width:0;text-align:center;padding:0 6px;max-width:200px">
      ${imgHtml}
      <div class="text-sm font-medium mt-2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(albumName)}">${esc(albumName)}</div>
      <div class="text-xs text-gray-400">${fmtDur(hrs)}</div>
    </div>`;
  }).join('');

  // Tracks table
  document.getElementById('artist-tracks-table').innerHTML = data.top_tracks.map((r, i) =>
    `<tr class="table-row border-b border-white/5"><td class="py-2 px-3 text-gray-400">${i+1}</td><td class="py-2 px-3 font-medium">${esc(r.track)}</td><td class="py-2 px-3 text-gray-400">${esc(r.album)}</td><td class="py-2 px-3 text-right">${r.plays.toLocaleString()}</td><td class="py-2 px-3 text-right">${fmtDur(r.hours)}</td></tr>`
  ).join('');

  document.getElementById('deep-dive-content').classList.remove('hidden');

  // Resolve uncached images in background
  const missingArtist = data.artist_image ? [] : [name];
  const missingAlbums = data.albums.labels
    .map((a, i) => (!data.albums.images || !data.albums.images[i]) ? [a, name] : null)
    .filter(Boolean);
  resolveImages(missingArtist, missingAlbums);
}

// ── Auth ──────────────────────────────────────────────────────────────
// Intercept fetch to redirect to login on 401
const _origFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _origFetch(...args);
  const url = typeof args[0] === 'string' ? args[0] : (args[0].url || '');
  if (res.status === 401 && !url.includes('/api/auth/')) {
    showLogin();
  }
  return res;
};

function toggleUserMenu() {
  document.getElementById('user-menu-dropdown').classList.toggle('open');
}
function closeUserMenu() {
  document.getElementById('user-menu-dropdown').classList.remove('open');
}
document.addEventListener('click', e => {
  const area = document.getElementById('nav-user-area');
  if (area && !area.contains(e.target)) closeUserMenu();
});

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('splash-screen').style.display = 'none';
  document.getElementById('nav-user-area').style.display = 'none';
}
function hideLogin() {
  document.getElementById('login-screen').style.display = 'none';
}

async function doLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  const res = await _origFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    errEl.textContent = data.detail || 'Invalid username or password';
    return;
  }

  const data = await res.json();
  hideLogin();
  document.getElementById('nav-username').textContent = '@' + data.username;
  document.getElementById('nav-user-area').style.cssText = 'display:flex!important';

  const { has_data } = await fetch('/api/status').then(r => r.json());
  if (!has_data) showSplash(); else loadDashboard();
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  showLogin();
  document.getElementById('login-password').value = '';
}

// ── Upload / splash ──────────────────────────────────────────────────
function showSplash() {
  document.getElementById('splash-screen').style.display = 'flex';
}
function hideSplash() {
  document.getElementById('splash-screen').style.display = 'none';
}
function openUploadModal() {
  document.getElementById('upload-modal').style.display = 'flex';
}
function closeUploadModal() {
  document.getElementById('upload-modal').style.display = 'none';
  document.getElementById('modal-status').textContent = '';
}

async function doUpload(file, statusEl, onSuccess) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    statusEl.innerHTML = '<span class="text-red-400">Please select a .zip file.</span>';
    return;
  }
  statusEl.innerHTML = '<span class="text-gray-400">Uploading and processing… this may take a moment.</span>';
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await res.json();
    if (res.ok) {
      statusEl.innerHTML = `<span class="text-green-400">✓ Loaded ${data.files_loaded} file(s). Loading dashboard…</span>`;
      setTimeout(() => onSuccess(), 800);
    } else {
      statusEl.innerHTML = `<span class="text-red-400">Error: ${esc(data.detail || data.error || 'Upload failed')}</span>`;
    }
  } catch {
    statusEl.innerHTML = '<span class="text-red-400">Network error. Is the server running?</span>';
  }
}

function setupDropZone(zoneId, inputId, statusId, onSuccess) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) doUpload(input.files[0], status, onSuccess);
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) doUpload(file, status, onSuccess);
  });
}

setupDropZone('splash-drop-zone', 'splash-file-input', 'splash-status', () => {
  hideSplash();
  loadDashboard();
});
setupDropZone('modal-drop-zone', 'modal-file-input', 'modal-status', () => {
  closeUploadModal();
  loadDashboard();
});

// ── Compare ───────────────────────────────────────────────────────────
async function loadCompare() {
  const userA = document.getElementById('compare-user-a').value.trim();
  const userB = document.getElementById('compare-user-b').value.trim();
  const errEl = document.getElementById('compare-error');
  errEl.textContent = '';

  if (!userA || !userB) { errEl.textContent = 'Please enter both usernames.'; return; }
  if (userA === userB) { errEl.textContent = 'Enter two different usernames.'; return; }

  document.getElementById('compare-loading').classList.remove('hidden');
  document.getElementById('compare-results').classList.add('hidden');

  const res = await fetch(`/api/compare/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`);
  document.getElementById('compare-loading').classList.add('hidden');

  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    errEl.textContent = d.detail || 'Could not load comparison.';
    return;
  }

  const data = await res.json();
  const { user_a, user_b, overlap } = data;

  document.getElementById('cmp-score').textContent = overlap.similarity_score;
  document.getElementById('cmp-name-a').textContent = '@' + user_a.username;
  document.getElementById('cmp-name-b').textContent = '@' + user_b.username;

  const fmtStats = (stats) => Object.entries({
    'Total hours': stats.total_hours.toLocaleString(),
    'Total plays': stats.total_plays.toLocaleString(),
    'Unique artists': stats.unique_artists.toLocaleString(),
    'Unique tracks': stats.unique_tracks.toLocaleString(),
    'Listening since': stats.first_listen,
  }).map(([k, v]) => `<div class="flex justify-between"><span class="text-gray-400">${k}</span><span>${v}</span></div>`).join('');

  document.getElementById('cmp-stats-a').innerHTML = fmtStats(user_a.stats);
  document.getElementById('cmp-stats-b').innerHTML = fmtStats(user_b.stats);

  const sharedArtistsEl = document.getElementById('cmp-shared-artists');
  sharedArtistsEl.innerHTML = overlap.shared_artists.length
    ? overlap.shared_artists.map(a => `
        <div class="shared-artist-chip">
          ${a.image ? `<img src="${a.image}" alt="">` : '<div style="width:28px;height:28px;border-radius:50%;background:#333;flex-shrink:0"></div>'}
          <span>${a.name}</span>
        </div>`).join('')
    : '<p class="text-gray-500 text-sm">No shared artists in top 100.</p>';

  document.getElementById('cmp-only-a-title').textContent = `Only @${user_a.username} listens to`;
  document.getElementById('cmp-only-b-title').textContent = `Only @${user_b.username} listens to`;
  document.getElementById('cmp-only-a').innerHTML = overlap.only_a.map(a => `<li>${a}</li>`).join('') || '<li class="text-gray-500">—</li>';
  document.getElementById('cmp-only-b').innerHTML = overlap.only_b.map(a => `<li>${a}</li>`).join('') || '<li class="text-gray-500">—</li>';

  document.getElementById('cmp-shared-tracks').innerHTML = overlap.shared_tracks.length
    ? overlap.shared_tracks.map(t => `<li><span class="text-white">${t.track}</span> <span class="text-gray-500">— ${t.artist}</span></li>`).join('')
    : '<li class="text-gray-500">No shared tracks in top 50.</li>';

  document.getElementById('compare-results').classList.remove('hidden');
}

// ── Admin panel ───────────────────────────────────────────────────────

let _adminCacheType = 'artist';
let _adminFixType   = 'artist';
let _adminFixTarget = null;  // { type, name, album?, artist? }
let _adminResetTarget = null; // { user_id, username }
let _adminCachePage = 1;

function adminShowPanel(name) {
  ['overview','users','image-cache','bulk-refresh'].forEach(p => {
    document.getElementById('admin-panel-' + p).classList.toggle('hidden', p !== name);
  });
  document.querySelectorAll('.admin-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });
  if (name === 'overview') loadAdminOverview();
  if (name === 'users') loadAdminUsers();
  if (name === 'image-cache') adminLoadImageCache(1);
}

async function loadAdminOverview() {
  const data = await fetch('/api/admin/overview').then(r => r.json());
  const el = document.getElementById('admin-overview-content');
  const cards = [
    ['Users', data.users, ''],
    ['Artists cached', data.artist_images_cached, ''],
    ['Albums cached', data.album_images_cached, ''],
    ['Genres cached', data.artist_genres_cached, ''],
    ['Empty artist images', data.empty_artist_images, data.empty_artist_images > 0 ? 'color:#FFA726' : ''],
    ['Empty album images', data.empty_album_images, data.empty_album_images > 0 ? 'color:#FFA726' : ''],
  ];
  el.innerHTML = cards.map(([label, val, style]) =>
    `<div class="stat-card"><div class="value" style="${style}">${val.toLocaleString()}</div><div class="label">${label}</div></div>`
  ).join('');
}

async function loadAdminUsers() {
  const users = await fetch('/api/admin/users').then(r => r.json());
  const tbody = document.getElementById('admin-users-table');
  tbody.innerHTML = users.map(u => `
    <tr class="table-row border-b border-white/5">
      <td class="py-2 px-3 font-medium">${u.username}</td>
      <td class="py-2 px-3 text-center">
        <button onclick="adminTogglePublic('${u.user_id}',${!u.is_public})" class="text-xs px-2 py-0.5 rounded ${u.is_public ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}">${u.is_public ? 'Yes' : 'No'}</button>
      </td>
      <td class="py-2 px-3 text-center text-gray-400">${u.file_count}</td>
      <td class="py-2 px-3 text-gray-400 text-xs">${u.created_at.slice(0,10)}</td>
      <td class="py-2 px-3 text-right">
        <div class="flex gap-1 justify-end flex-wrap">
          <button onclick="adminImpersonate('${u.username}')" class="year-btn text-xs">View data</button>
          <button onclick="adminOpenReset('${u.user_id}','${u.username}')" class="year-btn text-xs">Reset pw</button>
          <button onclick="adminDeleteUser('${u.user_id}','${u.username}')" class="year-btn-clear text-xs" style="border-color:#ff6b6b55">Delete</button>
        </div>
      </td>
    </tr>`).join('');
}

async function adminTogglePublic(userId, newVal) {
  await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({is_public: newVal}),
  });
  loadAdminUsers();
}

async function adminDeleteUser(userId, username) {
  if (!confirm(`Delete user "${username}"? This removes all their data and cannot be undone.`)) return;
  await fetch(`/api/admin/users/${userId}`, {method: 'DELETE'});
  loadAdminUsers();
  loadAdminOverview();
}

function adminOpenReset(userId, username) {
  _adminResetTarget = {user_id: userId, username};
  document.getElementById('admin-reset-username').textContent = username;
  document.getElementById('admin-reset-pw').value = '';
  document.getElementById('admin-reset-error').textContent = '';
  document.getElementById('admin-reset-modal').classList.remove('hidden');
}

async function adminConfirmReset() {
  const pw = document.getElementById('admin-reset-pw').value;
  const errEl = document.getElementById('admin-reset-error');
  if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; return; }
  const res = await fetch(`/api/admin/users/${_adminResetTarget.user_id}/reset-password`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({password: pw}),
  });
  if (res.ok) {
    document.getElementById('admin-reset-modal').classList.add('hidden');
  } else {
    errEl.textContent = (await res.json()).detail || 'Error';
  }
}

function adminImpersonate(username) {
  window._adminViewAs = username;
  yearsInitialized = {};
  document.getElementById('admin-viewing-as-name').textContent = username;
  document.getElementById('admin-impersonation-bar').classList.remove('hidden');
  // Switch to Dashboard tab to trigger a fresh load with the new apiFetch routing
  const dashBtn = document.querySelector('[data-tab="dashboard"]');
  if (dashBtn) dashBtn.click();
}

function adminStopImpersonating() {
  window._adminViewAs = null;
  yearsInitialized = {};
  document.getElementById('admin-impersonation-bar').classList.add('hidden');
  const dashBtn = document.querySelector('[data-tab="dashboard"]');
  if (dashBtn) dashBtn.click();
}

function adminSetCacheType(type) {
  _adminCacheType = type;
  document.querySelectorAll('[data-cache-type]').forEach(b => b.classList.toggle('active', b.dataset.cacheType === type));
  adminLoadImageCache(1);
}

function adminSetFixType(type) {
  _adminFixType = type;
  document.querySelectorAll('[data-fix-type]').forEach(b => b.classList.toggle('active', b.dataset.fixType === type));
}

async function adminLoadImageCache(page) {
  _adminCachePage = page;
  const q = document.getElementById('admin-cache-search').value;
  const params = new URLSearchParams({type: _adminCacheType, q, page, limit: 50});
  const data = await fetch('/api/admin/image-cache?' + params).then(r => r.json());
  const tbody = document.getElementById('admin-cache-table');
  tbody.innerHTML = data.items.map(item => {
    const name  = _adminCacheType === 'artist' ? item.artist_name : `${item.album_name} — ${item.artist_name}`;
    const thumb = item.image_url
      ? `<img src="${item.image_url}" style="width:40px;height:40px;object-fit:cover;border-radius:4px">`
      : `<div style="width:40px;height:40px;background:#333;border-radius:4px"></div>`;
    const fixBtn = _adminCacheType === 'artist'
      ? `<button onclick="adminPrefillFix('${escAttr(item.artist_name)}')" class="year-btn text-xs">Fix</button>`
      : `<button onclick="adminPrefillFixAlbum('${escAttr(item.album_name)}','${escAttr(item.artist_name)}')" class="year-btn text-xs">Fix</button>`;
    const delBtn = _adminCacheType === 'artist'
      ? `<button onclick="adminDeleteArtistCache('${escAttr(item.artist_name)}')" class="year-btn-clear text-xs">Del</button>`
      : `<button onclick="adminDeleteAlbumCache('${escAttr(item.album_name)}','${escAttr(item.artist_name)}')" class="year-btn-clear text-xs">Del</button>`;
    return `<tr class="table-row border-b border-white/5">
      <td class="py-2 px-3">${thumb}</td>
      <td class="py-2 px-3 text-sm">${esc(name)}</td>
      <td class="py-2 px-3 text-xs text-gray-400 hidden md:table-cell">${(item.fetched_at||'').slice(0,10)}</td>
      <td class="py-2 px-3 text-right"><div class="flex gap-1 justify-end">${fixBtn}${delBtn}</div></td>
    </tr>`;
  }).join('');

  const totalPages = Math.ceil(data.total / 50);
  const pagEl = document.getElementById('admin-cache-pagination');
  pagEl.innerHTML = `<span>${data.total} entries</span>` +
    (page > 1 ? `<button class="year-btn text-xs" onclick="adminLoadImageCache(${page-1})">← Prev</button>` : '') +
    `<span>Page ${page} / ${totalPages || 1}</span>` +
    (page < totalPages ? `<button class="year-btn text-xs" onclick="adminLoadImageCache(${page+1})">Next →</button>` : '');
}

function escAttr(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

function adminPrefillFix(artistName) {
  _adminFixTarget = {type:'artist', name: artistName};
  _adminFixType = 'artist';
  document.querySelectorAll('[data-fix-type]').forEach(b => b.classList.toggle('active', b.dataset.fixType === 'artist'));
  document.getElementById('admin-fix-query').value = artistName;
  document.getElementById('admin-fix-target-name').textContent = artistName;
  document.getElementById('admin-fix-target').classList.remove('hidden');
  adminShowPanel('image-cache');
}

function adminPrefillFixAlbum(albumName, artistName) {
  _adminFixTarget = {type:'album', album: albumName, artist: artistName};
  _adminFixType = 'album';
  document.querySelectorAll('[data-fix-type]').forEach(b => b.classList.toggle('active', b.dataset.fixType === 'album'));
  document.getElementById('admin-fix-query').value = albumName;
  document.getElementById('admin-fix-target-name').textContent = `${albumName} — ${artistName}`;
  document.getElementById('admin-fix-target').classList.remove('hidden');
  adminShowPanel('image-cache');
}

function adminClearFixTarget() {
  _adminFixTarget = null;
  document.getElementById('admin-fix-target').classList.add('hidden');
}

async function adminSearchImage() {
  const q = document.getElementById('admin-fix-query').value.trim();
  if (!q) return;
  const params = new URLSearchParams({q, type: _adminFixType});
  const results = await fetch('/api/admin/image-cache/search?' + params).then(r => r.json());
  const el = document.getElementById('admin-search-results');
  if (!results.length) { el.innerHTML = '<p class="text-gray-400 text-sm col-span-full">No results found.</p>'; return; }
  el.innerHTML = results.map(r => {
    const label = _adminFixType === 'artist' ? esc(r.name) : `${esc(r.name)}<br><span class="text-gray-400">${esc(r.artist||'')}</span>`;
    const target = _adminFixType === 'artist'
      ? `data-target-name="${escAttr(r.name)}"`
      : `data-target-album="${escAttr(r.name)}" data-target-artist="${escAttr(r.artist||'')}"`;
    return `<div class="bg-card rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-green-500 transition" onclick="adminPickImage(this,'${escAttr(r.image)}')" ${target}>
      <div style="aspect-ratio:1;background:#222">${r.image ? `<img src="${r.image}" style="width:100%;height:100%;object-fit:cover">` : ''}</div>
      <div class="p-2 text-xs">${label}</div>
    </div>`;
  }).join('');
}

async function adminPickImage(el, imageUrl) {
  const target = _adminFixTarget;
  if (!target) {
    // derive from clicked card
    const name   = el.dataset.targetName;
    const album  = el.dataset.targetAlbum;
    const artist = el.dataset.targetArtist;
    if (_adminFixType === 'artist' && name) {
      await fetch(`/api/admin/image-cache/artist/${encodeURIComponent(name)}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({image_url: imageUrl}),
      });
    } else if (album) {
      await fetch('/api/admin/image-cache/album', {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({album, artist, image_url: imageUrl}),
      });
    }
  } else if (target.type === 'artist') {
    await fetch(`/api/admin/image-cache/artist/${encodeURIComponent(target.name)}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({image_url: imageUrl}),
    });
    adminClearFixTarget();
  } else {
    await fetch('/api/admin/image-cache/album', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({album: target.album, artist: target.artist, image_url: imageUrl}),
    });
    adminClearFixTarget();
  }
  // Highlight saved card briefly
  el.style.outline = '2px solid #1DB954';
  setTimeout(() => { el.style.outline = ''; }, 1500);
  adminLoadImageCache(_adminCachePage);
}

async function adminDeleteArtistCache(name) {
  await fetch(`/api/admin/image-cache/artist/${encodeURIComponent(name)}`, {method: 'DELETE'});
  adminLoadImageCache(_adminCachePage);
}

async function adminDeleteAlbumCache(album, artist) {
  await fetch('/api/admin/image-cache/album', {
    method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({album, artist}),
  });
  adminLoadImageCache(_adminCachePage);
}

async function adminBulkRefresh(type) {
  const statusEl = document.getElementById('admin-refresh-status');
  statusEl.textContent = 'Running… this may take a while.';
  statusEl.style.color = '#b3b3b3';
  try {
    const res = await fetch(`/api/admin/image-cache/refresh-empty?type=${type}`, {method: 'POST'});
    const data = await res.json();
    statusEl.textContent = `Done. Attempted: ${data.attempted}, refreshed: ${data.refreshed}, still empty: ${data.still_empty}`;
    statusEl.style.color = '#1DB954';
    loadAdminOverview();
  } catch {
    statusEl.textContent = 'Error — check server logs.';
    statusEl.style.color = '#ff6b6b';
  }
}

function loadAdmin() {
  adminShowPanel('overview');
}

// ── Init ─────────────────────────────────────────────────────────────
async function initApp() {
  const meRes = await _origFetch('/api/auth/me');
  if (!meRes.ok) {
    showLogin();
    return;
  }
  const me = await meRes.json();
  document.getElementById('nav-username').textContent = '@' + me.username;
  document.getElementById('nav-user-area').style.cssText = 'display:flex!important';
  document.getElementById('compare-user-a').value = me.username;
  if (me.is_admin) {
    document.getElementById('tab-btn-admin').style.display = '';
  }

  const { has_data } = await fetch('/api/status').then(r => r.json());
  if (!has_data) showSplash(); else loadDashboard();
}
initApp();

function togglePasswordVisibility() {
  const input = document.getElementById('login-password');
  const icon  = document.getElementById('eye-icon');
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  // Swap between open-eye and crossed-eye SVG paths
  icon.innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

// ── Expose functions required by inline HTML event handlers ──────────
window.doLogin = doLogin;
window.doLogout = doLogout;
window.toggleUserMenu = toggleUserMenu;
window.closeUserMenu = closeUserMenu;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.setUnit = setUnit;
window.setHourlyMode = setHourlyMode;
window.setDailyMode = setDailyMode;
window.selectArtist = selectArtist;
window.loadCompare = loadCompare;
window.togglePasswordVisibility = togglePasswordVisibility;
window.adminShowPanel = adminShowPanel;
window.adminTogglePublic = adminTogglePublic;
window.adminDeleteUser = adminDeleteUser;
window.adminOpenReset = adminOpenReset;
window.adminConfirmReset = adminConfirmReset;
window.adminImpersonate = adminImpersonate;
window.adminStopImpersonating = adminStopImpersonating;
window.adminSetCacheType = adminSetCacheType;
window.adminSetFixType = adminSetFixType;
window.adminLoadImageCache = adminLoadImageCache;
window.adminSearchImage = adminSearchImage;
window.adminPickImage = adminPickImage;
window.adminDeleteArtistCache = adminDeleteArtistCache;
window.adminDeleteAlbumCache = adminDeleteAlbumCache;
window.adminBulkRefresh = adminBulkRefresh;
window.adminPrefillFix = adminPrefillFix;
window.adminPrefillFixAlbum = adminPrefillFixAlbum;
window.adminClearFixTarget = adminClearFixTarget;

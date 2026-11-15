// 国土地理院の標高タイルと航空写真で、圃場の地形を読むための関数集。
// ブラウザ（Claude in Chrome など）で、HTMLのページ（例：https://maps.gsi.go.jp/development/ichiran.html）を開き、
// このファイルの中身を javascript_tool でそのまま実行すると window.GT に関数が入る。
// 計算の部分（fill・flowAcc・slopeAspect・tpi・profile）はブラウザに依存しないので Node でも動く。
//
// 座標の約束
//   d[i][j]：i が行（南へ増える）、j が列（東へ増える）。1マス＝dem.px メートル
//   斜面の向き（aspect）：斜面が「向いている」方位＝下り方向。北0°・東90°・南180°・西270°

(function (root) {
  const BASE = 'https://cyberjapandata.gsi.go.jp/xyz';
  const NB = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const x = (lon + 180) / 360 * n;
    const r = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    return [x, y];
  }

  // 1ピクセルの大きさ（m）。タイル1枚＝256ピクセル
  function pixelMeters(lat, z) {
    return 40075016.686 * Math.cos(lat * Math.PI / 180) / (2 ** z) / 256;
  }

  async function fetchDemTile(z, x, y, kinds) {
    for (const k of kinds) {
      const r = await fetch(`${BASE}/${k}/${z}/${x}/${y}.txt`);
      if (!r.ok) continue;
      const rows = (await r.text()).trim().split('\n')
        .map(l => l.split(',').map(v => (v === 'e' ? NaN : parseFloat(v))));
      return { kind: k, rows };
    }
    return null;
  }

  // 中心の緯度経度の周り (2*span+1)×(2*span+1) 枚のタイルをつないだ標高の格子を返す。
  // 5m（dem5a レーザー → dem5b 写真測量 → dem5c）を順に探し、無ければ10m（dem10b、z14）で取り直す。
  async function loadDem(lat, lon, { span = 1 } = {}) {
    for (const [z, kinds] of [[15, ['dem5a', 'dem5b', 'dem5c']], [14, ['dem10b']]]) {
      const [fx, fy] = tileXY(lat, lon, z);
      const X0 = Math.floor(fx) - span, Y0 = Math.floor(fy) - span, N = 2 * span + 1;
      const M = Array.from({ length: N * 256 }, () => new Float64Array(N * 256).fill(NaN));
      const sources = [];
      let got = 0;
      for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
        const t = await fetchDemTile(z, X0 + tx, Y0 + ty, kinds);
        sources.push({ tx, ty, kind: t ? t.kind : 'なし' });
        if (!t) continue;
        got++;
        t.rows.forEach((row, i) => row.forEach((v, j) => { M[ty * 256 + i][tx * 256 + j] = v; }));
      }
      if (got > 0) {
        return {
          M, z, X0, Y0, sources, px: pixelMeters(lat, z),
          center: [(fx - X0) * 256, (fy - Y0) * 256], // [j, i]
        };
      }
    }
    throw new Error('この場所の標高タイルが見つからない');
  }

  // 緯度経度 → 格子の [j, i]
  function toGrid(dem, lat, lon) {
    const [fx, fy] = tileXY(lat, lon, dem.z);
    return [(fx - dem.X0) * 256, (fy - dem.Y0) * 256];
  }

  // 中心 [cj, ci] から half マスの正方形を切り出す
  function crop(dem, cj, ci, half) {
    const j0 = Math.round(cj) - half, i0 = Math.round(ci) - half, W = 2 * half;
    const d = [];
    for (let i = 0; i < W; i++) d.push(Float64Array.from(dem.M[i0 + i].slice(j0, j0 + W)));
    return { d, j0, i0, W, px: dem.px, z: dem.z, X0: dem.X0, Y0: dem.Y0 };
  }

  // 窪地を埋めた標高（priority-flood）。埋めた深さ F-d が「周りを囲まれた窪地」
  function fill(d) {
    const H = d.length, W = d[0].length;
    const F = d.map(r => Float64Array.from(r));
    const seen = d.map(() => new Uint8Array(W));
    const heap = [];
    const push = (v, i, j) => {
      heap.push([v, i, j]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      if (i === 0 || j === 0 || i === H - 1 || j === W - 1) { push(F[i][j], i, j); seen[i][j] = 1; }
    }
    while (heap.length) {
      const [v, i, j] = pop();
      for (const [a, b] of NB) {
        const p = i + a, q = j + b;
        if (p < 0 || q < 0 || p >= H || q >= W || seen[p][q]) continue;
        seen[p][q] = 1;
        if (F[p][q] < v) F[p][q] = v;
        push(F[p][q], p, q);
      }
    }
    return F;
  }

  // 冷気（や水）が集まってくる面積の目安。値＝そのマスを通って流れる上流のマス数
  function flowAcc(d, F) {
    const H = d.length, W = d[0].length;
    const order = [];
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) order.push([F[i][j] + d[i][j] * 1e-6, i, j]);
    order.sort((x, y) => y[0] - x[0]);
    const acc = d.map(() => new Float64Array(W).fill(1));
    for (const [, i, j] of order) {
      let best = null, bs = 0;
      for (const [a, b] of NB) {
        const p = i + a, q = j + b;
        if (p < 0 || q < 0 || p >= H || q >= W) continue;
        const s = (F[i][j] - F[p][q] + (d[i][j] - d[p][q]) * 1e-3) / Math.hypot(a, b);
        if (s > bs) { bs = s; best = [p, q]; }
      }
      if (best) acc[best[0]][best[1]] += acc[i][j];
    }
    return acc;
  }

  // 傾斜（%と度）と斜面の向き（下り方向の方位）
  function slopeAspect(d, i, j, px) {
    const dzE = (d[i][j + 1] - d[i][j - 1]) / (2 * px); // 東へ進むと上がる量
    const dzS = (d[i + 1][j] - d[i - 1][j]) / (2 * px); // 南へ進むと上がる量
    const g = Math.hypot(dzE, dzS);
    const aspect = (Math.atan2(-dzE, dzS) * 180 / Math.PI + 360) % 360;
    return { percent: g * 100, degree: Math.atan(g) * 180 / Math.PI, aspect };
  }

  // 周り（半径 r マスの円）の平均との差。マイナスなら周りより低い
  function tpi(d, i, j, r) {
    let s = 0, n = 0;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      if (a * a + b * b > r * r) continue;
      const p = i + a, q = j + b;
      if (p < 0 || q < 0 || p >= d.length || q >= d[0].length || Number.isNaN(d[p][q])) continue;
      s += d[p][q]; n++;
    }
    return d[i][j] - s / n;
  }

  function sample(d, j, i) {
    const j0 = Math.floor(j), i0 = Math.floor(i), fj = j - j0, fi = i - i0;
    return d[i0][j0] * (1 - fj) * (1 - fi) + d[i0][j0 + 1] * fj * (1 - fi)
      + d[i0 + 1][j0] * (1 - fj) * fi + d[i0 + 1][j0 + 1] * fj * fi;
  }

  // 2点を結ぶ断面。stepM メートルごとの [距離m, 標高m]
  function profile(c, [j1, i1], [j2, i2], stepM = 5) {
    const L = Math.hypot(j2 - j1, i2 - i1) * c.px, n = Math.max(1, Math.round(L / stepM));
    const out = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push([Math.round(t * L), +sample(c.d, j1 + (j2 - j1) * t, i1 + (i2 - i1) * t).toFixed(2)]);
    }
    return out;
  }

  // 地点ごとの数字。pts = { 名前: [j, i] }（切り出した格子の座標）
  function describe(c, F, acc, pts) {
    const r35 = Math.max(1, Math.round(35 / c.px)), r90 = Math.max(2, Math.round(90 / c.px));
    const out = {};
    for (const [name, [j, i]] of Object.entries(pts)) {
      const sa = slopeAspect(c.d, i, j, c.px);
      let accMax = 0;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) accMax = Math.max(accMax, acc[i + a][j + b]);
      out[name] = {
        elevation: +c.d[i][j].toFixed(1),
        slopePercent: +sa.percent.toFixed(1),
        aspect: Math.round(sa.aspect),
        tpi35: +tpi(c.d, i, j, r35).toFixed(2),
        tpi90: +tpi(c.d, i, j, r90).toFixed(2),
        pondDepth: +(F[i][j] - c.d[i][j]).toFixed(2),
        upslopeArea_m2: Math.round(accMax * c.px * c.px),
      };
    }
    return out;
  }

  // 航空写真（標高より2段細かいズーム）を、切り出した範囲に合わせて canvas に描く。1マス＝4ピクセル
  async function loadPhoto(c, layer = 'seamlessphoto') {
    const zp = c.z + 2, S = 4;
    const cv = document.createElement('canvas'); cv.width = c.W * S; cv.height = c.W * S;
    const g = cv.getContext('2d');
    const gx0 = (c.X0 * 256 + c.j0) * 4, gy0 = (c.Y0 * 256 + c.i0) * 4;
    for (let tx = Math.floor(gx0 / 256); tx <= Math.floor((gx0 + c.W * S) / 256); tx++) {
      for (let ty = Math.floor(gy0 / 256); ty <= Math.floor((gy0 + c.W * S) / 256); ty++) {
        const r = await fetch(`${BASE}/${layer}/${zp}/${tx}/${ty}.jpg`);
        if (!r.ok) continue;
        g.drawImage(await createImageBitmap(await r.blob()), tx * 256 - gx0, ty * 256 - gy0);
      }
    }
    return cv;
  }

  // 写真の上に等高線・窪地・冷気の流れる道を重ねた図。labels = [[文字, j, i], ...]
  function render(c, photo, F, acc, { contourM = 1, majorM = 5, accMin = 150, labels = [], Z = 4 } = {}) {
    const d = c.d, W = c.W;
    const cv = document.createElement('canvas'); cv.width = W * Z; cv.height = W * Z;
    const g = cv.getContext('2d');
    if (photo) g.drawImage(photo, 0, 0, cv.width, cv.height);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, 0, cv.width, cv.height);
    const sm = (i, j) => { let s = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) s += d[i + a][j + b]; return s / 9; };
    for (let i = 1; i < W - 2; i++) for (let j = 1; j < W - 2; j++) {
      const f = v => Math.floor(v / contourM);
      const a = f(sm(i, j)), b = f(sm(i, j + 1)), e = f(sm(i + 1, j));
      if (a !== b || a !== e) {
        const major = (Math.max(a, b, e) * contourM) % majorM === 0;
        g.fillStyle = major ? 'rgba(200,40,0,0.95)' : 'rgba(255,140,0,0.8)';
        g.beginPath(); g.arc(j * Z + Z / 2, i * Z + Z / 2, major ? 2.2 : 1.4, 0, 7); g.fill();
      }
    }
    for (let i = 0; i < W; i++) for (let j = 0; j < W; j++) {
      const dep = F[i][j] - d[i][j];
      if (dep > 0.2) { g.fillStyle = `rgba(0,90,255,${Math.min(0.75, 0.3 + dep / 2)})`; g.fillRect(j * Z, i * Z, Z, Z); }
      if (acc[i][j] > accMin) { g.fillStyle = 'rgba(0,200,255,0.85)'; g.fillRect(j * Z, i * Z, Z, Z); }
    }
    g.font = 'bold 20px sans-serif'; g.lineWidth = 4;
    for (const [t, j, i] of labels) { g.strokeStyle = 'white'; g.strokeText(t, j * Z, i * Z); g.fillStyle = '#0a3d91'; g.fillText(t, j * Z, i * Z); }
    const L = 50 / c.px * Z;
    g.fillStyle = 'white'; g.fillRect(12, cv.height - 34, L + 12, 26);
    g.fillStyle = 'black'; g.fillRect(18, cv.height - 18, L, 5); g.font = 'bold 14px sans-serif'; g.fillText('50m', 18, cv.height - 22);
    g.fillText('N↑', cv.width - 34, 22);
    return cv;
  }

  // canvas をページいっぱいに表示する（スクリーンショットを撮るため）
  function show(cv) {
    document.body.innerHTML = ''; document.body.style.margin = '0';
    const sc = Math.min((innerWidth - 10) / cv.width, (innerHeight - 6) / cv.height, 1.5);
    cv.style.width = cv.width * sc + 'px'; cv.style.height = cv.height * sc + 'px';
    document.body.appendChild(cv);
    return sc;
  }

  root.GT = { tileXY, pixelMeters, loadDem, toGrid, crop, fill, flowAcc, slopeAspect, tpi, profile, describe, loadPhoto, render, show };
})(typeof window !== 'undefined' ? window : globalThis);

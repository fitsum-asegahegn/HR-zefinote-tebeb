/* ፍኖተ ጥበብ — Member ID cards: QR modal, card canvas, PNG download/share,
   Word (.docx) sheet, and the browser print sheet.
   Extracted verbatim from app.js. Loaded as a plain script (no modules).
   Stays in app.js on purpose: exportMembersExcel and the Members screen.
   Depends on globals: get, todayISO, downloadBlob, showAlert, withButtonLoading,
   el, t, getLang, and the CDN libs QRCode and docx. */

window.showQr = async (id) => {
  const m = await get("members", id);
  const lang = getLang();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-inner">
      <h3>${m.fullName}</h3>
      ${m.grade ? `<p class="muted" style="margin-top:-8px;">${t("members.gradeShort", { n: m.grade })}</p>` : ""}
      <div id="idCardPreview" style="display:flex;justify-content:center;"></div>
      <p class="muted" style="max-width:260px;">${t("members.softCopyNote")}</p>
      <div class="row-actions" style="justify-content:center;margin-top:8px;">
        <button class="btn-small" id="qrDownloadBtn">${lang === "am" ? "መታወቂያ አውርድ" : "Download ID"}</button>
        <button class="btn-small" id="qrShareBtn">${lang === "am" ? "መታወቂያ አጋራ" : "Share ID"}</button>
        <button class="btn-small" id="qrDocxBtn">${lang === "am" ? "በWord አውርድ" : "Download Word"}</button>
      </div>
      <button class="btn-secondary" style="margin-top:10px;" onclick="this.closest('.modal').remove()">${t("members.close")}</button>
    </div>`;
  document.body.appendChild(box);
  if (typeof QRCode === 'undefined') {
    await showAlert('QRCode library not loaded');
    return;
  }
  const canvas = await buildIdCardCanvas(m);
  canvas.style.width = "260px";
  canvas.style.height = "auto";
  canvas.style.borderRadius = "8px";
  el("idCardPreview").appendChild(canvas);
  el("qrDownloadBtn").onclick = () => downloadIdCard(canvas, m.fullName);
  el("qrShareBtn").onclick = () => shareIdCard(canvas, m.fullName);
  el("qrDocxBtn").onclick = (e) => withButtonLoading(e.currentTarget, lang === "am" ? "በማዘጋጀት ላይ..." : "Preparing...", () => downloadIdCardsDocx([m], null));
};

// ---------- Full ID card image (photo + QR + name + org), used for both
// download and share so both produce the same complete card, not just
// the bare QR code. ----------
function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function renderQrToDataUrl(text, size) {
  return new Promise((resolve) => {
    const holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    document.body.appendChild(holder);
    new QRCode(holder, { text, width: size, height: size });
    setTimeout(() => {
      const canvas = holder.querySelector("canvas");
      const dataUrl = canvas ? canvas.toDataURL("image/png") : (holder.querySelector("img") ? holder.querySelector("img").src : "");
      document.body.removeChild(holder);
      resolve(dataUrl);
    }, 80);
  });
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(" ");
  let line = "", lines = [];
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return Math.min(lines.length, maxLines);
}

// Landscape ID card: amber header band, photo on the left, name/grade in the
// middle, and a large QR on the right so the card has no dead space and the
// code scans easily. Shared by the PNG download/share and the Word export.
// School portal address printed on every ID card (change it here if the site moves)
const PORTAL_URL = "portalfinotetebeb.vercel.app";
const ID_CARD_W = 900, ID_CARD_H = 540;
async function buildIdCardCanvas(member) {
  const lang = getLang();
  const W = ID_CARD_W, H = ID_CARD_H;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // header band
  ctx.fillStyle = "#f2a33c";
  ctx.fillRect(0, 0, W, 96);
  ctx.fillStyle = "#1a1410";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "bold 38px 'Noto Sans Ethiopic', sans-serif";
  ctx.fillText("ፍኖተ ጥበብ ሰ/ት/ቤት", 40, 50);
  ctx.textAlign = "right";
  ctx.font = "600 20px 'Noto Sans Ethiopic', sans-serif";
  ctx.fillText(lang === "am" ? "የአባል መታወቂያ" : "MEMBER ID", W - 40, 50);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // outer border
  ctx.strokeStyle = "#cfcfcf";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);

  // photo (3:4, same ratio as the stored photo)
  const px = 40, py = 126, pw = 225, ph = 300;
  if (member.photo) {
    try {
      const photoImg = await loadImageEl(member.photo);
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip();
      ctx.drawImage(photoImg, px, py, pw, ph);
      ctx.restore();
    } catch (e) { /* fall through to placeholder look below */ }
  }
  if (!member.photo) {
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = "#999999";
    ctx.font = "18px 'Noto Sans Ethiopic', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(lang === "am" ? "ፎቶ የለም" : "No Photo", px + pw / 2, py + ph / 2);
    ctx.textAlign = "left";
  }
  ctx.strokeStyle = "#999999";
  ctx.lineWidth = 1;
  ctx.strokeRect(px, py, pw, ph);

  // QR (large) on the right
  const qs = 320, qx = W - 40 - qs, qy = 122;
  const qrDataUrl = await renderQrToDataUrl(member.qrId, qs);
  const qrImg = await loadImageEl(qrDataUrl);
  ctx.drawImage(qrImg, qx, qy, qs, qs);
  ctx.font = "15px 'JetBrains Mono', monospace";
  ctx.fillStyle = "#777777";
  ctx.textAlign = "center";
  ctx.fillText(member.qrId, qx + qs / 2, qy + qs + 26);
  ctx.textAlign = "left";

  // middle column: name, accent bar, grade, Christian name
  const mx = px + pw + 26, mw = qx - 22 - mx;
  ctx.fillStyle = "#1a1410";
  ctx.font = "bold 28px 'Noto Sans Ethiopic', sans-serif";
  const nameLines = wrapCanvasText(ctx, member.fullName, mx, py + 34, mw, 36, 3) || 1;
  let y = py + 34 + (nameLines - 1) * 36 + 22;
  ctx.fillStyle = "#f2a33c";
  ctx.fillRect(mx, y, 64, 5);
  y += 40;
  if (member.grade) {
    ctx.fillStyle = "#444444";
    ctx.font = "600 24px 'Noto Sans Ethiopic', sans-serif";
    ctx.fillText(`${lang === "am" ? "ክፍል" : "Grade"} ${member.grade}`, mx, y);
    y += 36;
  }
  if (member.christianName) {
    ctx.fillStyle = "#777777";
    ctx.font = "19px 'Noto Sans Ethiopic', sans-serif";
    wrapCanvasText(ctx, member.christianName, mx, y, mw, 26, member.portalCode ? 1 : 2);
  }

  // school-portal login: ID + first password (or a note once the student chose their own)
  if (member.portalCode) {
    const base = py + ph;
    ctx.fillStyle = "#777777";
    ctx.font = "14px 'Noto Sans Ethiopic', sans-serif";
    ctx.fillText(lang === "am" ? "የፖርታል መግቢያ" : "Portal login", mx, base - 74);
    ctx.fillStyle = "#1a1410";
    ctx.font = "bold 22px 'JetBrains Mono', monospace";
    ctx.fillText(member.portalCode, mx, base - 48);
    if (member.portalPassword) {
      ctx.font = "bold 18px 'JetBrains Mono', monospace";
      ctx.fillText((lang === "am" ? "የይለፍ ቃል: " : "Password: ") + member.portalPassword, mx, base - 20);
    } else {
      ctx.fillStyle = "#666666";
      ctx.font = "15px 'Noto Sans Ethiopic', sans-serif";
      ctx.fillText(lang === "am" ? "የይለፍ ቃል: ተቀይሯል" : "Password: set by student", mx, base - 20);
    }
  }

  // portal link along the bottom edge (every card)
  ctx.strokeStyle = "#e3e3e3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, 490);
  ctx.lineTo(W - 40, 490);
  ctx.stroke();
  const linkLabel = lang === "am" ? "ፖርታል:" : "Portal:";
  ctx.font = "16px 'Noto Sans Ethiopic', sans-serif";
  const labelW = ctx.measureText(linkLabel).width;
  ctx.font = "bold 21px 'JetBrains Mono', monospace";
  const urlW = ctx.measureText(PORTAL_URL).width;
  const startX = (W - (labelW + 10 + urlW)) / 2;
  ctx.fillStyle = "#777777";
  ctx.font = "16px 'Noto Sans Ethiopic', sans-serif";
  ctx.fillText(linkLabel, startX, 521);
  ctx.fillStyle = "#1a1410";
  ctx.font = "bold 21px 'JetBrains Mono', monospace";
  ctx.fillText(PORTAL_URL, startX + labelW + 10, 521);

  return canvas;
}

function downloadIdCard(canvas, name) {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `id-${name.replace(/\s+/g, "_")}.png`);
  }, "image/png");
}

async function shareIdCard(canvas, name) {
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `id-${name.replace(/\s+/g, "_")}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) {}
    }
    downloadBlob(blob, file.name);
  }, "image/png");
}

// ---------- ID cards as a Word (.docx) file ----------
// Same card image as the PNG download (photo + QR + name), laid out like the
// printed sheet: 2 columns x 4 rows (8 cards) per A4 page with dashed cut
// lines. A single member gets one card on its own page. Requires the docx
// library (docx@8 UMD, loaded in index.html and cached by the service worker).
async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function buildIdCardsDocx(pngList) {
  const A4 = { width: 11906, height: 16838 }; // twips
  const MARGIN = 454;                         // 8 mm
  const margin = { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN };
  const colW = Math.floor((A4.width - 2 * MARGIN) / 2);
  const RATIO = ID_CARD_H / ID_CARD_W;        // keep the card canvas aspect ratio
  const imageRun = (bytes, widthPx) => new docx.ImageRun({
    data: bytes, type: "png",
    transformation: { width: widthPx, height: Math.round(widthPx * RATIO) },
  });
  // A tiny trailing paragraph keeps Word happy after a table without risking a blank page.
  const spacer = () => new docx.Paragraph({ spacing: { before: 0, after: 0 }, children: [new docx.TextRun({ text: "", size: 2 })] });

  if (pngList.length === 1) {
    return new docx.Document({
      sections: [{
        properties: { page: { size: A4, margin } },
        children: [
          new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, spacing: { before: 600 }, children: [imageRun(pngList[0], 350)] }),
        ],
      }],
    });
  }

  const dashed = { style: docx.BorderStyle.DASHED, size: 4, color: "999999" };
  const borders = { top: dashed, bottom: dashed, left: dashed, right: dashed };
  const cell = (bytes) => new docx.TableCell({
    width: { size: colW, type: docx.WidthType.DXA },
    borders,
    verticalAlign: docx.VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 60, right: 60 },
    children: [new docx.Paragraph({
      alignment: docx.AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      children: bytes ? [imageRun(bytes, 350)] : [],
    })],
  });

  const sections = [];
  for (let i = 0; i < pngList.length; i += 8) {
    const page = pngList.slice(i, i + 8);
    const rows = [];
    for (let r = 0; r < 4; r++) {
      const left = page[r * 2], right = page[r * 2 + 1];
      if (left === undefined && right === undefined) break;
      rows.push(new docx.TableRow({
        cantSplit: true,
        height: { value: 3700, rule: docx.HeightRule.ATLEAST },
        children: [cell(left), cell(right)],
      }));
    }
    sections.push({
      properties: { page: { size: A4, margin } },
      children: [
        new docx.Table({
          width: { size: colW * 2, type: docx.WidthType.DXA },
          columnWidths: [colW, colW],
          layout: docx.TableLayoutType.FIXED,
          rows,
        }),
        spacer(),
      ],
    });
  }
  return new docx.Document({ sections });
}

// One member -> one card; many -> the 8-per-page sheet. `btn` (optional)
// shows "3/40" progress while the cards are rendered.
async function downloadIdCardsDocx(members, btn, nameTag) {
  const lang = getLang();
  if (typeof docx === "undefined") {
    await showAlert(lang === "am" ? "docx ቤተ-መጻሕፍት አልተጫነም — ኢንተርኔት ያረጋግጡ" : "The Word library isn't loaded — check your connection and reopen the app.");
    return;
  }
  if (typeof QRCode === "undefined") { await showAlert("QRCode library not loaded"); return; }
  if (!members.length) return;
  const pngs = [];
  for (let i = 0; i < members.length; i++) {
    const canvas = await buildIdCardCanvas(members[i]);
    pngs.push(await canvasToPngBytes(canvas));
    if (btn && members.length > 1) btn.textContent = `${i + 1}/${members.length}`;
  }
  const blob = await docx.Packer.toBlob(buildIdCardsDocx(pngs));
  const fileName = members.length === 1
    ? `id-${members[0].fullName.replace(/\s+/g, "_")}.docx`
    : `ID-cards${nameTag ? "-" + nameTag : ""}-${todayISO()}.docx`;
  downloadBlob(blob, fileName);
}

// Browser print / "Save as PDF" sheet. Uses the same card image as the Word
// download (photo, QR, name, portal login, portal link) so both look
// identical: 2 columns x 4 rows (8 cards) per A4 page with dashed cut lines.
// `btn` (optional) shows "3/40" progress while the cards are drawn.
async function printAllQr(members, btn) {
  if (typeof QRCode === 'undefined') { await showAlert('QRCode library not loaded'); return; }
  if (!members.length) return;
  const original = btn ? btn.innerHTML : null;
  if (btn) btn.disabled = true;
  try {
    const area = el("printArea");
    area.innerHTML = "";
    const perPage = 8;
    const imgs = [];
    for (let i = 0; i < members.length; i += perPage) {
      const page = document.createElement("div");
      page.className = "qr-page";
      for (const m of members.slice(i, i + perPage)) {
        const canvas = await buildIdCardCanvas(m);
        const card = document.createElement("div");
        card.className = "id-card";
        card.style.padding = "1mm";
        const img = document.createElement("img");
        img.src = canvas.toDataURL("image/png");
        img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;display:block;";
        card.appendChild(img);
        page.appendChild(card);
        imgs.push(img);
        canvas.width = canvas.height = 0; // free memory on phones
        if (btn && members.length > 1) btn.textContent = `${imgs.length}/${members.length}`;
      }
      area.appendChild(page);
    }
    await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
    window.print();
  } finally {
    if (btn) { btn.innerHTML = original; btn.disabled = false; }
  }
}

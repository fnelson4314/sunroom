import { Colors } from "@/constants/Colors";
import { getSession } from "@/services/api";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type LineItem = { name: string; amount: number; detail: string };

// On web, expo-print falls back to printing the live app page (browser chrome,
// no background colors, the app's own buttons). Instead open a clean window with
// ONLY the quote HTML and print that — colors print via print-color-adjust and
// the base64 images embed reliably. Returns true if it handled the print.
function printHtmlWeb(html: string): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  const doPrint = () => {
    win.focus();
    win.print();
  };
  // Give the (base64) images a tick to lay out before printing.
  if (win.document.readyState === "complete") setTimeout(doPrint, 450);
  else win.onload = () => setTimeout(doPrint, 450);
  return true;
}

// Convert any image URI (local file, blob, or remote URL) to a base64 data URI
// so it embeds reliably in PDF HTML across native and web.
async function toBase64DataUri(uri: string): Promise<string> {
  if (!uri) return "";
  try {
    if (uri.startsWith("data:")) return uri;
    // On Expo web, blob: URIs need special handling
    if (uri.startsWith("blob:")) {
      const res = await fetch(uri);
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(""); // fail gracefully
        reader.readAsDataURL(blob);
      });
    }
    // Remote URLs
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      const res = await fetch(uri);
      if (!res.ok) return "";
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    }
    // Local file URI on native
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve("");
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn("toBase64DataUri failed:", e);
    return "";
  }
}

export default function QuoteScreen() {
  const { sessionId, renderUrl, photoUri, totalPrice, priceBreakdown } =
    useLocalSearchParams<{
      sessionId: string;
      renderUrl: string;
      photoUri: string;
      totalPrice: string;
      priceBreakdown: string;
    }>();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [beforeErr, setBeforeErr] = useState(false);
  const [afterErr, setAfterErr] = useState(false);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        if (sessionId) {
          const data = await getSession(sessionId);
          setSession(data);
        }
      } catch (e) {
        console.warn("Could not load session:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchSession();
  }, [sessionId]);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const quoteNumber = sessionId
    ? `CW-${sessionId.slice(0, 8).toUpperCase()}`
    : "CW-PREVIEW";

  const customerName = session?.customer_name || "Valued Customer";
  const customerEmail = session?.customer_email || "";

  // Price comes from the param (computed at configure time), fall back to session
  const parsedTotal =
    parseFloat(totalPrice || "0") || parseFloat(session?.total_price || "0");
  const totalFormatted =
    parsedTotal > 0 ? `$${parsedTotal.toLocaleString()}` : "TBD";

  // Financing — monthly estimates from the total (with discounts). Option 1 is
  // deferred (no payment / no interest); options 2 & 3 use the lender's
  // per-dollar payment factors. Keep these factors in sync with the PDF section.
  const fmtMoney = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const opt2Monthly = parsedTotal > 0 ? `$${fmtMoney(parsedTotal * 0.0198)}` : "—";
  const opt3Monthly = parsedTotal > 0 ? `$${fmtMoney(parsedTotal * 0.0107)}` : "—";

  const notes = session?.notes || "";
  const widthFt = session?.width_ft;
  const depthFt = session?.depth_ft;
  const heightFt = session?.height_ft;

  const breakdown: LineItem[] = (() => {
    try {
      return priceBreakdown ? JSON.parse(priceBreakdown) : [];
    } catch {
      return [];
    }
  })();

  const afterUrl = renderUrl || session?.render_url || "";
  // Fall back to the session's stored house photo when arriving from a saved
  // session (where the local photoUri param isn't present), so "before" loads.
  const beforeUrl = photoUri || session?.house_photo_url || "";

  // ─── PDF ──────────────────────────────────────────────────

  const buildQuoteHTML = (beforeDataUri: string, afterDataUri: string) => {
    const breakdownRows =
      breakdown.length > 0
        ? breakdown
            .map(
              (item) => `
          <tr>
            <td>${item.name}</td>
            <td style="color:#8a8880">${item.detail}</td>
            <td>$${item.amount.toLocaleString()}</td>
          </tr>`,
            )
            .join("")
        : `<tr><td colspan="2">Sunroom Installation</td><td>${totalFormatted}</td></tr>`;

    const photosHTML =
      beforeDataUri && afterDataUri
        ? `<div class="photos-grid">
            <div class="photo-card">
              <div class="photo-label">BEFORE</div>
              <img src="${beforeDataUri}" />
            </div>
            <div class="photo-card">
              <div class="photo-label after">AFTER — AI VISUALIZATION</div>
              <img src="${afterDataUri}" />
            </div>
          </div>`
        : afterDataUri
          ? `<div class="photo-card-full">
              <div class="photo-label">AI DESIGN VISUALIZATION</div>
              <img src="${afterDataUri}" style="width:100%;height:260px;object-fit:cover;border-radius:6px;" />
            </div>`
          : "";

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  /* @page margin 0 suppresses the browser's URL/date print headers;
     print-color-adjust forces the brand colors to actually print. Body padding
     supplies the page margins. NOTE: a full-bleed header background + margin:0
     trips a Chromium print bug that pushes the body onto a 2nd page, so the
     header is a rounded card WITHIN the margins instead of bleeding to the edge. */
  @page { margin: 0; size: A4; }
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif;
    color: #1b232e;
    background: #fff;
    font-size: 12.5px;
    line-height: 1.5;
    padding: 28px 34px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    background: #0A4A9F;
    color: #fff;
    border-radius: 10px;
    border-bottom: 4px solid #E1251B;
    padding: 22px 26px;
    margin-bottom: 20px;
  }
  .company { font-size: 30px; font-weight: 800; color: #fff; letter-spacing: 1.5px; }
  .tagline { font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase; color: rgba(255,255,255,0.85); margin-top: 5px; }
  .meta-right { text-align: right; }
  .meta-kicker { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.8); }
  .quote-num { font-size: 16px; font-weight: 700; color: #fff; letter-spacing: 0.5px; margin-top: 2px; }
  .meta-date { font-size: 11px; color: rgba(255,255,255,0.8); margin-top: 1px; }
  .two-col { display: flex; gap: 36px; margin-bottom: 18px; }
  .col { flex: 1; }
  .label { font-size: 10px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; color: #0A4A9F; margin-bottom: 8px; }
  .customer-name { font-size: 19px; font-weight: 700; color: #1b232e; }
  .customer-email { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .specs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
  .spec-label { font-size: 9.5px; letter-spacing: 1px; color: #6b7280; text-transform: uppercase; }
  .spec-value { font-size: 13px; font-weight: 600; color: #1b232e; }
  .divider { height: 1px; background: #e5e7eb; margin: 16px 0; }
  .photos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 4px; }
  .photo-card img { width: 100%; height: 175px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; display: block; }
  .photo-label { font-size: 9.5px; font-weight: 700; letter-spacing: 1.2px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; }
  .photo-label.after { color: #E1251B; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    font-size: 9.5px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; color: #6b7280;
    padding: 0 0 9px; text-align: left;
    border-bottom: 1.5px solid #e5e7eb;
  }
  thead th:last-child { text-align: right; }
  tbody td {
    padding: 9px 0; font-size: 12.5px; color: #374151;
    border-bottom: 1px solid #f0f2f5;
    vertical-align: top;
  }
  tbody td:first-child { font-weight: 600; color: #1b232e; }
  tbody td:last-child { text-align: right; font-weight: 600; color: #1b232e; white-space: nowrap; }
  .total-row td {
    border-bottom: none; border-top: 2px solid #1b232e;
    padding-top: 13px; font-weight: 800; font-size: 14px;
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  .total-row td:last-child { font-size: 22px; color: #0A4A9F; letter-spacing: 0; }
  .notes-box {
    background: #f6f8fb; border-radius: 8px;
    border-left: 3px solid #0A4A9F; padding: 14px 18px; margin-bottom: 24px;
  }
  .notes-box p { color: #4b5563; font-size: 12px; line-height: 1.7; }
  .footer {
    border-top: 1px solid #e5e7eb; padding-top: 18px;
    color: #6b7280; font-size: 10.5px; line-height: 1.7; text-align: center;
  }
  .validity {
    display: inline-block; background: #0A4A9F; color: #fff; border-radius: 20px;
    padding: 4px 14px; font-size: 10px; font-weight: 600; letter-spacing: 0.4px; margin-top: 8px;
  }
  .finance-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .finance-card { border: 1px solid #e5e7eb; border-top: 3px solid #0A4A9F; border-radius: 8px; padding: 13px 14px; }
  .fin-term { font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: #0A4A9F; }
  .fin-amt { font-size: 23px; font-weight: 800; color: #1b232e; margin: 7px 0; }
  .fin-amt span { font-size: 11px; font-weight: 600; color: #6b7280; }
  .fin-headline { font-size: 11px; font-weight: 600; color: #1b232e; line-height: 1.5; }
  .fin-feats { list-style: none; }
  .fin-feats li { font-size: 10.5px; color: #4b5563; padding-left: 13px; position: relative; line-height: 1.65; }
  .fin-feats li:before { content: "\\2713"; position: absolute; left: 0; color: #0A4A9F; font-weight: 700; }
  .fin-note { font-size: 9px; color: #9ca3af; line-height: 1.5; margin-bottom: 18px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="company">CHAMPION</div>
    <div class="tagline">Windows &bull; Sunrooms &bull; Home Exteriors</div>
  </div>
  <div class="meta-right">
    <div class="meta-kicker">Sunroom Proposal</div>
    <div class="quote-num">${quoteNumber}</div>
    <div class="meta-date">${today}</div>
  </div>
</div>

<div class="two-col">
  <div class="col">
    <div class="label">Prepared For</div>
    <div class="customer-name">${customerName}</div>
    ${customerEmail ? `<div class="customer-email">${customerEmail}</div>` : ""}
  </div>
  ${
    widthFt || depthFt || heightFt
      ? `<div class="col">
      <div class="label">Project Specifications</div>
      <div class="specs-grid">
        ${widthFt ? `<div><div class="spec-label">Front Width</div><div class="spec-value">${widthFt} ft</div></div>` : ""}
        ${depthFt ? `<div><div class="spec-label">Depth</div><div class="spec-value">${depthFt} ft</div></div>` : ""}
        ${heightFt ? `<div><div class="spec-label">Wall Height</div><div class="spec-value">${heightFt} ft</div></div>` : ""}
        ${widthFt && depthFt ? `<div><div class="spec-label">Floor Area</div><div class="spec-value">${(widthFt * depthFt).toFixed(0)} sq ft</div></div>` : ""}
      </div>
    </div>`
      : ""
  }
</div>

${
  photosHTML
    ? `<div class="divider"></div>
       <div class="label" style="margin-bottom:10px">Design Visualization</div>
       ${photosHTML}`
    : ""
}

<div class="divider"></div>

<div class="label" style="margin-bottom:12px">Investment Summary</div>
<table>
  <thead>
    <tr>
      <th>Item</th>
      <th>Details</th>
      <th>Amount</th>
    </tr>
  </thead>
  <tbody>
    ${breakdownRows}
    <tr class="total-row">
      <td colspan="2">Estimated Total Investment</td>
      <td>${totalFormatted}</td>
    </tr>
  </tbody>
</table>

${
  notes
    ? `<div class="divider"></div>
       <div class="notes-box">
         <div class="label" style="margin-bottom:6px">Notes &amp; Requirements</div>
         <p>${notes}</p>
       </div>`
    : ""
}

<div class="divider"></div>
<div class="label" style="margin-bottom:12px">Financing Options</div>
<div class="finance-grid">
  <div class="finance-card">
    <div class="fin-term">Option 1 &middot; 12 Months</div>
    <div class="fin-amt">$0<span> /mo</span></div>
    <div class="fin-headline">No Payments &amp; No Interest for 12 months</div>
  </div>
  <div class="finance-card">
    <div class="fin-term">Option 2 &middot; 6.99% &middot; 5 Years</div>
    <div class="fin-amt">${opt2Monthly}<span> /mo</span></div>
    <ul class="fin-feats">
      <li>Unsecured</li><li>No prepayment penalties</li>
      <li>No closing costs</li><li>No fees</li>
    </ul>
  </div>
  <div class="finance-card">
    <div class="fin-term">Option 3 &middot; 9.99% &middot; 180 Months</div>
    <div class="fin-amt">${opt3Monthly}<span> /mo</span></div>
    <ul class="fin-feats">
      <li>Unsecured</li><li>No prepayment penalties</li>
      <li>No closing costs</li><li>No fees</li>
    </ul>
  </div>
</div>
<div class="fin-note">Estimated monthly payments are based on the total investment with discounts and are subject to credit approval. Financing provided by a third party; actual payment may vary.</div>

<div class="footer">
  This proposal is an estimate based on the selected configuration and is subject to site inspection.<br/>
  Final pricing may vary based on structural requirements, permits, and site conditions.<br/>
  <span class="validity">Valid for 30 days · ${today}</span>
</div>

</body>
</html>`;
  };

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      // Convert both images to base64 so they embed in the PDF regardless of URI type
      const [beforeB64, afterB64] = await Promise.all([
        toBase64DataUri(beforeUrl),
        toBase64DataUri(afterUrl),
      ]);

      // Prefer embedded base64; fall back to the raw URL (the dedicated print
      // window / native printer can load remote images even if fetch was blocked).
      const html = buildQuoteHTML(beforeB64 || beforeUrl, afterB64 || afterUrl);

      // Web: print a clean dedicated window (use the browser's "Save as PDF").
      if (printHtmlWeb(html)) return;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: `Quote ${quoteNumber}`,
          UTI: "com.adobe.pdf",
        });
      }
    } catch (e) {
      console.warn("PDF export failed:", e);
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = async () => {
    try {
      const [beforeB64, afterB64] = await Promise.all([
        toBase64DataUri(beforeUrl),
        toBase64DataUri(afterUrl),
      ]);
      // Prefer embedded base64; fall back to the raw URL (the dedicated print
      // window / native printer can load remote images even if fetch was blocked).
      const html = buildQuoteHTML(beforeB64 || beforeUrl, afterB64 || afterUrl);
      if (printHtmlWeb(html)) return;
      await Print.printAsync({ html });
    } catch (e) {
      console.warn("Print failed:", e);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Preparing quote...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.company}>CHAMPION</Text>
            <Text style={styles.tagline}>WINDOWS • SUNROOMS • HOME EXTERIORS</Text>
          </View>
          <View style={styles.metaRight}>
            <Text style={styles.quoteNumber}>{quoteNumber}</Text>
            <Text style={styles.metaDate}>{today}</Text>
          </View>
        </View>

        {/* Customer + Specs */}
        <View style={styles.twoCol}>
          <View style={styles.halfCol}>
            <Text style={styles.sectionLabel}>PREPARED FOR</Text>
            <Text style={styles.customerName}>{customerName}</Text>
            {customerEmail ? (
              <Text style={styles.customerEmail}>{customerEmail}</Text>
            ) : null}
          </View>
          {(widthFt || depthFt || heightFt) && (
            <View style={styles.halfCol}>
              <Text style={styles.sectionLabel}>PROJECT SPECS</Text>
              <View style={styles.specsGrid}>
                {widthFt ? (
                  <View style={styles.specItem}>
                    <Text style={styles.specLabel}>Front Width</Text>
                    <Text style={styles.specValue}>{widthFt} ft</Text>
                  </View>
                ) : null}
                {depthFt ? (
                  <View style={styles.specItem}>
                    <Text style={styles.specLabel}>Depth</Text>
                    <Text style={styles.specValue}>{depthFt} ft</Text>
                  </View>
                ) : null}
                {heightFt ? (
                  <View style={styles.specItem}>
                    <Text style={styles.specLabel}>Wall Height</Text>
                    <Text style={styles.specValue}>{heightFt} ft</Text>
                  </View>
                ) : null}
                {widthFt && depthFt ? (
                  <View style={styles.specItem}>
                    <Text style={styles.specLabel}>Floor Area</Text>
                    <Text style={styles.specValue}>
                      {(widthFt * depthFt).toFixed(0)} sq ft
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        {/* Before / After */}
        {(beforeUrl || afterUrl) && (
          <>
            <Text style={styles.sectionLabel}>DESIGN VISUALIZATION</Text>
            <View style={styles.photoRow}>
              {beforeUrl ? (
                <View style={styles.photoCard}>
                  <Text style={styles.photoLabel}>BEFORE</Text>
                  {beforeErr ? (
                    <View style={[styles.photoImage, styles.photoFallback]}>
                      <Text style={styles.photoFallbackText}>
                        Photo unavailable
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: beforeUrl }}
                      style={styles.photoImage}
                      resizeMode="contain"
                      onError={() => setBeforeErr(true)}
                    />
                  )}
                </View>
              ) : null}
              {afterUrl ? (
                <View style={styles.photoCard}>
                  <Text style={[styles.photoLabel, styles.photoLabelAfter]}>
                    AFTER — AI RENDER
                  </Text>
                  {afterErr ? (
                    <View style={[styles.photoImage, styles.photoFallback]}>
                      <Text style={styles.photoFallbackText}>
                        Render unavailable
                      </Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: afterUrl }}
                      style={styles.photoImage}
                      resizeMode="contain"
                      onError={() => setAfterErr(true)}
                    />
                  )}
                </View>
              ) : null}
            </View>
            <View style={styles.divider} />
          </>
        )}

        {/* Price breakdown */}
        <Text style={styles.sectionLabel}>INVESTMENT SUMMARY</Text>
        <View style={styles.priceTable}>
          <View style={styles.priceTableHeader}>
            <Text style={[styles.priceHeaderText, { flex: 2 }]}>Item</Text>
            <Text style={[styles.priceHeaderText, { flex: 1 }]}>Details</Text>
            <Text
              style={[
                styles.priceHeaderText,
                { minWidth: 80, textAlign: "right" },
              ]}
            >
              Amount
            </Text>
          </View>

          {breakdown.length > 0 ? (
            breakdown.map((item, i) => (
              <View key={i} style={styles.priceRow}>
                <Text style={[styles.priceRowName, { flex: 2 }]}>
                  {item.name}
                </Text>
                <Text style={[styles.priceRowDetail, { flex: 1 }]}>
                  {item.detail}
                </Text>
                <Text
                  style={[
                    styles.priceRowValue,
                    { minWidth: 80, textAlign: "right" },
                  ]}
                >
                  ${item.amount.toLocaleString()}
                </Text>
              </View>
            ))
          ) : (
            <View style={styles.priceRow}>
              <Text style={[styles.priceRowName, { flex: 2 }]}>
                Sunroom Installation
              </Text>
              <Text style={[styles.priceRowDetail, { flex: 1 }]}>
                Materials, labor & installation
              </Text>
              <Text
                style={[
                  styles.priceRowValue,
                  { minWidth: 80, textAlign: "right" },
                ]}
              >
                {totalFormatted}
              </Text>
            </View>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Estimated Total Investment</Text>
            <Text style={styles.totalValue}>{totalFormatted}</Text>
          </View>
        </View>

        {/* Notes */}
        {notes ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>NOTES & REQUIREMENTS</Text>
            <View style={styles.notesBox}>
              <Text style={styles.notesText}>{notes}</Text>
            </View>
          </>
        ) : null}

        {/* Financing */}
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>FINANCING OPTIONS</Text>
        <View style={styles.financeGrid}>
          <View style={styles.financeCard}>
            <Text style={styles.finTerm}>OPTION 1 · 12 MONTHS</Text>
            <Text style={styles.finAmt}>
              $0<Text style={styles.finAmtUnit}> /mo</Text>
            </Text>
            <Text style={styles.finHeadline}>
              No Payments & No Interest for 12 months
            </Text>
          </View>
          <View style={styles.financeCard}>
            <Text style={styles.finTerm}>OPTION 2 · 6.99% · 5 YEARS</Text>
            <Text style={styles.finAmt}>
              {opt2Monthly}
              <Text style={styles.finAmtUnit}> /mo</Text>
            </Text>
            {["Unsecured", "No prepayment penalties", "No closing costs", "No fees"].map(
              (f) => (
                <Text key={f} style={styles.finFeat}>
                  ✓ {f}
                </Text>
              ),
            )}
          </View>
          <View style={styles.financeCard}>
            <Text style={styles.finTerm}>OPTION 3 · 9.99% · 180 MONTHS</Text>
            <Text style={styles.finAmt}>
              {opt3Monthly}
              <Text style={styles.finAmtUnit}> /mo</Text>
            </Text>
            {["Unsecured", "No prepayment penalties", "No closing costs", "No fees"].map(
              (f) => (
                <Text key={f} style={styles.finFeat}>
                  ✓ {f}
                </Text>
              ),
            )}
          </View>
        </View>
        <Text style={styles.finNote}>
          Estimated monthly payments are based on the total investment with
          discounts and are subject to credit approval. Financing provided by a
          third party; actual payment may vary.
        </Text>

        {/* Validity */}
        <View style={styles.validityBadge}>
          <Text style={styles.validityText}>Valid for 30 days · {today}</Text>
        </View>
        <Text style={styles.disclaimer}>
          This proposal is an estimate based on the selected configuration and
          is subject to site inspection. Final pricing may vary based on
          structural requirements, permits, and site conditions.
        </Text>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Pressable
          style={styles.primaryButton}
          onPress={handleExportPDF}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Export PDF</Text>
          )}
        </Pressable>
        <View style={styles.secondaryRow}>
          <Pressable style={styles.secondaryButton} onPress={handlePrint}>
            <Text style={styles.secondaryButtonText}>Print</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryButtonText}>← Design</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.dismissAll()}
          >
            <Text style={styles.secondaryButtonText}>New Design</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAFAF8" },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FAFAF8",
    gap: 12,
  },
  loadingText: { fontSize: 14, color: Colors.text.secondary },
  scroll: { flex: 1 },
  scrollContent: { padding: 24 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    backgroundColor: Colors.primary,
    borderRadius: 12,
    borderBottomWidth: 4,
    borderBottomColor: Colors.accent,
    padding: 18,
    marginBottom: 22,
  },
  company: {
    fontSize: 24,
    fontWeight: "800",
    color: Colors.white,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
    letterSpacing: 1.4,
    marginTop: 4,
  },
  metaRight: { alignItems: "flex-end", gap: 2 },
  quoteNumber: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.white,
    letterSpacing: 0.5,
  },
  metaDate: { fontSize: 12, color: "rgba(255,255,255,0.85)" },

  twoCol: { flexDirection: "row", gap: 20, marginBottom: 20 },
  halfCol: { flex: 1, gap: 6 },

  financeGrid: { flexDirection: "row", gap: 10, marginTop: 4 },
  financeCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 3,
    borderTopColor: Colors.primary,
    borderRadius: 10,
    padding: 12,
    backgroundColor: Colors.white,
  },
  finTerm: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Colors.primary,
  },
  finAmt: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.text.primary,
    marginTop: 6,
    marginBottom: 6,
  },
  finAmtUnit: { fontSize: 11, fontWeight: "600", color: Colors.text.secondary },
  finHeadline: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.text.primary,
    lineHeight: 16,
  },
  finFeat: { fontSize: 11, color: Colors.text.secondary, lineHeight: 18 },
  finNote: {
    fontSize: 10,
    color: Colors.text.tertiary,
    lineHeight: 14,
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: "#B0ADA6",
    marginBottom: 8,
  },
  customerName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
    letterSpacing: -0.3,
  },
  customerEmail: { fontSize: 13, color: "#8A8880" },
  specsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  specItem: { minWidth: "45%", gap: 1 },
  specLabel: { fontSize: 11, letterSpacing: 1.2, color: "#C0BCB5" },
  specValue: { fontSize: 14, fontWeight: "600", color: "#1C1C1E" },

  divider: { height: 1, backgroundColor: "#E8E4DC", marginVertical: 20 },

  photoRow: {
    flexDirection: "row",
    gap: 14,
    marginBottom: 4,
    maxWidth: 1700,
    width: "100%",
    alignSelf: "center",
  },
  photoCard: { flex: 1, gap: 5 },
  photoLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#B0ADA6",
  },
  photoImage: {
    width: "100%",
    height: 560,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: "#E2DED6",
    backgroundColor: "#EDEFF2",
  },
  photoLabelAfter: { color: Colors.accent },
  photoFallback: {
    backgroundColor: "#F0EDE8",
    alignItems: "center",
    justifyContent: "center",
  },
  photoFallbackText: {
    fontSize: 12,
    color: "#A8A49C",
    fontWeight: "600",
  },

  priceTable: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E8E4DC",
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  priceTableHeader: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#F5F3EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E8E4DC",
  },
  priceHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#B0ADA6",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F2F0EB",
  },
  priceRowName: { fontSize: 13, fontWeight: "500", color: "#1C1C1E" },
  priceRowDetail: { fontSize: 12, color: "#A8A49C", lineHeight: 16 },
  priceRowValue: { fontSize: 13, fontWeight: "600", color: "#1C1C1E" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "#F5F3EF",
    borderTopWidth: 1.5,
    borderTopColor: "#1C1C1E",
  },
  totalLabel: { fontSize: 13, fontWeight: "700", color: "#1C1C1E" },
  totalValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1C6B45",
    letterSpacing: -0.5,
  },

  notesBox: {
    backgroundColor: "#F5F3EF",
    borderRadius: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#C8C4BA",
    padding: 14,
  },
  notesText: { fontSize: 13, color: "#5A5854", lineHeight: 19 },

  validityBadge: {
    alignSelf: "center",
    backgroundColor: "#F0EDE8",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginTop: 20,
    marginBottom: 10,
  },
  validityText: {
    fontSize: 12,
    color: "#8A8880",
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  disclaimer: {
    fontSize: 12,
    color: "#C0BCB5",
    textAlign: "center",
    lineHeight: 15,
  },

  footer: {
    backgroundColor: "#fff",
    padding: 16,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: "#E8E4DC",
    gap: 10,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  secondaryRow: { flexDirection: "row", gap: 8 },
  secondaryButton: {
    flex: 1,
    backgroundColor: "#F5F3EF",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E8E4DC",
  },
  secondaryButtonText: { fontSize: 12, fontWeight: "600", color: "#5A5854" },
});

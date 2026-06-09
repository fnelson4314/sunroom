import { Colors } from "@/constants/Colors";
import { getSession } from "@/services/api";
import * as Print from "expo-print";
import { router, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type LineItem = { name: string; amount: number; detail: string };

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
              <div class="photo-label">AFTER — AI VISUALIZATION</div>
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
  @media print {
    @page { margin: 12mm 14mm; size: A4; }
    .no-print { display: none !important; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #1c1c1e;
    background: #fff;
    padding: 48px 52px;
    font-size: 13px;
    line-height: 1.5;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 1px solid #e2ded6;
  }
  .company { font-size: 26px; font-weight: 800; color: #1c1c1e; letter-spacing: -0.5px; }
  .tagline { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: #a8a49c; margin-top: 4px; }
  .meta-right { text-align: right; }
  .quote-num { font-size: 15px; font-weight: 700; color: #1c1c1e; letter-spacing: 0.5px; }
  .meta-date { font-size: 12px; color: #a8a49c; margin-top: 2px; }
  .two-col { display: flex; gap: 32px; margin-bottom: 28px; }
  .col { flex: 1; }
  .label { font-size: 9px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase; color: #b0ada6; margin-bottom: 6px; }
  .customer-name { font-size: 20px; font-weight: 700; color: #1c1c1e; }
  .customer-email { font-size: 12px; color: #8a8880; margin-top: 2px; }
  .specs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  .spec-label { font-size: 9px; letter-spacing: 1.2px; color: #c0bcb5; text-transform: uppercase; }
  .spec-value { font-size: 13px; font-weight: 600; color: #1c1c1e; }
  .divider { height: 1px; background: #e8e4dc; margin: 24px 0; }
  .photos-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 4px; }
  .photo-card img { width: 100%; height: 210px; object-fit: cover; border-radius: 6px; border: 1px solid #e2ded6; display: block; }
  .photo-label { font-size: 8px; font-weight: 700; letter-spacing: 1.5px; color: #b0ada6; margin-bottom: 5px; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase; color: #b0ada6;
    padding: 0 0 8px; text-align: left;
    border-bottom: 1px solid #e8e4dc;
  }
  thead th:last-child { text-align: right; }
  tbody td {
    padding: 10px 0; font-size: 13px; color: #3a3835;
    border-bottom: 1px solid #f2f0eb;
    vertical-align: top;
  }
  tbody td:last-child { text-align: right; font-weight: 500; color: #1c1c1e; }
  .total-row td {
    border-bottom: none; border-top: 1.5px solid #1c1c1e;
    padding-top: 12px; font-weight: 700; font-size: 15px;
  }
  .total-row td:last-child { font-size: 20px; color: #1c6b45; }
  .notes-box {
    background: #f9f8f5; border-radius: 6px;
    border-left: 2px solid #c8c4ba; padding: 14px 16px; margin-bottom: 24px;
  }
  .notes-box p { color: #5a5854; font-size: 12px; line-height: 1.7; }
  .footer {
    border-top: 1px solid #e8e4dc; padding-top: 18px;
    color: #b0ada6; font-size: 10px; line-height: 1.7; text-align: center;
  }
  .validity {
    display: inline-block; background: #f5f3ef; border-radius: 3px;
    padding: 3px 10px; font-size: 10px; color: #8a8880; margin-top: 8px;
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="company">Champion Windows</div>
    <div class="tagline">Sunroom Design Proposal</div>
  </div>
  <div class="meta-right">
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
        toBase64DataUri(photoUri || ""),
        toBase64DataUri(afterUrl),
      ]);

      const { uri } = await Print.printToFileAsync({
        html: buildQuoteHTML(beforeB64, afterB64),
        base64: false,
      });

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
        toBase64DataUri(photoUri || ""),
        toBase64DataUri(afterUrl),
      ]);
      await Print.printAsync({ html: buildQuoteHTML(beforeB64, afterB64) });
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
            <Text style={styles.company}>Champion Windows</Text>
            <Text style={styles.tagline}>SUNROOM DESIGN PROPOSAL</Text>
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
        {(photoUri || afterUrl) && (
          <>
            <Text style={styles.sectionLabel}>DESIGN VISUALIZATION</Text>
            <View style={styles.photoRow}>
              {photoUri ? (
                <View style={styles.photoCard}>
                  <Text style={styles.photoLabel}>BEFORE</Text>
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.photoImage}
                    resizeMode="cover"
                  />
                </View>
              ) : null}
              {afterUrl ? (
                <View style={styles.photoCard}>
                  <Text style={styles.photoLabel}>AFTER — AI RENDER</Text>
                  <Image
                    source={{ uri: afterUrl }}
                    style={styles.photoImage}
                    resizeMode="cover"
                  />
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
    alignItems: "flex-start",
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E2DED6",
    marginBottom: 20,
  },
  company: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1C1C1E",
    letterSpacing: -0.4,
  },
  tagline: { fontSize: 9, color: "#A8A49C", letterSpacing: 1.8, marginTop: 3 },
  metaRight: { alignItems: "flex-end", gap: 2 },
  quoteNumber: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1C1C1E",
    letterSpacing: 0.5,
  },
  metaDate: { fontSize: 12, color: "#A8A49C" },

  twoCol: { flexDirection: "row", gap: 20, marginBottom: 20 },
  halfCol: { flex: 1, gap: 6 },
  sectionLabel: {
    fontSize: 9,
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
  specLabel: { fontSize: 9, letterSpacing: 1.2, color: "#C0BCB5" },
  specValue: { fontSize: 14, fontWeight: "600", color: "#1C1C1E" },

  divider: { height: 1, backgroundColor: "#E8E4DC", marginVertical: 20 },

  photoRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  photoCard: { flex: 1, gap: 5 },
  photoLabel: {
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#B0ADA6",
  },
  photoImage: {
    width: "100%",
    height: 160,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: "#E2DED6",
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
    fontSize: 9,
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
  priceRowDetail: { fontSize: 11, color: "#A8A49C", lineHeight: 16 },
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
    fontSize: 11,
    color: "#8A8880",
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  disclaimer: {
    fontSize: 10,
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
    backgroundColor: "#1C1C1E",
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

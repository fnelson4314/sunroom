import Card from "@/components/ui/Card";
import StatusBadge from "@/components/ui/StatusBadge";
import { Colors } from "@/constants/Colors";
import { useDesignSession } from "@/contexts/DesignSession";
import { FontSize } from "@/constants/Typography";
import { getSession } from "@/services/api";
import { router, useLocalSearchParams } from "expo-router";
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

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { setPhotoUri } = useDesignSession();

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const data = await getSession(id);
        setSession(data);
      } catch (e) {
        setError("Could not load this session.");
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchSession();
  }, [id]);

  // ─── Loading ──────────────────────────────────────────────

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading session...</Text>
      </View>
    );
  }

  // ─── Error ────────────────────────────────────────────────

  if (error || !session) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || "Session not found"}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>← Go Back</Text>
        </Pressable>
      </View>
    );
  }

  // ─── Helpers ──────────────────────────────────────────────

  const createdAt = new Date(session.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // ─── Main render ─────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Render image */}
        {session.render_url ? (
          <Image
            source={{ uri: session.render_url }}
            style={styles.renderImage}
            resizeMode="cover"
          />
        ) : session.house_photo_url ? (
          <View style={styles.photoContainer}>
            <Image
              source={{ uri: session.house_photo_url }}
              style={styles.renderImage}
              resizeMode="cover"
            />
            <View style={styles.noRenderBanner}>
              <Text style={styles.noRenderBannerText}>
                {session.status === "generating" || session.status === "queued"
                  ? "Generation in progress..."
                  : "No render available"}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.noImagePlaceholder}>
            <Text style={styles.noImageText}>No image available</Text>
          </View>
        )}

        {/* Status badge */}
        <View style={styles.statusRow}>
          <StatusBadge status={session.status} />
          <Text style={styles.dateText}>{createdAt}</Text>
        </View>

        {/* Customer info */}
        <Card>
          <Text style={styles.cardLabel}>Customer</Text>
          <Text style={styles.cardTitle}>
            {session.customer_name || "Unnamed Customer"}
          </Text>
          {session.customer_email && (
            <Text style={styles.cardSub}>{session.customer_email}</Text>
          )}
        </Card>

        {/* Dimensions */}
        {(session.width_ft || session.depth_ft) && (
          <Card>
            <Text style={styles.cardLabel}>Dimensions</Text>
            <View style={styles.dimensionRow}>
              {session.width_ft && (
                <View style={styles.dimensionItem}>
                  <Text style={styles.dimensionValue}>
                    {session.width_ft} ft
                  </Text>
                  <Text style={styles.dimensionLabel}>Width</Text>
                </View>
              )}
              {session.depth_ft && (
                <View style={styles.dimensionItem}>
                  <Text style={styles.dimensionValue}>
                    {session.depth_ft} ft
                  </Text>
                  <Text style={styles.dimensionLabel}>Depth</Text>
                </View>
              )}
              {session.height_ft && (
                <View style={styles.dimensionItem}>
                  <Text style={styles.dimensionValue}>
                    {session.height_ft} ft
                  </Text>
                  <Text style={styles.dimensionLabel}>Height</Text>
                </View>
              )}
              {session.width_ft && session.depth_ft && (
                <View style={styles.dimensionItem}>
                  <Text style={styles.dimensionValue}>
                    {(session.width_ft * session.depth_ft).toFixed(0)} sq ft
                  </Text>
                  <Text style={styles.dimensionLabel}>Area</Text>
                </View>
              )}
            </View>
          </Card>
        )}

        {/* Before photo — the original house photo, shown alongside the render
            so the completed session keeps both before and after. */}
        {session.render_url && session.house_photo_url && (
          <Card>
            <Text style={styles.cardLabel}>Before</Text>
            <Image
              source={{ uri: session.house_photo_url }}
              style={styles.beforeImage}
              resizeMode="cover"
            />
          </Card>
        )}

        {/* Price */}
        {session.total_price && (
          <Card style={styles.priceCard}>
            <Text style={styles.priceLabel}>Estimated Total</Text>
            <Text style={styles.priceValue}>
              ${Number(session.total_price).toLocaleString()}
            </Text>
          </Card>
        )}

        {/* Notes */}
        {session.notes && (
          <Card>
            <Text style={styles.cardLabel}>Notes</Text>
            <Text style={styles.notesText}>{session.notes}</Text>
          </Card>
        )}

        {/* Session ID for reference */}
        <Text style={styles.sessionId}>
          Session ID: {session.id.slice(0, 8).toUpperCase()}
        </Text>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Footer actions */}
      <View style={styles.footer}>
        {/* Only show quote button if complete */}
        {session.status === "complete" && (
          <Pressable
            style={styles.primaryButton}
            onPress={() =>
              router.push({
                pathname: "/quote",
                params: {
                  sessionId: session.id,
                  renderUrl: session.render_url,
                },
              })
            }
          >
            <Text style={styles.primaryButtonText}>View Quote →</Text>
          </Pressable>
        )}

        {/* Show retry if failed */}
        {session.status === "failed" && (
          <Pressable style={styles.retryButton} onPress={() => router.back()}>
            <Text style={styles.retryButtonText}>Go Back to Reconfigure</Text>
          </Pressable>
        )}

        {/* Reopen the full configuration in the wizard. The session row carries
            the whole draft_state (config + before-photo/box), so hydrateFromDraft
            restores every selection. Pass the persistent house_photo_url so the
            photo survives even if the original local file is gone. */}
        {session.draft_state && (
          <Pressable
            style={styles.retryButton}
            onPress={() => {
              // The persistent Supabase URL, so the photo survives even if the
              // original local file is gone. Set on the session, not a param.
              setPhotoUri(session.house_photo_url ?? "");
              router.push({
                pathname: "/configure",
                params: {
                  draftId: session.id,
                  box_x1: "0",
                  box_y1: "0",
                  box_x2: "1",
                  box_y2: "1",
                },
              });
            }}
          >
            <Text style={styles.retryButtonText}>✎ Edit Configuration</Text>
          </Pressable>
        )}

        <View style={styles.secondaryButtons}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryButtonText}>← Back</Text>
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
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
    padding: 24,
    gap: 16,
  },
  loadingText: {
    fontSize: FontSize.callout,
    color: Colors.text.secondary,
  },
  errorText: {
    fontSize: FontSize.label,
    color: Colors.status.failed,
    textAlign: "center",
  },
  backButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  backButtonText: {
    color: Colors.white,
    fontSize: FontSize.label,
    fontWeight: "600",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  renderImage: {
    width: "100%",
    height: 260,
    borderRadius: 14,
    marginBottom: 4,
  },
  beforeImage: {
    width: "100%",
    height: 180,
    borderRadius: 10,
    marginTop: 6,
  },
  photoContainer: {
    position: "relative",
    marginBottom: 4,
  },
  noRenderBanner: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 10,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  noRenderBannerText: {
    color: Colors.white,
    fontSize: FontSize.body,
    textAlign: "center",
    fontWeight: "500",
  },
  noImagePlaceholder: {
    width: "100%",
    height: 200,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 4,
  },
  noImageText: {
    fontSize: FontSize.callout,
    color: Colors.text.tertiary,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  dateText: {
    fontSize: FontSize.body,
    color: Colors.text.tertiary,
  },
  cardLabel: {
    fontSize: FontSize.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: Colors.text.tertiary,
  },
  cardTitle: {
    fontSize: FontSize.heading,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  cardSub: {
    fontSize: FontSize.body,
    color: Colors.text.secondary,
  },
  dimensionRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  dimensionItem: {
    flex: 1,
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    gap: 2,
  },
  dimensionValue: {
    fontSize: FontSize.label,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  dimensionLabel: {
    fontSize: FontSize.small,
    color: Colors.text.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  priceCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceLabel: {
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  priceValue: {
    fontSize: FontSize.largeTitle,
    fontWeight: "800",
    color: Colors.status.complete,
  },
  notesText: {
    fontSize: FontSize.callout,
    color: Colors.text.secondary,
    lineHeight: 22,
  },
  sessionId: {
    fontSize: FontSize.small,
    color: Colors.text.tertiary,
    textAlign: "center",
    fontFamily: "monospace",
    marginTop: 4,
  },
  footer: {
    backgroundColor: Colors.surface,
    padding: 16,
    paddingBottom: 36,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
    gap: 10,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: FontSize.label,
    fontWeight: "700",
  },
  retryButton: {
    backgroundColor: Colors.background,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryButtonText: {
    color: Colors.text.secondary,
    fontSize: FontSize.label,
    fontWeight: "600",
  },
  secondaryButtons: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
});
